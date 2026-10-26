import type { Db } from '../db/types';
import type { AccountWithBalance } from '../types';
import { mapAccount, type AccountRow } from '../repositories/accounts.repository';
import { eachDay, todayISO } from '../utils/dates';
import { getReferenceCurrency, loadRateBook } from './rates.service';

/**
 * Solde courant d'un compte = solde initial + entrées − dépenses + transferts reçus − transferts envoyés,
 * dans la devise du compte. Toujours calculé à la volée à partir des transactions : aucun solde n'est stocké.
 */
const BALANCE_SQL = `
  SELECT a.*,
    a.initial_balance
    + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.type = 'income'   AND t.account_id    = a.id), 0)
    - COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.type = 'expense'  AND t.account_id    = a.id), 0)
    + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.type = 'transfer' AND t.to_account_id = a.id), 0)
    - COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.type = 'transfer' AND t.account_id    = a.id), 0)
    AS balance
  FROM accounts a`;

export async function getAccountsWithBalances(db: Db, includeArchived = true): Promise<AccountWithBalance[]> {
  const rows = await db.all<AccountRow & { balance: number }>(
    `${BALANCE_SQL} ${includeArchived ? '' : 'WHERE a.archived = 0'} ORDER BY a.archived ASC, a.id ASC`,
  );
  return rows.map((r) => ({ ...mapAccount(r), balance: r.balance }));
}

export async function getAccountBalance(db: Db, accountId: number): Promise<number | null> {
  const row = await db.first<{ balance: number }>(`SELECT balance FROM (${BALANCE_SQL}) WHERE id = ?`, [accountId]);
  return row ? row.balance : null;
}

export interface CurrencyBalance {
  currency: string;
  /** Somme des soldes des comptes actifs dans cette devise (aucune conversion). */
  amount: number;
  /** Même montant converti dans la devise de référence, ou null si aucun taux n'est applicable. */
  converted: number | null;
}

export interface GlobalBalance {
  /** Devise de référence de `total`. */
  currency: string;
  /** Somme des soldes convertis (les devises sans taux applicable sont exclues, voir `excluded`). */
  total: number;
  byCurrency: CurrencyBalance[];
  /** Soldes non nuls exclus du total faute de taux de change (montants dans leur devise d'origine). */
  excluded: { currency: string; amount: number }[];
}

/**
 * Solde global = soldes des comptes ACTIFS (négatifs inclus), regroupés par devise puis convertis
 * dans la devise de référence au taux en vigueur à `asOf`. Jamais de somme directe entre devises.
 */
export async function getGlobalBalance(db: Db, asOf: string = todayISO()): Promise<GlobalBalance> {
  const [accounts, reference, book] = await Promise.all([getAccountsWithBalances(db, false), getReferenceCurrency(db), loadRateBook(db)]);
  const sums = new Map<string, number>();
  for (const a of accounts) sums.set(a.currency, (sums.get(a.currency) ?? 0) + a.balance);

  const byCurrency: CurrencyBalance[] = [...sums.entries()]
    .sort(([a], [b]) => (a === reference ? -1 : b === reference ? 1 : a.localeCompare(b)))
    .map(([currency, amount]) => ({ currency, amount, converted: book.convert(amount, currency, reference, asOf) }));
  return {
    currency: reference,
    total: byCurrency.reduce((s, b) => s + (b.converted ?? 0), 0),
    byCurrency,
    excluded: byCurrency.filter((b) => b.converted === null).map((b) => ({ currency: b.currency, amount: b.amount })),
  };
}

export interface BalancePoint {
  date: string;
  balance: number;
}

/** Variation nette d'un jour sur le solde d'une devise (comptes actifs). */
export interface BalanceDelta {
  date: string;
  delta: number;
}

/**
 * Reconstitue le solde jour par jour (inclusif) à partir des variations quotidiennes d'UNE devise.
 * Le solde initial d'un compte entre en vigueur à sa date de référence.
 */
export function buildBalanceSeries(deltas: BalanceDelta[], from: string, to: string): BalancePoint[] {
  let running = 0;
  const byDate = new Map<string, number>();
  for (const d of deltas) {
    if (d.date < from) running += d.delta;
    else if (d.date <= to) byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.delta);
  }
  return eachDay(from, to).map((date) => {
    running += byDate.get(date) ?? 0;
    return { date, balance: running };
  });
}

export async function getBalanceDeltas(db: Db, upTo: string): Promise<(BalanceDelta & { currency: string })[]> {
  return db.all<BalanceDelta & { currency: string }>(
    `SELECT date, currency, SUM(delta) AS delta FROM (
       SELECT a.reference_date AS date, a.currency AS currency, a.initial_balance AS delta
         FROM accounts a WHERE a.archived = 0
       UNION ALL
       SELECT t.date, a.currency, CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE a.archived = 0 AND t.type IN ('income', 'expense')
       UNION ALL
       SELECT t.date, a.currency, -t.amount
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE a.archived = 0 AND t.type = 'transfer'
       UNION ALL
       SELECT t.date, a.currency, t.amount
         FROM transactions t JOIN accounts a ON a.id = t.to_account_id
         WHERE a.archived = 0 AND t.type = 'transfer'
     ) WHERE date <= ? GROUP BY date, currency ORDER BY date`,
    [upTo],
  );
}

export interface BalanceHistory {
  currency: string;
  points: BalancePoint[];
  /** Devises dont le solde n'a pas pu être converti certains jours (taux manquant) : exclues ces jours-là. */
  missingCurrencies: string[];
}

/**
 * Évolution du solde global dans la devise de référence : à chaque date, le solde réel de chaque devise
 * est converti au taux en vigueur CE JOUR-LÀ. Le dernier point égale donc le solde global affiché.
 */
export async function getBalanceHistoryDetailed(db: Db, from: string, to: string): Promise<BalanceHistory> {
  const [deltas, reference, book] = await Promise.all([getBalanceDeltas(db, to), getReferenceCurrency(db), loadRateBook(db)]);
  const currencies = [...new Set(deltas.map((d) => d.currency))];
  const series = new Map(currencies.map((c) => [c, buildBalanceSeries(deltas.filter((d) => d.currency === c), from, to)]));
  const missing = new Set<string>();
  const days = eachDay(from, to);
  const points = days.map((date, i) => {
    let total = 0;
    for (const c of currencies) {
      const amount = series.get(c)![i].balance;
      const converted = book.convert(amount, c, reference, date);
      if (converted === null) missing.add(c);
      else total += converted;
    }
    return { date, balance: total };
  });
  return { currency: reference, points, missingCurrencies: [...missing].sort() };
}

export async function getBalanceHistory(db: Db, from: string, to: string): Promise<BalancePoint[]> {
  return (await getBalanceHistoryDetailed(db, from, to)).points;
}
