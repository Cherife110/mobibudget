import type { Db } from '../db/types';
import { PRIVACY_POLICY_VERSION } from '../constants/privacy';
import { SETTING_KEYS, setSetting } from '../repositories/settings.repository';
import { nowISO } from '../utils/dates';
import type { Clock } from './clock';

/*
 * Accord de confidentialité : propre à ce téléphone, il n'est ni exporté dans les sauvegardes
 * ni remplacé par une restauration.
 */

/** Acceptation de la politique en vigueur, avec le choix (facultatif) pour les statistiques. */
export async function acceptPrivacyPolicy(db: Db, input: { analyticsConsent: boolean }, clock: Clock = {}): Promise<void> {
  await db.transaction(async (tx) => {
    await setSetting(tx, SETTING_KEYS.privacyPolicyVersion, PRIVACY_POLICY_VERSION);
    await setSetting(tx, SETTING_KEYS.privacyAcceptedAt, nowISO(clock.now));
    await setSetting(tx, SETTING_KEYS.analyticsConsent, input.analyticsConsent ? '1' : '0');
  });
}

/** Accord ou retrait pour les statistiques, depuis les paramètres. */
export async function setAnalyticsConsent(db: Db, enabled: boolean): Promise<void> {
  await setSetting(db, SETTING_KEYS.analyticsConsent, enabled ? '1' : '0');
}
