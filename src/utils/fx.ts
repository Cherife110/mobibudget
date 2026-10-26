import { ValidationError } from './errors';
import { getCurrency } from '../constants/currencies';
import { formatNumber } from './money';

/**
 * Taux de change : entiers « mis à l'échelle » 10^8 (8 décimales). Aucun flottant :
 * la conversion utilise l'arithmétique BigInt puis un arrondi « au plus proche, moitié vers l'extérieur ».
 *
 * Un taux « 1 FROM = r TO » est exprimé en unités principales (1 EUR = 655,957 XOF),
 * la conversion tient compte des décimales propres à chaque devise.
 */
export const RATE_SCALE = 100_000_000;
export const RATE_SCALE_DIGITS = 8;
/** Taux maximal accepté : 10 000 000 (reste sous Number.MAX_SAFE_INTEGER une fois mis à l'échelle). */
export const RATE_MAX_SCALED = 10_000_000 * RATE_SCALE;

/** « 655,957 » ou « 655.957 » -> 65595700000 ; null si invalide (texte, négatif, nul, >8 décimales, trop grand). */
export function parseRate(input: string): number | null {
  const cleaned = input.replace(/[\s\u00A0\u202F]/g, '');
  const m = /^(\d+)(?:[.,](\d{0,8}))?$/.exec(cleaned);
  if (!m) return null;
  const scaled = Number(m[1]) * RATE_SCALE + Number((m[2] ?? '').padEnd(RATE_SCALE_DIGITS, '0'));
  if (!Number.isSafeInteger(scaled) || scaled <= 0 || scaled > RATE_MAX_SCALED) return null;
  return scaled;
}

/** 65595700000 -> « 655,957 » (décimales utiles seulement). */
export function formatRate(scaled: number): string {
  const int = Math.floor(scaled / RATE_SCALE);
  const frac = String(scaled % RATE_SCALE).padStart(RATE_SCALE_DIGITS, '0').replace(/0+$/, '');
  return formatNumber(int) + (frac ? ',' + frac : '');
}

export function assertValidRate(scaled: unknown): asserts scaled is number {
  if (typeof scaled !== 'number' || !Number.isSafeInteger(scaled) || scaled <= 0 || scaled > RATE_MAX_SCALED) {
    throw new ValidationError('Le taux de change est invalide (nombre positif, 8 décimales maximum).');
  }
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

/**
 * Convertit un montant (plus petite unité de `from`) vers la plus petite unité de `to`.
 * `inverse` = vrai si le taux enregistré est exprimé dans le sens opposé (to -> from) :
 * on divise alors par le taux au lieu de le multiplier (pas de perte par inversion préalable).
 */
export function convertMinor(amount: number, from: string, to: string, rateScaled: number, inverse: boolean): number {
  if (from === to) return amount;
  const diff = getCurrency(to).exponent - getCurrency(from).exponent;
  let num = BigInt(amount) * (inverse ? BigInt(RATE_SCALE) : BigInt(rateScaled));
  let den = inverse ? BigInt(rateScaled) : BigInt(RATE_SCALE);
  if (diff >= 0) num *= pow10(diff);
  else den *= pow10(-diff);
  const negative = num < 0n;
  const absNum = negative ? -num : num;
  const q = (2n * absNum + den) / (2n * den); // arrondi au plus proche, moitié vers l'extérieur
  const result = negative ? -q : q;
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ValidationError('Le montant converti est trop grand.');
  }
  return Number(result);
}

export interface RateEntry {
  fromCurrency: string;
  toCurrency: string;
  rateScaled: number;
  effectiveDate: string;
}

/**
 * Carnet de taux : retrouve le taux en vigueur à une date donnée.
 * Règle : on prend le taux le plus récent dont la date d'effet est ≤ à la date de l'opération,
 * dans le sens direct ou inverse. Aucune triangulation automatique, aucun taux « futur » :
 * s'il n'y a pas de taux applicable, la conversion est impossible (null).
 */
export class RateBook {
  private readonly byPair = new Map<string, RateEntry[]>();

  constructor(rates: RateEntry[]) {
    for (const r of rates) {
      const key = `${r.fromCurrency}>${r.toCurrency}`;
      const list = this.byPair.get(key) ?? [];
      list.push(r);
      this.byPair.set(key, list);
    }
    for (const list of this.byPair.values()) list.sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0));
  }

  private latest(from: string, to: string, date: string): RateEntry | null {
    const list = this.byPair.get(`${from}>${to}`);
    if (!list) return null;
    let found: RateEntry | null = null;
    for (const r of list) {
      if (r.effectiveDate <= date) found = r;
      else break;
    }
    return found;
  }

  find(from: string, to: string, date: string): { rateScaled: number; inverse: boolean; effectiveDate: string } | null {
    const direct = this.latest(from, to, date);
    const inverse = this.latest(to, from, date);
    if (direct && (!inverse || direct.effectiveDate >= inverse.effectiveDate)) {
      return { rateScaled: direct.rateScaled, inverse: false, effectiveDate: direct.effectiveDate };
    }
    if (inverse) return { rateScaled: inverse.rateScaled, inverse: true, effectiveDate: inverse.effectiveDate };
    return null;
  }

  /** Montant converti, ou null si aucun taux n'est applicable à cette date (un montant nul reste 0). */
  convert(amount: number, from: string, to: string, date: string): number | null {
    if (from === to || amount === 0) return amount;
    const r = this.find(from, to, date);
    return r ? convertMinor(amount, from, to, r.rateScaled, r.inverse) : null;
  }
}
