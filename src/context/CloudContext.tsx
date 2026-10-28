import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useApp } from './AppContext';
import { buildCloudDeps } from '../cloud/platform';
import { SignInCancelled } from '../cloud/googleAuth';
import { disableBackgroundBackup, enableBackgroundBackup } from '../cloud/backgroundTask';
import type { CloudUser, RemoteBackupMeta } from '../cloud/types';
import {
  AUTO_INTERVAL_MS, deleteCloudAccount, disableEncryption, enableEncryption, listCloudBackups, loadCloudSettings, restoreFromCloud,
  runCloudBackup, setCloudOption, signOutCloud, type BackupOutcome, type CloudSettings,
} from '../services/cloudBackup.service';
import type { BackupSummary } from '../services/backup.service';

/** Délai après une modification avant l'envoi (regroupe les saisies rapprochées). */
const CHANGE_DEBOUNCE_MS = 60_000;

interface CloudContextValue {
  /** La sauvegarde en ligne est-elle disponible dans cette version (Firebase configuré, Android) ? */
  available: boolean;
  user: CloudUser | null;
  settings: CloudSettings | null;
  lastOutcome: BackupOutcome | null;
  /** null si l'utilisateur a annulé. */
  signIn: () => Promise<CloudUser | null>;
  signOut: () => Promise<void>;
  backupNow: () => Promise<BackupOutcome>;
  setOption: (option: 'autoEnabled' | 'wifiOnly', value: boolean) => Promise<void>;
  setPassword: (password: string) => Promise<void>;
  removePassword: () => Promise<void>;
  listBackups: () => Promise<RemoteBackupMeta[]>;
  restore: (meta: RemoteBackupMeta, password?: string) => Promise<BackupSummary>;
  /** Supprime les sauvegardes en ligne puis le compte : nombre de sauvegardes supprimées, null si la reconnexion a été annulée. */
  deleteAccount: () => Promise<number | null>;
}

const CloudContext = createContext<CloudContextValue | null>(null);

export function useCloud(): CloudContextValue {
  const ctx = useContext(CloudContext);
  if (!ctx) throw new Error('useCloud doit être utilisé dans <CloudProvider>.');
  return ctx;
}

export function CloudProvider({ children }: { children: React.ReactNode }) {
  const { db, revision, refresh } = useApp();
  const deps = useMemo(() => buildCloudDeps(db), [db]);
  const available = deps.auth.isConfigured();
  const [user, setUser] = useState<CloudUser | null>(null);
  const [settings, setSettings] = useState<CloudSettings | null>(null);
  const [lastOutcome, setLastOutcome] = useState<BackupOutcome | null>(null);

  const reloadSettings = useCallback(async () => setSettings(await loadCloudSettings(db)), [db]);

  // Une seule sauvegarde à la fois ; les déclenchements automatiques rapprochés sont regroupés.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const autoQueued = useRef(false);
  const enqueue = useCallback(
    (trigger: 'auto' | 'manual', force = false): Promise<BackupOutcome | null> => {
      if (!available) return Promise.resolve(null);
      if (trigger === 'auto') {
        if (autoQueued.current) return Promise.resolve(null);
        autoQueued.current = true;
      }
      const run = queue.current.then(async () => {
        if (trigger === 'auto') autoQueued.current = false;
        const r = await runCloudBackup(deps, { trigger, force });
        setLastOutcome(r);
        await reloadSettings();
        return r;
      });
      queue.current = run.catch(() => undefined);
      return run;
    },
    [available, deps, reloadSettings],
  );

  // Démarrage : session restaurée, puis vérification.
  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    (async () => {
      await deps.auth.ready?.();
      if (cancelled) return;
      setUser(deps.auth.currentUser());
      await reloadSettings();
      void enqueue('auto');
    })();
    const unsubscribe = deps.auth.subscribe?.((u) => setUser(u));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [available, deps, enqueue, reloadSettings]);

  // Retour sur l'application, retour d'internet, et toutes les 12 h tant qu'elle est ouverte.
  useEffect(() => {
    if (!available) return;
    const appState = AppState.addEventListener('change', (s) => s === 'active' && void enqueue('auto'));
    let wasOnline = true;
    const net = NetInfo.addEventListener((s) => {
      const online = !!s.isConnected && s.isInternetReachable !== false;
      if (online && !wasOnline) void enqueue('auto');
      wasOnline = online;
    });
    const timer = setInterval(() => void enqueue('auto'), AUTO_INTERVAL_MS);
    return () => {
      appState.remove();
      net();
      clearInterval(timer);
    };
  }, [available, enqueue]);

  // Après chaque modification des données : envoi une minute plus tard.
  const firstRevision = useRef(true);
  useEffect(() => {
    if (firstRevision.current) {
      firstRevision.current = false;
      return;
    }
    if (!available) return;
    const t = setTimeout(() => void enqueue('auto'), CHANGE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [revision, available, enqueue]);

  // Tâche de fond (~12 h) seulement si connecté avec la sauvegarde automatique active.
  useEffect(() => {
    if (!available) return;
    if (user && settings?.autoEnabled) void enableBackgroundBackup().catch(() => undefined);
    else void disableBackgroundBackup().catch(() => undefined);
  }, [available, user, settings?.autoEnabled]);

  const value = useMemo<CloudContextValue>(
    () => ({
      available,
      user,
      settings,
      lastOutcome,
      signIn: async () => {
        try {
          const u = await deps.auth.signIn();
          setUser(u);
          await reloadSettings();
          return u;
        } catch (e) {
          if (e instanceof SignInCancelled) return null;
          throw e;
        }
      },
      signOut: async () => {
        await signOutCloud(deps);
        setUser(null);
        setLastOutcome(null);
        await reloadSettings();
      },
      backupNow: async () => (await enqueue('manual', true)) ?? { status: 'skipped', reason: 'not-configured' },
      setOption: async (option, v) => {
        await setCloudOption(db, option, v);
        await reloadSettings();
      },
      setPassword: async (password) => {
        await enableEncryption(deps, password);
        await reloadSettings();
        void enqueue('auto');
      },
      removePassword: async () => {
        await disableEncryption(deps);
        await reloadSettings();
        void enqueue('auto');
      },
      deleteAccount: async () => {
        // Passe après un envoi en cours : sinon une sauvegarde pourrait réapparaître juste après la suppression.
        const run = queue.current.then(() => deleteCloudAccount(deps));
        queue.current = run.catch(() => undefined);
        let deleted: number;
        try {
          deleted = (await run).deletedBackups;
        } catch (e) {
          if (e instanceof SignInCancelled) return null;
          throw e;
        }
        setUser(null);
        setLastOutcome(null);
        await reloadSettings();
        return deleted;
      },
      listBackups: () => listCloudBackups(deps),
      restore: async (meta, password) => {
        const summary = await restoreFromCloud(deps, meta, { password });
        await refresh();
        await reloadSettings();
        return summary;
      },
    }),
    [available, user, settings, lastOutcome, deps, db, enqueue, refresh, reloadSettings],
  );

  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
}
