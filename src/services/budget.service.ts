import type { Db } from '../db/types';
import type { Budget, BudgetLevel, BudgetStatus } from '../types';
import { ValidationError } from '../utils/errors';
import { assertValidAmount } from '../utils/money';
import { endOfMonth, isValidMonth, nowISO, startOfMonth } from '../utils/dates';
import { getCategory } from '../repositories/categories.repository';
import {
  deleteBudgetRow,
  listBudgetsForMonth,
  upsertBudget,
} from '../repositories/budgets.repository';
import type { Clock } from './clock';

export const WARNING_THRESHOLD_PERCENT = 80;

/** Niveau d'alerte, en arithmétique entière : ≥ 80 % → warning ; ≥ 100 % (atteint ou dépassé) → exceeded. */
export function computeBudgetLevel(spent: number, cap: number): BudgetLevel {
  if (spent >= cap) return 'exceeded';
  if (spent * 100 >= WARNING_THRESHOLD_PERCENT * cap) return 'warning';
  return 'ok';
}

/** Crée ou met à jour le plafond mensuel d'une catégorie de dépense. */
export async function setBudget(
  db: Db,
  input: { categoryId: number; month: string; amount: number },
  clock: Clock = {},
): Promise<void> {
  if (!isValidMonth(input.month)) throw new ValidationError('Le mois est invalide.');
  assertValidAmount(input.amount);
  await db.transaction(async (tx) => {
    const category = await getCategory(tx, input.categoryId);
    if (!category) throw new ValidationError('La catégorie est introuvable.');
    if (category.kind !== 'expense') {
      throw new ValidationError('Un budget ne peut concerner qu\'une catégorie de dépense.');
    }
    await upsertBudget(tx, { categoryId: category.id, month: input.month, amount: input.amount }, nowISO(clock.now));
  });
}

export async function deleteBudget(db: Db, id: number): Promise<void> {
  const changes = await deleteBudgetRow(db, id);
  if (changes === 0) throw new ValidationError('Budget introuvable.');
}

/**
 * Budgets d'un mois avec le total dépensé, calculé à partir des transactions.
 * Les transferts ne comptent jamais (seules les dépenses sont sommées).
 */
export async function getBudgetStatuses(db: Db, month: string): Promise<BudgetStatus[]> {
  if (!isValidMonth(month)) throw new ValidationError('Le mois est invalide.');
  const from = startOfMonth(month);
  const to = endOfMonth(month);
  const rows = await db.all<{
    id: number;
    category_id: number;
    month: string;
    amount: number;
    created_at: string;
    updated_at: string;
    category_name: string;
    spent: number;
  }>(
    `SELECT b.*, c.name AS category_name,
       COALESCE((SELECT SUM(t.amount) FROM transactions t
                 WHERE t.type = 'expense' AND t.category_id = b.category_id AND t.date >= ? AND t.date <= ?), 0) AS spent
     FROM budgets b JOIN categories c ON c.id = b.category_id
     WHERE b.month = ?`,
    [from, to, month],
  );
  const statuses = rows.map<BudgetStatus>((r) => ({
    id: r.id,
    categoryId: r.category_id,
    month: r.month,
    amount: r.amount,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    categoryName: r.category_name,
    spent: r.spent,
    remaining: r.amount - r.spent,
    percent: Math.round((r.spent * 100) / r.amount),
    level: computeBudgetLevel(r.spent, r.amount),
  }));
  // Les budgets à surveiller en premier.
  return statuses.sort((a, b) => b.percent - a.percent || a.categoryName.localeCompare(b.categoryName, 'fr'));
}

/** Reprend les plafonds d'un mois dans un autre (sans écraser ceux déjà définis). Retourne le nombre créé. */
export async function copyBudgets(db: Db, fromMonth: string, toMonth: string, clock: Clock = {}): Promise<number> {
  if (!isValidMonth(fromMonth) || !isValidMonth(toMonth)) throw new ValidationError('Le mois est invalide.');
  return db.transaction(async (tx) => {
    const source = await listBudgetsForMonth(tx, fromMonth);
    const existing = new Set((await listBudgetsForMonth(tx, toMonth)).map((b) => b.categoryId));
    const now = nowISO(clock.now);
    let created = 0;
    for (const b of source) {
      if (existing.has(b.categoryId)) continue;
      const category = await getCategory(tx, b.categoryId);
      if (!category?.active) continue;
      await upsertBudget(tx, { categoryId: b.categoryId, month: toMonth, amount: b.amount }, now);
      created++;
    }
    return created;
  });
}

export type { Budget };
