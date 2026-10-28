import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, initializeAuth, type Auth } from 'firebase/auth';
// Exporté uniquement par la version React Native d'@firebase/auth (celle que charge Metro), pas par les types web de firebase/auth.
import { getReactNativePersistence } from '@firebase/auth';
import { getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore';

/**
 * Configuration Firebase lue dans app.json › expo.extra.firebase.
 * Ces identifiants ne sont PAS des secrets (ils identifient le projet) : la sécurité repose sur
 * les règles Firestore (firestore.rules), qui isolent les données de chaque compte Google.
 */
export interface FirebaseSettings {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
  storageBucket?: string;
}

type Extra = { firebase?: Partial<FirebaseSettings>; googleWebClientId?: string } | undefined;
const extra = () => Constants.expoConfig?.extra as Extra;

export function getFirebaseSettings(): FirebaseSettings | null {
  const f = extra()?.firebase;
  if (!f?.apiKey || !f.projectId || !f.appId) return null;
  return f as FirebaseSettings;
}

export function getGoogleWebClientId(): string | null {
  return extra()?.googleWebClientId || null;
}

let instance: { app: FirebaseApp; auth: Auth; firestore: Firestore } | null = null;

/** Initialise Firebase une seule fois ; null si l'application n'est pas configurée. */
export function getFirebase(): { app: FirebaseApp; auth: Auth; firestore: Firestore } | null {
  if (instance) return instance;
  const settings = getFirebaseSettings();
  if (!settings) return null;
  const existing = getApps()[0];
  const app = existing ?? initializeApp(settings);
  let auth: Auth;
  let firestore: Firestore;
  if (existing) {
    auth = getAuth(app);
    firestore = getFirestore(app);
  } else {
    // Session conservée entre deux lancements (et accessible à la tâche de fond).
    auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
    // Recommandé pour React Native : détection automatique du « long polling ».
    firestore = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  }
  instance = { app, auth, firestore };
  return instance;
}
