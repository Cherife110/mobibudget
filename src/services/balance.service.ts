import type { Db } from '../db/types';
import type { AccountWithBalance } from '../types';
import { mapAccount, type AccountRow } from '../repositories/accounts.repository';
import { eachDay } from '../utils/dates';

/**
 * Solde courant = solde initial + entrées − dépenses + transferts reçus − transferts envoyés.
 * Toujours calculé à la volée à partir des transactions : aucun solde n'est stocké.
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

/** Solde global = somme des soldes courants des comptes ACTIFS (les soldes négatifs comptent). */
export async function getGlobalBalance(db: Db): Promise<number> {
  const accounts = await getAccountsWithBalances(db, false);
  return accounts.reduce((sum, a) => sum + a.balance, 0);
}

export interface BalancePoint {
  date: string;
  balance: number;
}

/** Variation nette d'un jour sur le solde global (comptes actifs). */
export interface BalanceDelta {
  date: string;
  delta: number;
}

/**
 * Reconstitue le solde global jour par jour (inclusif) à partir des variations quotidiennes.
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

export async function getBalanceDeltas(db: Db, upTo: string): Promise<BalanceDelta[]> {
  return db.all<BalanceDelta>(
    `SELECT date, SUM(delta) AS delta FROM (
       SELECT a.reference_date AS date, a.initial_balance AS delta
         FROM accounts a WHERE a.archived = 0
       UNION ALL
       SELECT t.date, CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE a.archived = 0 AND t.type IN ('income', 'expense')
       UNION ALL
       SELECT t.date, -t.amount
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE a.archived = 0 AND t.type = 'transfer'
       UNION ALL
       SELECT t.date, t.amount
         FROM transactions t JOIN accounts a ON a.id = t.to_account_id
         WHERE a.archived = 0 AND t.type = 'transfer'
     ) WHERE date <= ? GROUP BY date ORDER BY date`,
    [upTo],
  );
}

/** Évolution réelle du solde global : solde reconstitué à la fin de chaque jour. */
export async function getBalanceHistory(db: Db, from: string, to: string): Promise<BalancePoint[]> {
  const deltas = await getBalanceDeltas(db, to);
  return buildBalanceSeries(deltas, from, to);
}

