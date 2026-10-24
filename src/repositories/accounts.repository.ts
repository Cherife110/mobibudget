import type { Db } from '../db/types';
import type { Account, AccountType } from '../types';

export interface AccountRow {
  id: number;
  name: string;
  type: AccountType;
  initial_balance: number;
  reference_date: string;
  archived: number;
  created_at: string;
  updated_at: string;
}

export function mapAccount(r: AccountRow): Account {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    initialBalance: r.initial_balance,
    referenceDate: r.reference_date,
    archived: r.archived === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listAccounts(db: Db, includeArchived = true): Promise<Account[]> {
  const rows = await db.all<AccountRow>(
    `SELECT * FROM accounts ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY archived ASC, id ASC`,
  );
  return rows.map(mapAccount);
}

export async function getAccount(db: Db, id: number): Promise<Account | null> {
  const row = await db.first<AccountRow>('SELECT * FROM accounts WHERE id = ?', [id]);
  return row ? mapAccount(row) : null;
}

export async function insertAccount(
  db: Db,
  a: { name: string; type: AccountType; initialBalance: number; referenceDate: string },
  now: string,
): Promise<number> {
  const r = await db.run(
    `INSERT INTO accounts (name, type, initial_balance, reference_date, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
    [a.name, a.type, a.initialBalance, a.referenceDate, now, now],
  );
  return r.lastInsertRowId;
}

export async function updateAccountRow(
  db: Db,
  id: number,
  a: { name: string; type: AccountType; initialBalance: number; referenceDate: string },
  now: string,
): Promise<void> {
  await db.run(
    `UPDATE accounts SET name = ?, type = ?, initial_balance = ?, reference_date = ?, updated_at = ? WHERE id = ?`,
    [a.name, a.type, a.initialBalance, a.referenceDate, now, id],
  );
}

export async function setAccountArchived(db: Db, id: number, archived: boolean, now: string): Promise<void> {
  await db.run('UPDATE accounts SET archived = ?, updated_at = ? WHERE id = ?', [archived ? 1 : 0, now, id]);
}

/** Date de la plus ancienne transaction touchant ce compte (source ou destination). */
export async function earliestTransactionDate(db: Db, accountId: number): Promise<string | null> {
  const row = await db.first<{ d: string | null }>(
    'SELECT MIN(date) AS d FROM transactions WHERE account_id = ? OR to_account_id = ?',
    [accountId, accountId],
  );
  return row?.d ?? null;
}
