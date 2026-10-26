import { ValidationError } from './errors';
import { getCurrency } from '../constants/currencies';

/** Plafond de sécurité : reste très en dessous de Number.MAX_SAFE_INTEGER. */
export const MAX_AMOUNT = 1_000_000_000_000;

const NBSP = '\u00A0';

/** Regroupe les milliers : 25000 -> « 25 000 » (espace insécable, convention française). */
export function formatNumber(n: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(Math.trunc(n)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** 25000 -> « 25 000 FCFA ». */
export function formatFCFA(n: number): string {
  return `${formatNumber(n)}${NBSP}FCFA`;
}

/** Variation signée : +25 000 FCFA / -3 000 FCFA / 0 FCFA. */
export function formatSignedFCFA(n: number): string {
  if (n > 0) return `+${formatFCFA(n)}`;
  return formatFCFA(n);
}

/**
 * Convertit une saisie utilisateur en entier de FCFA.
 * Accepte les espaces (y compris insécables) et le suffixe « FCFA ».
 * Retourne null pour tout ce qui n'est pas un entier positif ou nul (décimaux, négatifs, texte).
 */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/fcfa|f\s*cfa/gi, '').replace(/[\s\u00A0\u202F]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : null;
}

/** Montant d'opération : entier strictement positif, borné. */
export function assertValidAmount(amount: unknown): asserts amount is number {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || !Number.isInteger(amount)) {
    throw new ValidationError('Le montant doit être un nombre entier de FCFA.');
  }
  if (amount <= 0) throw new ValidationError('Le montant doit être supérieur à 0.');
  if (amount > MAX_AMOUNT) throw new ValidationError('Le montant est trop élevé.');
}

/** Solde initial : entier relatif (un compte peut démarrer à découvert), borné. */
export function assertValidBalance(balance: unknown): asserts balance is number {
  if (typeof balance !== 'number' || !Number.isFinite(balance) || !Number.isInteger(balance)) {
    throw new ValidationError('Le solde doit être un nombre entier de FCFA.');
  }
  if (Math.abs(balance) > MAX_AMOUNT) throw new ValidationError('Le solde est trop élevé.');
}

/** Pourcentage entier de `part` sur `total` (calcul d'affichage uniquement). */
export function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part * 100) / total);
}

/** Saisie d'un solde pouvant être négatif (« -5 000 »). Même rigueur que parseAmount. */
export function parseSignedAmount(input: string): number | null {
  const trimmed = input.trim();
  const negative = /^[-−–]/.test(trimmed);
  const n = parseAmount(negative ? trimmed.slice(1) : trimmed);
  if (n === null) return null;
  return negative ? -n : n;
}

/** Format compact pour les axes de graphiques : 25 000 -> « 25 k », 1 200 000 -> « 1,2 M ». */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const trim = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000)} M`;
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000)} k`;
  return `${sign}${abs}`;
}

// ---------------------------------------------------------------------------------------------
// Montants multi-devises : entiers de la plus petite unité de chaque devise (XOF : franc ; EUR : centime).
// ---------------------------------------------------------------------------------------------
/** 1250 EUR(centimes) -> « 12,50 € » ; 25000 XOF -> « 25 000 FCFA » ; 5 GBP(pence) -> « 0,05 £ ». */
export function formatMoney(amount: number, currency: string): string {
  const cur = getCurrency(currency);
  return `${formatPlainAmount(amount, currency, true)}${NBSP}${cur.symbol}`;
}

export function formatSignedMoney(amount: number, currency: string): string {
  return amount > 0 ? `+${formatMoney(amount, currency)}` : formatMoney(amount, currency);
}

/** Nombre sans symbole (« 12,50 »). `grouped` ajoute les espaces des milliers. */
export function formatPlainAmount(amount: number, currency: string, grouped = false): string {
  const { exponent } = getCurrency(currency);
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(amount));
  const digits = String(abs).padStart(exponent + 1, '0');
  const int = digits.slice(0, digits.length - exponent);
  const frac = exponent > 0 ? digits.slice(-exponent) : '';
  const intText = grouped ? int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP) : int;
  return `${sign}${intText}${exponent > 0 ? ',' + frac : ''}`;
}

/** Libellé court de la devise (« FCFA », « € », « USD »…). */
export function currencySymbol(currency: string): string {
  return getCurrency(currency).symbol;
}

/**
 * Saisie d'un montant dans une devise -> entier de la plus petite unité, ou null si invalide.
 * Accepte « 12,5 », « 12.50 », « 1 250 » ; refuse plus de décimales que la devise n'en admet,
 * les négatifs et le texte. Aucun flottant n'intervient.
 */
export function parseMoneyInput(input: string, currency: string): number | null {
  const { exponent } = getCurrency(currency);
  const cleaned = input.replace(/fcfa|f\s*cfa/gi, '').replace(/[\s\u00A0\u202F]/g, '');
  const m = /^(\d+)(?:[.,](\d*))?$/.exec(cleaned);
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > exponent) return null;
  const n = Number(m[1] + frac.padEnd(exponent, '0'));
  return Number.isSafeInteger(n) ? n : null;
}

/** Comme parseMoneyInput mais accepte un signe « - » (soldes initiaux à découvert). */
export function parseSignedMoneyInput(input: string, currency: string): number | null {
  const t = input.trim();
  const negative = /^[-−–]/.test(t);
  const n = parseMoneyInput(negative ? t.slice(1) : t, currency);
  if (n === null) return null;
  return negative ? -n : n;
}
