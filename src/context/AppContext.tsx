import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { openDatabase } from '../db/database';
import type { Db } from '../db/types';
import { loadAppSettings, type AppSettings } from '../services/onboarding.service';
import { colors } from '../theme';

interface AppContextValue {
  db: Db;
  settings: AppSettings;
  /** Incrémenté après chaque modification : les écrans rechargent leurs données. */
  revision: number;
  /** À appeler après toute écriture (création, modification, suppression, restauration…). */
  refresh: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp doit être utilisé dans <AppProvider>.');
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<Db | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const opened = await openDatabase();
        const s = await loadAppSettings(opened);
        if (!cancelled) {
          setDb(opened);
          setSettings(s);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!db) return;
    setSettings(await loadAppSettings(db));
    setRevision((r) => r + 1);
  }, [db]);

  const value = useMemo(() => (db && settings ? { db, settings, revision, refresh } : null), [db, settings, revision, refresh]);

  if (error) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.expense, marginBottom: 8 }}>Impossible d'ouvrir la base de données</Text>
        <Text style={{ color: colors.muted, textAlign: 'center' }}>{error}</Text>
        <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 12 }}>
          Vos données n'ont pas été modifiées. Fermez puis relancez l'application.
        </Text>
      </View>
    );
  }
  if (!value) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
