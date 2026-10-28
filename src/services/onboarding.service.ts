import type { Db } from '../db/types';
import { ValidationError } from '../utils/errors';
import { DEFAULT_REFERENCE_CURRENCY, isKnownCurrency } from '../constants/currencies';
import { PRIVACY_POLICY_VERSION } from '../constants/privacy';
import { SETTING_KEYS, getAllSettings, setSetting } from '../repositories/settings.repository';
import { createAccount, type AccountInput } from './account.service';
import { seedDefaultCategories } from './category.service';
import type { Clock } from './clock';

export interface AppSettings {
  /** Devise de référence des totaux, budgets et statistiques. */
  referenceCurrency: string;
  onboardingCompleted: boolean;
  lastBackupAt: string | null;
  /** Politique de confidentialité en vigueur acceptée sur ce téléphone. */
  privacyAccepted: boolean;
  /** Statistiques d'utilisation autorisées (facultatif). */
  analyticsConsent: boolean;
}

export async function loadAppSettings(db: Db): Promise<AppSettings> {
  const s = await getAllSettings(db);
  const privacyAccepted = s[SETTING_KEYS.privacyPolicyVersion] === PRIVACY_POLICY_VERSION;
  return {
    referenceCurrency: isKnownCurrency(s[SETTING_KEYS.referenceCurrency]) ? s[SETTING_KEYS.referenceCurrency] : DEFAULT_REFERENCE_CURRENCY,
    onboardingCompleted: s[SETTING_KEYS.onboardingCompleted] === '1',
    lastBackupAt: s[SETTING_KEYS.lastBackupAt] ?? null,
    privacyAccepted,
    // Un accord donné pour une ancienne version de la politique ne vaut plus.
    analyticsConsent: privacyAccepted && s[SETTING_KEYS.analyticsConsent] === '1',
  };
}

export interface OnboardingInput {
  account: AccountInput;
  /** Catégories par défaut retenues (toutes si omis). */
  incomeCategories?: string[];
  expenseCategories?: string[];
}

/** Première utilisation : premier compte + catégories + paramètres, en une seule transaction. */
export async function completeOnboarding(db: Db, input: OnboardingInput, clock: Clock = {}): Promise<void> {
  await db.transaction(async (tx) => {
    const settings = await loadAppSettings(tx);
    if (settings.onboardingCompleted) throw new ValidationError('La configuration initiale est déjà terminée.');
    await createAccount(tx, input.account, clock);
    await seedDefaultCategories(tx, { income: input.incomeCategories, expense: input.expenseCategories }, clock);
    await setSetting(tx, SETTING_KEYS.referenceCurrency, DEFAULT_REFERENCE_CURRENCY);
    await setSetting(tx, SETTING_KEYS.onboardingCompleted, '1');
  });
}
