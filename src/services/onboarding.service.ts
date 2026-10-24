import type { Db } from '../db/types';
import { ValidationError } from '../utils/errors';
import { CURRENCY_CODE } from '../constants/defaults';
import { SETTING_KEYS, getAllSettings, setSetting } from '../repositories/settings.repository';
import { createAccount, type AccountInput } from './account.service';
import { seedDefaultCategories } from './category.service';
import type { Clock } from './clock';

export interface AppSettings {
  currency: string;
  onboardingCompleted: boolean;
  lastBackupAt: string | null;
}

export async function loadAppSettings(db: Db): Promise<AppSettings> {
  const s = await getAllSettings(db);
  return {
    currency: s[SETTING_KEYS.currency] ?? CURRENCY_CODE,
    onboardingCompleted: s[SETTING_KEYS.onboardingCompleted] === '1',
    lastBackupAt: s[SETTING_KEYS.lastBackupAt] ?? null,
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
    await setSetting(tx, SETTING_KEYS.currency, CURRENCY_CODE);
    await setSetting(tx, SETTING_KEYS.onboardingCompleted, '1');
  });
}
