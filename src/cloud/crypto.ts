import { gcm } from '@noble/ciphers/aes';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { BackupError } from '../services/backup.service';
import { fromBase64, toBase64, toHex, utf8Decode, utf8Encode } from './encoding';

/**
 * Chiffrement FACULTATIF des sauvegardes en ligne.
 * - AES-256-GCM (chiffrement authentifié : toute modification du fichier est détectée).
 * - Clé dérivée du mot de passe par PBKDF2-SHA256 (sel aléatoire de 16 octets).
 * - La clé dérivée (jamais le mot de passe) est conservée dans le stockage sécurisé du téléphone.
 * Sans le mot de passe, une sauvegarde chiffrée est irrécupérable : c'est voulu.
 */
export const KDF_ITERATIONS = 310_000;
export const MIN_PASSWORD_LENGTH = 8;

export type RandomBytes = (length: number) => Uint8Array;

export interface EncryptionKey {
  key: Uint8Array;
  salt: Uint8Array;
  iterations: number;
}

export interface EncryptedEnvelope {
  app: 'MobiBudget';
  kind: 'encrypted-backup';
  v: 1;
  kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string };
  cipher: { name: 'AES-256-GCM'; nonce: string };
  data: string;
}

export function deriveKey(password: string, salt: Uint8Array, iterations: number = KDF_ITERATIONS): EncryptionKey {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new BackupError(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`);
  }
  return { key: pbkdf2(sha256, utf8Encode(password), salt, { c: iterations, dkLen: 32 }), salt, iterations };
}

export function createKey(password: string, random: RandomBytes, iterations: number = KDF_ITERATIONS): EncryptionKey {
  return deriveKey(password, random(16), iterations);
}

export function encryptText(plain: string, k: EncryptionKey, random: RandomBytes): string {
  const nonce = random(12);
  const sealed = gcm(k.key, nonce).encrypt(utf8Encode(plain));
  const envelope: EncryptedEnvelope = {
    app: 'MobiBudget',
    kind: 'encrypted-backup',
    v: 1,
    kdf: { name: 'PBKDF2-SHA256', iterations: k.iterations, salt: toBase64(k.salt) },
    cipher: { name: 'AES-256-GCM', nonce: toBase64(nonce) },
    data: toBase64(sealed),
  };
  return JSON.stringify(envelope);
}

/** Lit l'enveloppe (sans la déchiffrer). Retourne null si le texte n'est pas une sauvegarde chiffrée. */
export function readEnvelope(text: string): EncryptedEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const e = parsed as Partial<EncryptedEnvelope> | null;
  if (!e || e.kind !== 'encrypted-backup') return null;
  if (e.app !== 'MobiBudget' || e.v !== 1 || e.kdf?.name !== 'PBKDF2-SHA256' || e.cipher?.name !== 'AES-256-GCM') {
    throw new BackupError('Sauvegarde chiffrée dans un format non pris en charge.');
  }
  if (!Number.isInteger(e.kdf.iterations) || e.kdf.iterations < 10_000 || e.kdf.iterations > 10_000_000) {
    throw new BackupError('Sauvegarde chiffrée invalide (paramètres de clé).');
  }
  if (typeof e.kdf.salt !== 'string' || typeof e.cipher.nonce !== 'string' || typeof e.data !== 'string') {
    throw new BackupError('Sauvegarde chiffrée invalide.');
  }
  return e as EncryptedEnvelope;
}

/** Déchiffre avec une clé déjà dérivée ou un mot de passe. Mauvais mot de passe ou fichier altéré → BackupError. */
export function decryptEnvelope(e: EncryptedEnvelope, secret: { password: string } | { key: EncryptionKey }): string {
  let salt: Uint8Array;
  let nonce: Uint8Array;
  let data: Uint8Array;
  try {
    salt = fromBase64(e.kdf.salt);
    nonce = fromBase64(e.cipher.nonce);
    data = fromBase64(e.data);
  } catch {
    throw new BackupError('Sauvegarde chiffrée endommagée.');
  }
  const key =
    'password' in secret
      ? deriveKey(secret.password, salt, e.kdf.iterations).key
      : toHex(secret.key.salt) === toHex(salt) && secret.key.iterations === e.kdf.iterations
        ? secret.key.key
        : null;
  if (!key) throw new BackupError('Cette sauvegarde a été chiffrée avec un autre mot de passe.');
  try {
    return utf8Decode(gcm(key, nonce).decrypt(data));
  } catch {
    throw new BackupError('Mot de passe incorrect, ou sauvegarde endommagée.');
  }
}

/** Empreinte SHA-256 (hexadécimal) : intégrité des envois et détection des changements. */
export function sha256Hex(text: string): string {
  return toHex(sha256(utf8Encode(text)));
}

export function serializeKey(k: EncryptionKey): string {
  return JSON.stringify({ key: toBase64(k.key), salt: toBase64(k.salt), iterations: k.iterations });
}

export function parseKey(text: string): EncryptionKey {
  const o = JSON.parse(text) as { key: string; salt: string; iterations: number };
  return { key: fromBase64(o.key), salt: fromBase64(o.salt), iterations: o.iterations };
}
