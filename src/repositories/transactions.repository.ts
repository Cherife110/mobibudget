import type { Db, SqlParam } from '../db/types';
import type { Transaction, TransactionDetail, TransactionType } from '../types';

export interface TransactionRow {
  id: number;
  type: TransactionType;
  amount: number;
  account_id: number;
  to_account_id: number | null;
  category_id: number | null;
  description: string | null;
  date: string;
  created_at: string;
  updated_at: string;
}

interface DetailRow extends TransactionRow {
  account_name: string;
  to_account_name: string | null;
  category_name: string | null;
}

export function mapTransaction(r: TransactionRow): Transaction {
  return {
    id: r.id,
    type: r.type,
    amount: r.amount,
    accountId: r.account_id,
    toAccountId: r.to_account_id,
    categoryId: r.category_id,
    description: r.description,
    date: r.date,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapDetail(r: DetailRow): TransactionDetail {
  return {
    ...mapTransaction(r),
    accountName: r.account_name,
    toAccountName: r.to_account_name,
    categoryName: r.category_name,
  };
}

export interface NewTransaction {
  type: TransactionType;
  amount: number;
  accountId: number;
  toAccountId: number | null;
  categoryId: number | null;
  description: string | null;
  date: string;
}

export async function getTransactionRow(db: Db, id: number): Promise<Transaction | null> {
  const row = await db.first<TransactionRow>('SELECT * FROM transactions WHERE id = ?', [id]);
  return row ? mapTransaction(row) : null;
}

export async function insertTransaction(db: Db, t: NewTransaction, now: string): Promise<number> {
  const r = await db.run(
    `INSERT INTO transactions (type, amount, account_id, to_account_id, category_id, description, date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [t.type, t.amount, t.accountId, t.toAccountId, t.categoryId, t.description, t.date, now, now],
  );
  return r.lastInsertRowId;
}

export async function updateTransactionRow(db: Db, id: number, t: NewTransaction, now: string): Promise<void> {
  await db.run(
    `UPDATE transactions SET type = ?, amount = ?, account_id = ?, to_account_id = ?, category_id = ?,
       description = ?, date = ?, updated_at = ? WHERE id = ?`,
    [t.type, t.amount, t.accountId, t.toAccountId, t.categoryId, t.description, t.date, now, id],
  );
}

export async function deleteTransactionRow(db: Db, id: number): Promise<number> {
  const r = await db.run('DELETE FROM transactions WHERE id = ?', [id]);
  return r.changes;
}

export interface TransactionFilter {
  from?: string;
  to?: string;
  type?: TransactionType;
  /** Compte source OU destination. */
  accountId?: number;
  categoryId?: number;
  /** Recherche libre (description, catégorie, comptes). */
  search?: string;
  limit?: number;
  offset?: number;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

function buildWhere(f: TransactionFilter): { sql: string; params: SqlParam[] } {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.from) {
    where.push('t.date >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('t.date <= ?');
    params.push(f.to);
  }
  if (f.type) {
    where.push('t.type = ?');
    params.push(f.type);
  }
  if (f.accountId !== undefined) {
    where.push('(t.account_id = ? OR t.to_account_id = ?)');
    params.push(f.accountId, f.accountId);
  }
  if (f.categoryId !== undefined) {
    where.push('t.category_id = ?');
    params.push(f.categoryId);
  }
  const q = f.search?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(
      `(t.description LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR a2.name LIKE ? ESCAPE '\\')`,
    );
    params.push(like, like, like, like);
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

const FROM_JOINS = `FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts a2 ON a2.id = t.to_account_id
  LEFT JOIN categories c ON c.id = t.category_id`;

export async function queryTransactions(db: Db, f: TransactionFilter = {}): Promise<TransactionDetail[]> {
  const { sql, params } = buildWhere(f);
  const limit = f.limit ?? 500;
  const offset = f.offset ?? 0;
  const rows = await db.all<DetailRow>(
    `SELECT t.*, a.name AS account_name, a2.name AS to_account_name, c.name AS category_name
     ${FROM_JOINS} ${sql}
     ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map(mapDetail);
}

export interface FilterSummary {
  count: number;
  income: number;
  expense: number;
}

/** Totaux du filtre : les transferts sont comptés dans `count` mais jamais dans entrées/dépenses. */
export async function summarizeTransactions(db: Db, f: TransactionFilter = {}): Promise<FilterSummary> {
  const { sql, params } = buildWhere(f);
  const row = await db.first<{ n: number; income: number | null; expense: number | null }>(
    `SELECT COUNT(*) AS n,
       SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END) AS income,
       SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) AS expense
     ${FROM_JOINS} ${sql}`,
    params,
  );
  return { count: row?.n ?? 0, income: row?.income ?? 0, expense: row?.expense ?? 0 };
}

export async function getTransactionDetail(db: Db, id: number): Promise<TransactionDetail | null> {
  const row = await db.first<DetailRow>(
    `SELECT t.*, a.name AS account_name, a2.name AS to_account_name, c.name AS category_name
     ${FROM_JOINS} WHERE t.id = ?`,
    [id],
  );
  return row ? mapDetail(row) : null;
}
