/** Contrats entre le moteur de sauvegarde en ligne et la plateforme (Firebase, réseau, stockage sécurisé). */

export interface CloudUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export type RemoteStatus = 'uploading' | 'complete';

export interface RemoteBackupMeta {
  id: string;
  /** Horodatage ISO de création. */
  createdAt: string;
  status: RemoteStatus;
  deviceId: string;
  appVersion: string;
  formatVersion: number;
  encrypted: boolean;
  /** Taille du contenu envoyé (caractères). */
  size: number;
  /** SHA-256 du contenu envoyé : vérifié au téléchargement. */
  checksum: string;
  chunkCount: number;
  summary: { accounts: number; categories: number; transactions: number; budgets: number; exchangeRates: number };
}

/** Stockage distant des sauvegardes d'UN utilisateur (isolé par uid). */
export interface CloudStore {
  listBackups(uid: string): Promise<RemoteBackupMeta[]>;
  /** Écrit la méta « uploading », puis les morceaux, puis passe la méta à « complete ». */
  putMeta(uid: string, meta: RemoteBackupMeta): Promise<void>;
  putChunk(uid: string, backupId: string, index: number, data: string): Promise<void>;
  markComplete(uid: string, backupId: string): Promise<void>;
  getChunks(uid: string, backupId: string): Promise<{ index: number; data: string }[]>;
  deleteBackup(uid: string, backupId: string): Promise<void>;
}

export interface CloudAuth {
  isConfigured(): boolean;
  /** Attend la restauration de la session (l'utilisateur connecté est rechargé au démarrage). */
  ready?(): Promise<void>;
  currentUser(): CloudUser | null;
  /** Abonnement aux changements de connexion ; renvoie la fonction de désabonnement. */
  subscribe?(listener: (user: CloudUser | null) => void): () => void;
  signIn(): Promise<CloudUser>;
  signOut(): Promise<void>;
  /** Supprime le compte de l'utilisateur connecté (peut redemander la connexion Google). */
  deleteAccount(): Promise<void>;
}

export interface NetworkState {
  online: boolean;
  wifi: boolean;
}

/** Stockage sécurisé du téléphone (Android Keystore via expo-secure-store). */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
