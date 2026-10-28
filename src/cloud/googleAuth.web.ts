import type { CloudAuth } from './types';

/** Version navigateur (tests sur PC) : la connexion Google native n'existe pas ; sauvegarde en ligne désactivée. */
export class SignInCancelled extends Error {}

export const googleCloudAuth: CloudAuth = {
  isConfigured: () => false,
  currentUser: () => null,
  async signIn() {
    throw new Error('La sauvegarde en ligne n\'est disponible que dans l\'application Android.');
  },
  async signOut() {},
  async deleteAccount() {
    throw new Error('La sauvegarde en ligne n\'est disponible que dans l\'application Android.');
  },
};
