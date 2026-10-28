import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import type { Db } from '../db/types';
import type { CloudDeps } from '../services/cloudBackup.service';
import { googleCloudAuth } from './googleAuth';
import { firestoreStore } from './firestoreStore';
import type { NetworkState, SecretStore } from './types';

export async function currentNetwork(): Promise<NetworkState> {
  const s = await NetInfo.fetch();
  return { online: !!s.isConnected && s.isInternetReachable !== false, wifi: s.type === 'wifi' };
}

/** Android Keystore : la clé de chiffrement ne quitte jamais le téléphone. */
export const secureSecrets: SecretStore = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  remove: (k) => SecureStore.deleteItemAsync(k),
};

/** Copie de sécurité locale (Documents/securite/) avant une restauration qui remplace des données. */
export async function saveSafetySnapshot(fileName: string, text: string): Promise<void> {
  const dir = new Directory(Paths.document, 'securite');
  if (!dir.exists) dir.create();
  const file = new File(dir, fileName);
  file.create({ overwrite: true });
  await file.write(text);
}

export function buildCloudDeps(db: Db): CloudDeps {
  return {
    db,
    store: firestoreStore,
    auth: googleCloudAuth,
    network: currentNetwork,
    secrets: secureSecrets,
    random: (n) => Crypto.getRandomBytes(n),
    saveSafetySnapshot,
  };
}
