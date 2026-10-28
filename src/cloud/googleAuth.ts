import {
  GoogleAuthProvider, deleteUser, onAuthStateChanged, reauthenticateWithCredential, signInWithCredential, signOut, type User,
} from 'firebase/auth';
import { getFirebase, getGoogleWebClientId } from './firebase';
import type { CloudAuth, CloudUser } from './types';

type GoogleSigninModule = typeof import('@react-native-google-signin/google-signin');

/**
 * Chargé à la demande : son module natif n'existe pas dans Expo Go, où un import direct
 * ferait planter l'application dès le démarrage, même en mode hors ligne.
 */
function googleSignin(): GoogleSigninModule['GoogleSignin'] {
  return (require('@react-native-google-signin/google-signin') as GoogleSigninModule).GoogleSignin;
}

export class SignInCancelled extends Error {
  constructor() {
    super('Connexion annulée.');
    this.name = 'SignInCancelled';
  }
}

const toCloudUser = (u: User | null): CloudUser | null => (u ? { uid: u.uid, email: u.email, displayName: u.displayName } : null);

let configured = false;
function configureGoogle(): GoogleSigninModule['GoogleSignin'] {
  const google = googleSignin();
  if (configured) return google;
  const webClientId = getGoogleWebClientId();
  if (!webClientId) throw new Error('googleWebClientId manquant dans app.json');
  google.configure({ webClientId });
  configured = true;
  return google;
}

/** Connexion Google native : jeton d'identité à transmettre à Firebase. */
async function googleIdToken(): Promise<string> {
  const google = configureGoogle();
  await google.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await google.signIn();
  if (res.type !== 'success') throw new SignInCancelled();
  const idToken = res.data.idToken;
  if (!idToken) throw new Error('Google n\'a pas fourni de jeton d\'identité (vérifiez googleWebClientId).');
  return idToken;
}

/** Connexion Google native (Android) puis session Firebase Authentication. */
export const googleCloudAuth: CloudAuth = {
  isConfigured: () => !!getFirebase() && !!getGoogleWebClientId(),
  ready: async () => {
    await getFirebase()?.auth.authStateReady();
  },
  currentUser: () => toCloudUser(getFirebase()?.auth.currentUser ?? null),
  subscribe: (listener) => {
    const fb = getFirebase();
    if (!fb) return () => {};
    return onAuthStateChanged(fb.auth, (u) => listener(toCloudUser(u)));
  },
  async signIn() {
    const fb = getFirebase();
    if (!fb) throw new Error('Sauvegarde en ligne non configurée.');
    const cred = await signInWithCredential(fb.auth, GoogleAuthProvider.credential(await googleIdToken()));
    return toCloudUser(cred.user)!;
  },
  async signOut() {
    const fb = getFirebase();
    if (fb) await signOut(fb.auth);
    try {
      await googleSignin().signOut();
    } catch {
      /* déjà déconnecté côté Google */
    }
  },
  async deleteAccount() {
    const user = getFirebase()?.auth.currentUser;
    if (!user) throw new Error('Aucun compte connecté.');
    try {
      await deleteUser(user);
    } catch (e) {
      // Firebase n'accepte la suppression qu'après une connexion récente : on redemande la connexion Google.
      if ((e as { code?: unknown }).code !== 'auth/requires-recent-login') throw e;
      await reauthenticateWithCredential(user, GoogleAuthProvider.credential(await googleIdToken()));
      await deleteUser(user);
    }
    try {
      // Retire aussi l'accès accordé à MobiBudget dans le compte Google.
      await configureGoogle().revokeAccess();
    } catch {
      /* accès déjà retiré côté Google */
    }
  },
};
