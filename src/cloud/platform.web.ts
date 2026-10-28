import type { Db } from '../db/types';
import type { CloudDeps } from '../services/cloudBackup.service';
import { googleCloudAuth } from './googleAuth';
import type { CloudStore } from './types';

/** Navigateur (tests sur PC) : sauvegarde en ligne indisponible ; aucune dépendance native chargée. */
const unavailable = async (): Promise<never> => {
  throw new Error('La sauvegarde en ligne n\'est disponible que dans l\'application Android.');
};
const store: CloudStore = {
  listBackups: async () => [],
  putMeta: unavailable,
  putChunk: unavailable,
  markComplete: unavailable,
  getChunks: unavailable,
  deleteBackup: unavailable,
};
const memory = new Map<string, string>();

export function buildCloudDeps(db: Db): CloudDeps {
  return {
    db,
    store,
    auth: googleCloudAuth,
    network: async () => ({ online: true, wifi: true }),
    secrets: { get: async (k) => memory.get(k) ?? null, set: async (k, v) => void memory.set(k, v), remove: async (k) => void memory.delete(k) },
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
  };
}
