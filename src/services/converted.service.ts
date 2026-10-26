import type { Db } from '../db/types';
import type { RateBook } from '../utils/fx';
import { getReferenceCurrency, loadRateBook } from './rates.service';

/**
 * Opérations (entrées/dépenses) exprimées dans la devise de référence.
 *
 * Chaque opération est convertie INDIVIDUELLEMENT, au taux en vigueur à SA date (jamais à la date du jour) :
 * - les montants d'origine ne sont jamais modifiés ;
 * - tous les écrans (totaux, catégories, budgets, graphiques) additionnent exactement les mêmes valeurs
 *   arrondies, donc ils restent cohérents entre eux ;
 * - sans taux applicable, `converted` vaut null : l'opération est EXCLUE des totaux et signalée.
 */
export interface ConvertedRow {
  id: number;
  type: 'income' | 'expense';
  date: string;
  categoryId: number;
  categoryName: string;
  accountId: number;
  currency: string;
  /** Montant d'origine (plus petite unité de `currency`). */
  amount: number;
  /** Montant dans la devise de référence, ou null si aucun taux n'est applicable. */
  converted: number | null;
}

export interface Exclusions {
  /** Nombre d'opérations exclues faute de taux. */
  count: number;
  /** Devises concernées (triées). */
  currencies: string[];
}

export interface ConvertedData {
  reference: string;
  book: RateBook;
  rows: ConvertedRow[];
}

export async function loadConvertedRows(db: Db, from: string, to: string): Promise<ConvertedData> {
  const [reference, book] = await Promise.all([getReferenceCurrency(db), loadRateBook(db)]);
  const raw = await db.all<{
    id: number;
    type: 'income' | 'expense';
    date: string;
    category_id: number;
    category_name: string;
    account_id: number;
    currency: string;
    amount: number;
  }>(
    `SELECT t.id, t.type, t.date, t.category_id, c.name AS category_name, t.account_id, a.currency, t.amount
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     JOIN categories c ON c.id = t.category_id
     WHERE t.type IN ('income', 'expense') AND t.date >= ? AND t.date <= ?
     ORDER BY t.date ASC, t.id ASC`,
    [from, to],
  );
  const rows = raw.map<ConvertedRow>((r) => ({
    id: r.id,
    type: r.type,
    date: r.date,
    categoryId: r.category_id,
    categoryName: r.category_name,
    accountId: r.account_id,
    currency: r.currency,
    amount: r.amount,
    converted: book.convert(r.amount, r.currency, reference, r.date),
  }));
  return { reference, book, rows };
}

export function exclusionsOf(rows: ConvertedRow[]): Exclusions {
  const missing = rows.filter((r) => r.converted === null);
  return { count: missing.length, currencies: [...new Set(missing.map((r) => r.currency))].sort() };
}

/** Opérations de la période exclues des totaux faute de taux de change (pour afficher l'avertissement). */
export async function getExclusions(db: Db, from: string, to: string): Promise<Exclusions> {
  return exclusionsOf((await loadConvertedRows(db, from, to)).rows);
}
