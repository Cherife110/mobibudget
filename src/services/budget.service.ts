import type { Db } from '../db/types';
import type { Budget, BudgetLevel, BudgetStatus } from '../types';
import { ValidationError } from '../utils/errors';
import { assertValidAmount } from '../utils/money';
import { endOfMonth, isValidMonth, nowISO, startOfMonth } from '../utils/dates';
import { getCategory } from '../repositories/categories.repository';
import { loadConvertedRows } from './converted.service';
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
 * Budgets d'un mois avec le total dépensé, calculé à partir des transactions et exprimé dans la devise de
 * référence (les plafonds sont dans cette devise). Les transferts ne comptent jamais ; une dépense sans taux
 * de change applicable est exclue du « dépensé » et comptée dans `excludedCount`.
 */
export async function getBudgetStatuses(db: Db, month: string): Promise<BudgetStatus[]> {
  if (!isValidMonth(month)) throw new ValidationError('Le mois est invalide.');
  const budgets = await db.all<{
    id: number;
    category_id: number;
    month: string;
    amount: number;
    created_at: string;
    updated_at: string;
    category_name: string;
  }>(
    `SELECT b.*, c.name AS category_name FROM budgets b JOIN categories c ON c.id = b.category_id WHERE b.month = ?`,
    [month],
  );
  if (budgets.length === 0) return [];
  const { rows } = await loadConvertedRows(db, startOfMonth(month), endOfMonth(month));
  const spentBy = new Map<number, { spent: number; excluded: number }>();
  for (const r of rows) {
    if (r.type !== 'expense') continue;
    const e = spentBy.get(r.categoryId) ?? { spent: 0, excluded: 0 };
    if (r.converted === null) e.excluded++;
    else e.spent += r.converted;
    spentBy.set(r.categoryId, e);
  }
  const statuses = budgets.map<BudgetStatus>((r) => {
    const { spent, excluded } = spentBy.get(r.category_id) ?? { spent: 0, excluded: 0 };
    return {
      id: r.id,
      categoryId: r.category_id,
      month: r.month,
      amount: r.amount,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      categoryName: r.category_name,
      spent,
      remaining: r.amount - spent,
      percent: Math.round((spent * 100) / r.amount),
      level: computeBudgetLevel(spent, r.amount),
      excludedCount: excluded,
    };
  });
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
