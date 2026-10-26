import type { Db } from '../db/types';
import type { ExchangeRate } from '../types';
import { DEFAULT_REFERENCE_CURRENCY, isKnownCurrency } from '../constants/currencies';
import { ValidationError } from '../utils/errors';
import { assertValidRate, RateBook } from '../utils/fx';
import { isValidISODate, nowISO, todayISO } from '../utils/dates';
import { deleteRateRow, getRate, listRates, upsertRate } from '../repositories/rates.repository';
import { SETTING_KEYS, getSetting } from '../repositories/settings.repository';
import type { Clock } from './clock';

export interface RateInput {
  fromCurrency: string;
  toCurrency: string;
  /** Taux mis à l'échelle 10^8 (voir `parseRate`). */
  rateScaled: number;
  /** Date d'effet : le taux s'applique aux opérations datées de ce jour ou après (jusqu'au taux suivant). */
  effectiveDate: string;
}

/** Enregistre un taux saisi à la main. Un taux existant pour la même paire et la même date est remplacé. */
export async function saveRate(db: Db, input: RateInput, clock: Clock = {}): Promise<ExchangeRate> {
  const now = clock.now ?? new Date();
  if (!isKnownCurrency(input.fromCurrency) || !isKnownCurrency(input.toCurrency)) {
    throw new ValidationError('Choisissez deux devises valides.');
  }
  if (input.fromCurrency === input.toCurrency) {
    throw new ValidationError('Les deux devises doivent être différentes.');
  }
  assertValidRate(input.rateScaled);
  if (!isValidISODate(input.effectiveDate)) throw new ValidationError("La date d'effet est invalide.");
  if (input.effectiveDate > todayISO(now)) throw new ValidationError("La date d'effet ne peut pas être dans le futur.");
  return db.transaction(async (tx) => {
    const id = await upsertRate(tx, input, nowISO(now));
    return (await getRate(tx, id))!;
  });
}

export async function deleteRate(db: Db, id: number): Promise<void> {
  const changes = await deleteRateRow(db, id);
  if (changes === 0) throw new ValidationError('Taux introuvable.');
}

export { listRates };

/** Carnet de taux courant (lu en une fois, puis interrogé en mémoire). */
export async function loadRateBook(db: Db): Promise<RateBook> {
  return new RateBook(await listRates(db));
}

/** Devise de référence des totaux, budgets et statistiques (XOF par défaut). */
export async function getReferenceCurrency(db: Db): Promise<string> {
  const v = await getSetting(db, SETTING_KEYS.referenceCurrency);
  return v && isKnownCurrency(v) ? v : DEFAULT_REFERENCE_CURRENCY;
}
