import type { Db } from '../db/types';
import { APP_VERSION } from '../constants/defaults';
import { getSetting, setSetting } from '../repositories/settings.repository';
import {
  BackupError, createBackup, parseBackup, restoreBackup, serializeBackup, summarizeBackup, type BackupFile, type BackupSummary,
} from './backup.service';
import type { CloudAuth, CloudStore, NetworkState, RemoteBackupMeta, SecretStore } from '../cloud/types';
import {
  createKey, decryptEnvelope, deriveKey, encryptText, parseKey, readEnvelope, serializeKey, sha256Hex,
  type EncryptionKey, type RandomBytes,
} from '../cloud/crypto';
import { fromBase64, toHex } from '../cloud/encoding';

/**
 * Sauvegarde en ligne (option A) : une COPIE COMPLÈTE des données locales est envoyée dans le cloud.
 * SQLite reste la seule base de travail ; l'application fonctionne entièrement hors ligne.
 * - L'envoi n'efface ni ne modifie jamais les données locales, même en cas d'échec.
 * - Une sauvegarde n'est visible qu'une fois TOUS ses morceaux envoyés (statut « complete »).
 * - Les 5 dernières sauvegardes complètes sont conservées.
 */
export const KEEP_BACKUPS = 5;
/** Morceaux ≤ 250 000 caractères : < 1 Mio par document Firestore même avec des caractères accentués. */
export const CHUNK_SIZE = 250_000;
export const STALE_UPLOAD_MS = 24 * 3600_000;
export const AUTO_INTERVAL_MS = 12 * 3600_000;
const SECRET_KEY_NAME = 'mobibudget.cloud.key';

const K = {
  autoEnabled: 'cloud_auto',
  wifiOnly: 'cloud_wifi_only',
  encrypted: 'cloud_encrypted',
  lastSuccessAt: 'cloud_last_success_at',
  lastCheckAt: 'cloud_last_check_at',
  lastHash: 'cloud_last_hash',
  lastError: 'cloud_last_error',
  lastErrorAt: 'cloud_last_error_at',
  failures: 'cloud_failures',
  deviceId: 'device_id',
} as const;

export interface CloudDeps {
  db: Db;
  store: CloudStore;
  auth: CloudAuth;
  network: () => Promise<NetworkState>;
  secrets: SecretStore;
  random: RandomBytes;
  now?: () => Date;
  /** Copie de sécurité locale avant une restauration qui remplace des données existantes. */
  saveSafetySnapshot?: (fileName: string, text: string) => Promise<void>;
}

export class PasswordRequiredError extends BackupError {
  constructor() {
    super('Cette sauvegarde est protégée par un mot de passe. Saisissez-le pour la restaurer.');
    this.name = 'BackupError';
  }
}

export interface CloudSettings {
  autoEnabled: boolean;
  wifiOnly: boolean;
  encrypted: boolean;
  lastSuccessAt: string | null;
  lastCheckAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  failures: number;
}

export async function loadCloudSettings(db: Db): Promise<CloudSettings> {
  const get = (k: string) => getSetting(db, k);
  const [auto, wifi, enc, ok, check, err, errAt, fails] = await Promise.all([
    get(K.autoEnabled), get(K.wifiOnly), get(K.encrypted), get(K.lastSuccessAt), get(K.lastCheckAt), get(K.lastError), get(K.lastErrorAt), get(K.failures),
  ]);
  return {
    autoEnabled: auto !== '0', // activée par défaut
    wifiOnly: wifi === '1',
    encrypted: enc === '1',
    lastSuccessAt: ok || null,
    lastCheckAt: check || null,
    lastError: err || null,
    lastErrorAt: errAt || null,
    failures: Number(fails ?? '0') || 0,
  };
}

export async function setCloudOption(db: Db, option: 'autoEnabled' | 'wifiOnly', value: boolean): Promise<void> {
  await setSetting(db, K[option], value ? '1' : '0');
}

/** Attente après des échecs successifs : 1, 2, 4… minutes, plafonnée à 60 minutes. */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(60, 2 ** (failures - 1)) * 60_000;
}

async function getDeviceId(db: Db, random: RandomBytes): Promise<string> {
  const existing = await getSetting(db, K.deviceId);
  if (existing) return existing;
  const id = toHex(random(8));
  await setSetting(db, K.deviceId, id);
  return id;
}

/** Message d'erreur compréhensible à partir d'une erreur réseau / Firebase. */
export function describeCloudError(e: unknown): string {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  if (/unavailable|deadline-exceeded|network/i.test(code)) return 'Connexion au serveur de sauvegarde impossible. Nouvel essai automatique plus tard.';
  if (/permission-denied|unauthenticated/i.test(code)) return 'Le serveur a refusé l\'accès. Reconnectez-vous à votre compte Google.';
  if (/resource-exhausted|quota/i.test(code)) return 'Quota du serveur de sauvegarde atteint. Nouvel essai plus tard.';
  if (e instanceof BackupError) return e.message;
  return 'La sauvegarde en ligne a échoué. Vos données locales sont intactes ; nouvel essai automatique plus tard.';
}

async function loadKey(secrets: SecretStore): Promise<EncryptionKey | null> {
  const raw = await secrets.get(SECRET_KEY_NAME);
  return raw ? parseKey(raw) : null;
}

export type BackupOutcome =
  | { status: 'uploaded'; meta: RemoteBackupMeta }
  | { status: 'unchanged' }
  | { status: 'skipped'; reason: 'not-configured' | 'signed-out' | 'auto-disabled' | 'offline' | 'wifi-only' | 'backoff' | 'empty' }
  | { status: 'failed'; error: string };

/**
 * Envoie une sauvegarde si c'est possible et utile.
 * `trigger: 'auto'` respecte les réglages (automatique, Wi-Fi seulement) et l'attente après échec ;
 * `trigger: 'manual'` (bouton « Sauvegarder maintenant ») envoie dès qu'il y a internet.
 * Des données identiques à la dernière sauvegarde réussie ne sont pas renvoyées (sauf `force`).
 */
export async function runCloudBackup(deps: CloudDeps, opts: { trigger: 'auto' | 'manual'; force?: boolean }): Promise<BackupOutcome> {
  const now = deps.now ?? (() => new Date());
  const { db } = deps;
  if (!deps.auth.isConfigured()) return { status: 'skipped', reason: 'not-configured' };
  const user = deps.auth.currentUser();
  if (!user) return { status: 'skipped', reason: 'signed-out' };
  const settings = await loadCloudSettings(db);
  if (opts.trigger === 'auto' && !settings.autoEnabled) return { status: 'skipped', reason: 'auto-disabled' };
  const net = await deps.network();
  if (!net.online) return { status: 'skipped', reason: 'offline' };
  if (opts.trigger === 'auto' && settings.wifiOnly && !net.wifi) return { status: 'skipped', reason: 'wifi-only' };
  if (opts.trigger === 'auto' && settings.failures > 0 && settings.lastErrorAt) {
    if (now().getTime() - Date.parse(settings.lastErrorAt) < backoffMs(settings.failures)) return { status: 'skipped', reason: 'backoff' };
  }

  // Jamais d'envoi d'une base vide (téléphone neuf, configuration non terminée) : elle deviendrait
  // la « dernière sauvegarde » et pourrait faire croire que les vraies données ont disparu.
  const local = await db.first<{ n: number; done: string | null }>(
    "SELECT (SELECT COUNT(*) FROM accounts) AS n, (SELECT value FROM settings WHERE key = 'onboarding_completed') AS done",
  );
  if (!local || local.n === 0 || local.done !== '1') return { status: 'skipped', reason: 'empty' };

  try {
    const file = await createBackup(db, { now: now() });
    const dataHash = sha256Hex(JSON.stringify(file.data));
    if (!opts.force && dataHash === (await getSetting(db, K.lastHash))) {
      await setSetting(db, K.lastCheckAt, now().toISOString());
      return { status: 'unchanged' };
    }
    let payload = serializeBackup(file);
    if (settings.encrypted) {
      const key = await loadKey(deps.secrets);
      if (!key) throw new BackupError('Mot de passe de sauvegarde introuvable sur ce téléphone : redéfinissez-le dans Paramètres.');
      payload = encryptText(payload, key, deps.random);
    }
    const createdAt = now().toISOString();
    const chunks: string[] = [];
    for (let i = 0; i < payload.length; i += CHUNK_SIZE) chunks.push(payload.slice(i, i + CHUNK_SIZE));
    const meta: RemoteBackupMeta = {
      id: `${createdAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${toHex(deps.random(4))}`,
      createdAt,
      status: 'uploading',
      deviceId: await getDeviceId(db, deps.random),
      appVersion: APP_VERSION,
      formatVersion: file.formatVersion,
      encrypted: settings.encrypted,
      size: payload.length,
      checksum: sha256Hex(payload),
      chunkCount: chunks.length,
      summary: summarizeBackup(file),
    };
    await deps.store.putMeta(user.uid, meta);
    for (let i = 0; i < chunks.length; i++) await deps.store.putChunk(user.uid, meta.id, i, chunks[i]);
    await deps.store.markComplete(user.uid, meta.id);

    await setSetting(db, K.lastSuccessAt, createdAt);
    await setSetting(db, K.lastCheckAt, createdAt);
    await setSetting(db, K.lastHash, dataHash);
    await setSetting(db, K.failures, '0');
    await setSetting(db, K.lastError, '');
    try {
      await pruneBackups(deps.store, user.uid, now());
    } catch {
      /* le ménage sera refait à la prochaine sauvegarde */
    }
    return { status: 'uploaded', meta: { ...meta, status: 'complete' } };
  } catch (e) {
    const error = describeCloudError(e);
    await setSetting(db, K.failures, String(settings.failures + 1));
    await setSetting(db, K.lastError, error);
    await setSetting(db, K.lastErrorAt, now().toISOString());
    return { status: 'failed', error };
  }
}

/** Garde les KEEP_BACKUPS sauvegardes complètes les plus récentes et supprime les envois abandonnés (> 24 h). */
export async function pruneBackups(store: CloudStore, uid: string, now: Date): Promise<string[]> {
  const all = await store.listBackups(uid);
  const complete = all.filter((b) => b.status === 'complete').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const stale = all.filter((b) => b.status !== 'complete' && now.getTime() - Date.parse(b.createdAt) > STALE_UPLOAD_MS);
  const toDelete = [...complete.slice(KEEP_BACKUPS), ...stale];
  for (const b of toDelete) await store.deleteBackup(uid, b.id);
  return toDelete.map((b) => b.id);
}

/** Sauvegardes complètes de l'utilisateur connecté, de la plus récente à la plus ancienne. */
export async function listCloudBackups(deps: CloudDeps): Promise<RemoteBackupMeta[]> {
  const user = deps.auth.currentUser();
  if (!user) return [];
  return (await deps.store.listBackups(user.uid))
    .filter((b) => b.status === 'complete')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Télécharge, vérifie l'intégrité, déchiffre si besoin et VALIDE une sauvegarde, sans rien modifier localement. */
export async function downloadCloudBackup(
  deps: CloudDeps,
  meta: RemoteBackupMeta,
  password?: string,
): Promise<{ file: BackupFile; key: EncryptionKey | null }> {
  const user = deps.auth.currentUser();
  if (!user) throw new BackupError('Connectez-vous à votre compte Google pour accéder à vos sauvegardes en ligne.');
  const chunks = (await deps.store.getChunks(user.uid, meta.id)).sort((a, b) => a.index - b.index);
  const complete = chunks.length === meta.chunkCount && chunks.every((c, i) => c.index === i);
  const text = chunks.map((c) => c.data).join('');
  if (!complete || sha256Hex(text) !== meta.checksum) {
    throw new BackupError('Sauvegarde en ligne incomplète ou endommagée : choisissez-en une autre.');
  }
  const envelope = readEnvelope(text);
  if (!envelope) return { file: parseBackup(text), key: null };

  let key: EncryptionKey | null = null;
  if (password !== undefined) key = deriveKey(password, fromBase64(envelope.kdf.salt), envelope.kdf.iterations);
  else {
    const stored = await loadKey(deps.secrets);
    if (stored && toHex(stored.salt) === toHex(fromBase64(envelope.kdf.salt))) key = stored;
  }
  if (!key) throw new PasswordRequiredError();
  return { file: parseBackup(decryptEnvelope(envelope, { key })), key };
}

/**
 * Restaure une sauvegarde en ligne. Ordre : téléchargement + vérification + validation (rien n'est touché),
 * copie de sécurité locale si des données existent, puis remplacement ATOMIQUE.
 */
export async function restoreFromCloud(deps: CloudDeps, meta: RemoteBackupMeta, opts: { password?: string } = {}): Promise<BackupSummary> {
  const { db } = deps;
  const { file, key } = await downloadCloudBackup(deps, meta, opts.password);
  const local = await db.first<{ n: number }>('SELECT (SELECT COUNT(*) FROM accounts) + (SELECT COUNT(*) FROM transactions) AS n');
  if ((local?.n ?? 0) > 0) {
    if (!deps.saveSafetySnapshot) throw new BackupError('Impossible de créer la copie de sécurité locale : restauration annulée.');
    const now = (deps.now ?? (() => new Date()))();
    await deps.saveSafetySnapshot(`mobibudget-avant-restauration-${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, serializeBackup(await createBackup(db)));
  }
  const summary = await restoreBackup(db, file);
  // Les données restaurées sont déjà en ligne : inutile de les renvoyer tout de suite.
  await setSetting(db, K.lastHash, sha256Hex(JSON.stringify((await createBackup(db)).data)));
  if (meta.encrypted && key) {
    await deps.secrets.set(SECRET_KEY_NAME, serializeKey(key));
    await setSetting(db, K.encrypted, '1');
  }
  return summary;
}

/** Active le chiffrement : la clé dérivée (jamais le mot de passe) est gardée dans le stockage sécurisé. */
export async function enableEncryption(deps: CloudDeps, password: string): Promise<void> {
  const key = createKey(password, deps.random);
  await deps.secrets.set(SECRET_KEY_NAME, serializeKey(key));
  await setSetting(deps.db, K.encrypted, '1');
  await setSetting(deps.db, K.lastHash, ''); // la prochaine sauvegarde sera chiffrée
}

export async function disableEncryption(deps: CloudDeps): Promise<void> {
  await deps.secrets.remove(SECRET_KEY_NAME);
  await setSetting(deps.db, K.encrypted, '0');
  await setSetting(deps.db, K.lastHash, '');
}

/** Déconnexion : les données locales sont conservées ; la clé de chiffrement est oubliée sur ce téléphone. */
export async function signOutCloud(deps: CloudDeps): Promise<void> {
  await deps.auth.signOut();
  await deps.secrets.remove(SECRET_KEY_NAME);
  for (const k of [K.encrypted, K.lastHash, K.lastError, K.failures]) await setSetting(deps.db, k, k === K.failures ? '0' : '');
}

/**
 * Suppression du compte en ligne : toutes les sauvegardes (même inachevées), puis le compte, puis la session et
 * la clé de chiffrement sur ce téléphone. Les données locales ne sont jamais touchées ; après un échec, relancer
 * termine le travail.
 */
export async function deleteCloudAccount(deps: CloudDeps): Promise<{ deletedBackups: number }> {
  const user = deps.auth.currentUser();
  if (!user) throw new BackupError('Connectez-vous à votre compte Google pour le supprimer.');
  if (!(await deps.network()).online) throw new BackupError('Pas de connexion internet : la suppression du compte en a besoin.');
  const backups = await deps.store.listBackups(user.uid);
  for (const b of backups) await deps.store.deleteBackup(user.uid, b.id);
  await deps.auth.deleteAccount();
  await signOutCloud(deps);
  // L'état affiché (« Dernière sauvegarde en ligne… ») concernait le compte supprimé.
  for (const k of [K.lastSuccessAt, K.lastCheckAt, K.lastErrorAt]) await setSetting(deps.db, k, '');
  return { deletedBackups: backups.length };
}

/** Une vérification automatique est-elle due (dernière vérification > 12 h) ? Utilisé par la tâche de fond. */
export function isPeriodicCheckDue(settings: CloudSettings, now: Date): boolean {
  const last = settings.lastCheckAt ?? settings.lastSuccessAt;
  return !last || now.getTime() - Date.parse(last) >= AUTO_INTERVAL_MS;
}
