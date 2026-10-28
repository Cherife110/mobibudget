import { randomBytes } from 'node:crypto';
import type { CloudAuth, CloudStore, CloudUser, NetworkState, RemoteBackupMeta, SecretStore } from '../../src/cloud/types';

type Op = 'listBackups' | 'putMeta' | 'putChunk' | 'markComplete' | 'getChunks' | 'deleteBackup';

/** Faux Firestore en mémoire, isolé par uid, avec injection de pannes. */
export class FakeCloudStore implements CloudStore {
  private users = new Map<string, Map<string, { meta: RemoteBackupMeta; chunks: Map<number, string> }>>();
  private failure: { op: Op; index?: number; code: string } | null = null;

  failNext(op: Op, opts: { index?: number; code?: string } = {}) {
    this.failure = { op, index: opts.index, code: opts.code ?? 'unavailable' };
  }
  private check(op: Op, index?: number) {
    const f = this.failure;
    if (f && f.op === op && (f.index === undefined || f.index === index)) {
      this.failure = null;
      throw Object.assign(new Error(`panne simulée : ${op}`), { code: f.code });
    }
  }
  private space(uid: string) {
    if (!this.users.has(uid)) this.users.set(uid, new Map());
    return this.users.get(uid)!;
  }
  async listBackups(uid: string) {
    this.check('listBackups');
    return [...this.space(uid).values()].map((b) => ({ ...b.meta }));
  }
  async putMeta(uid: string, meta: RemoteBackupMeta) {
    this.check('putMeta');
    this.space(uid).set(meta.id, { meta: { ...meta, status: 'uploading' }, chunks: new Map() });
  }
  async putChunk(uid: string, id: string, index: number, data: string) {
    this.check('putChunk', index);
    this.space(uid).get(id)!.chunks.set(index, data);
  }
  async markComplete(uid: string, id: string) {
    this.check('markComplete');
    this.space(uid).get(id)!.meta.status = 'complete';
  }
  async getChunks(uid: string, id: string) {
    this.check('getChunks');
    const b = this.space(uid).get(id);
    return b ? [...b.chunks.entries()].map(([index, data]) => ({ index, data })) : [];
  }
  async deleteBackup(uid: string, id: string) {
    this.check('deleteBackup');
    this.space(uid).delete(id);
  }
  // outils de test
  rawChunks(uid: string, id: string): string {
    return [...this.space(uid).get(id)!.chunks.entries()].sort(([a], [b]) => a - b).map(([, d]) => d).join('');
  }
  tamper(uid: string, id: string, index: number, data: string | null) {
    const chunks = this.space(uid).get(id)!.chunks;
    if (data === null) chunks.delete(index);
    else chunks.set(index, data);
  }
  count(uid: string) {
    return this.space(uid).size;
  }
}

export class FakeAuth implements CloudAuth {
  user: CloudUser | null = null;
  configured = true;
  /** uid des comptes supprimés. */
  deletedAccounts: string[] = [];
  private deleteFailure: string | null = null;
  constructor(private uid = 'utilisateur-1') {}
  /** Le prochain deleteAccount échoue avec ce code (ex. 'auth/network-request-failed'). */
  failNextDelete(code: string) { this.deleteFailure = code; }
  isConfigured() { return this.configured; }
  currentUser() { return this.user; }
  async signIn() { this.user = { uid: this.uid, email: 'cherife@example.com', displayName: 'Cherife' }; return this.user; }
  async signOut() { this.user = null; }
  async deleteAccount() {
    if (this.deleteFailure) {
      const code = this.deleteFailure;
      this.deleteFailure = null;
      throw Object.assign(new Error('panne simulée : deleteAccount'), { code });
    }
    if (!this.user) throw new Error('aucun compte connecté');
    this.deletedAccounts.push(this.user.uid);
    this.user = null;
  }
}

export class MemorySecrets implements SecretStore {
  values = new Map<string, string>();
  async get(k: string) { return this.values.get(k) ?? null; }
  async set(k: string, v: string) { this.values.set(k, v); }
  async remove(k: string) { this.values.delete(k); }
}

export const nodeRandom = (n: number) => new Uint8Array(randomBytes(n));

export function network(state: Partial<NetworkState> = {}) {
  const s: NetworkState = { online: true, wifi: true, ...state };
  return { state: s, fn: async () => ({ ...s }) };
}
