import { collection, doc, getDocs, orderBy, query, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { getFirebase } from './firebase';
import type { CloudStore, RemoteBackupMeta } from './types';

/**
 * Stockage Firestore :
 *   users/{uid}/backups/{backupId}                 → méta (statut, date, empreinte, résumé)
 *   users/{uid}/backups/{backupId}/chunks/{0000}   → morceaux du fichier (≤ 250 000 caractères)
 * L'accès est limité au propriétaire par firestore.rules.
 */
function db() {
  const fb = getFirebase();
  if (!fb) throw new Error('Sauvegarde en ligne non configurée.');
  return fb.firestore;
}

const backups = (uid: string) => collection(db(), 'users', uid, 'backups');
const chunks = (uid: string, id: string) => collection(db(), 'users', uid, 'backups', id, 'chunks');

function isMeta(v: unknown): v is RemoteBackupMeta {
  const m = v as RemoteBackupMeta;
  return !!m && typeof m.id === 'string' && typeof m.createdAt === 'string' && (m.status === 'complete' || m.status === 'uploading') &&
    typeof m.checksum === 'string' && Number.isInteger(m.chunkCount) && typeof m.encrypted === 'boolean' && !!m.summary;
}

export const firestoreStore: CloudStore = {
  async listBackups(uid) {
    const snap = await getDocs(query(backups(uid), orderBy('createdAt', 'desc')));
    return snap.docs.map((d) => d.data()).filter(isMeta);
  },
  async putMeta(uid, meta) {
    await setDoc(doc(backups(uid), meta.id), { ...meta, status: 'uploading' });
  },
  async putChunk(uid, id, index, data) {
    await setDoc(doc(chunks(uid, id), String(index).padStart(4, '0')), { i: index, data });
  },
  async markComplete(uid, id) {
    await updateDoc(doc(backups(uid), id), { status: 'complete' });
  },
  async getChunks(uid, id) {
    const snap = await getDocs(chunks(uid, id));
    return snap.docs
      .map((d) => d.data() as { i: unknown; data: unknown })
      .filter((c): c is { i: number; data: string } => Number.isInteger(c.i) && typeof c.data === 'string')
      .map((c) => ({ index: c.i, data: c.data }));
  },
  async deleteBackup(uid, id) {
    const snap = await getDocs(chunks(uid, id));
    const batch = writeBatch(db());
    snap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(backups(uid), id));
    await batch.commit();
  },
};
