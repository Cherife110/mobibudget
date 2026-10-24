import type { Db } from '../db/types';
import type { Budget } from '../types';

export interface BudgetRow {
  id: number;
  category_id: number;
  month: string;
  amount: number;
  created_at: string;
  updated_at: string;
}

export function mapBudget(r: BudgetRow): Budget {
  return {
    id: r.id,
    categoryId: r.category_id,
    month: r.month,
    amount: r.amount,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listBudgetsForMonth(db: Db, month: string): Promise<Budget[]> {
  const rows = await db.all<BudgetRow>('SELECT * FROM budgets WHERE month = ? ORDER BY id ASC', [month]);
  return rows.map(mapBudget);
}

export async function getBudget(db: Db, id: number): Promise<Budget | null> {
  const row = await db.first<BudgetRow>('SELECT * FROM budgets WHERE id = ?', [id]);
  return row ? mapBudget(row) : null;
}

/** Crée ou met à jour le plafond d'une catégorie pour un mois (conserve la date de création). */
export async function upsertBudget(
  db: Db,
  b: { categoryId: number; month: string; amount: number },
  now: string,
): Promise<void> {
  await db.run(
    `INSERT INTO budgets (category_id, month, amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(category_id, month) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at`,
    [b.categoryId, b.month, b.amount, now, now],
  );
}

export async function deleteBudgetRow(db: Db, id: number): Promise<number> {
  const r = await db.run('DELETE FROM budgets WHERE id = ?', [id]);
  return r.changes;
}
