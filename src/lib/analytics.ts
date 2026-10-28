import { getAnalytics, logEvent, setAnalyticsCollectionEnabled } from '@react-native-firebase/analytics';

/*
 * Statistiques d'utilisation (Google Analytics pour Firebase).
 * - Collecte coupée par défaut (firebase.json) : AppProvider ne l'active qu'avec l'accord enregistré.
 * - Événements sans paramètres : impossible d'y glisser un montant ou un nom de compte, de catégorie…
 * - Sans le module natif (Expo Go), les appels échouent en silence et l'application fonctionne normalement.
 * - Navigateur : voir analytics.web.ts.
 */

/** Événements personnalisés. Firebase compte déjà seul les installations, sessions et utilisateurs actifs. */
export type AnalyticsEvent = 'onboarding_complete';

export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  try {
    await setAnalyticsCollectionEnabled(getAnalytics(), enabled);
  } catch {
    /* module natif absent (Expo Go) */
  }
}

export function trackEvent(name: AnalyticsEvent): void {
  try {
    logEvent(getAnalytics(), name);
  } catch {
    /* module natif absent (Expo Go) */
  }
}
