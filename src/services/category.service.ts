import type { Db } from '../db/types';
import type { Category, CategoryKind } from '../types';
import { ValidationError } from '../utils/errors';
import { nowISO } from '../utils/dates';
import {
  deleteBudgetsOfCategory,
  deleteCategoryRow,
  findCategoryByName,
  getCategory,
  getCategoryUsage,
  insertCategory,
  listCategories,
  listCategoryUsage,
  moveCategoryBudgets,
  moveCategoryTransactions,
  updateCategoryRow,
  type CategoryUsage,
} from '../repositories/categories.repository';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from '../constants/defaults';
import type { Clock } from './clock';

export const CATEGORY_NAME_MAX = 40;

function cleanName(name: string): string {
  const n = String(name ?? '').trim();
  if (n.length === 0) throw new ValidationError('Le nom de la catégorie est obligatoire.');
  if (n.length > CATEGORY_NAME_MAX) {
    throw new ValidationError(`Le nom de la catégorie ne peut pas dépasser ${CATEGORY_NAME_MAX} caractères.`);
  }
  return n;
}

export async function createCategory(
  db: Db,
  input: { name: string; kind: CategoryKind },
  clock: Clock = {},
  isDefault = false,
): Promise<Category> {
  if (input.kind !== 'income' && input.kind !== 'expense') throw new ValidationError('Type de catégorie invalide.');
  const name = cleanName(input.name);
  return db.transaction(async (tx) => {
    if (await findCategoryByName(tx, name, input.kind)) {
      throw new ValidationError(`La catégorie « ${name} » existe déjà.`);
    }
    const id = await insertCategory(tx, { name, kind: input.kind, isDefault }, nowISO(clock.now));
    return (await getCategory(tx, id))!;
  });
}

/** Renomme et/ou (dés)active une catégorie. Les anciennes transactions restent intactes. */
export async function updateCategory(
  db: Db,
  id: number,
  changes: { name?: string; active?: boolean },
  clock: Clock = {},
): Promise<Category> {
  return db.transaction(async (tx) => {
    const existing = await getCategory(tx, id);
    if (!existing) throw new ValidationError('Catégorie introuvable.');
    const name = changes.name === undefined ? existing.name : cleanName(changes.name);
    const clash = await findCategoryByName(tx, name, existing.kind);
    if (clash && clash.id !== id) throw new ValidationError(`La catégorie « ${name} » existe déjà.`);
    await updateCategoryRow(tx, id, { name, active: changes.active ?? existing.active }, nowISO(clock.now));
    return (await getCategory(tx, id))!;
  });
}

/** Crée les catégories par défaut sélectionnées (ou toutes si aucune sélection n'est fournie). */
export async function seedDefaultCategories(
  db: Db,
  selection: { income?: string[]; expense?: string[] } = {},
  clock: Clock = {},
): Promise<void> {
  const income = selection.income ?? DEFAULT_INCOME_CATEGORIES;
  const expense = selection.expense ?? DEFAULT_EXPENSE_CATEGORIES;
  await db.transaction(async (tx) => {
    const now = nowISO(clock.now);
    for (const [kind, names] of [['income', income], ['expense', expense]] as const) {
      for (const raw of names) {
        const name = cleanName(raw);
        if (!(await findCategoryByName(tx, name, kind))) {
          await insertCategory(tx, { name, kind, isDefault: true }, now);
        }
      }
    }
  });
}

/**
 * Supprime une catégorie qui n'est utilisée par AUCUNE opération.
 * Les budgets qui la concernent doivent être supprimés explicitement (`deleteBudgets: true`),
 * sinon l'opération est refusée. Une catégorie utilisée doit être archivée ou réaffectée, jamais supprimée.
 */
export async function deleteCategory(db: Db, id: number, opts: { deleteBudgets?: boolean } = {}): Promise<void> {
  await db.transaction(async (tx) => {
    const category = await getCategory(tx, id);
    if (!category) throw new ValidationError('Catégorie introuvable.');
    const usage = await getCategoryUsage(tx, id);
    if (usage.transactions > 0) {
      throw new ValidationError(
        `« ${category.name} » est utilisée par ${usage.transactions} opération${usage.transactions > 1 ? 's' : ''} : elle ne peut pas être supprimée. ` +
          `Archivez-la, ou réaffectez ses opérations vers une autre catégorie.`,
      );
    }
    if (usage.budgets > 0 && !opts.deleteBudgets) {
      throw new ValidationError(
        `« ${category.name} » a ${usage.budgets} budget${usage.budgets > 1 ? 's' : ''} mensuel${usage.budgets > 1 ? 's' : ''}. Confirmez leur suppression pour supprimer la catégorie.`,
      );
    }
    await deleteBudgetsOfCategory(tx, id);
    await deleteCategoryRow(tx, id);
  });
}

export interface ReassignResult {
  transactions: number;
  budgetsMoved: number;
  budgetsDropped: number;
}

/**
 * Réaffecte toutes les opérations (et les budgets) d'une catégorie vers une autre du MÊME type
 * (revenu → revenu, dépense → dépense). Les montants, dates et soldes ne changent pas.
 * Tout se fait dans une transaction : en cas d'erreur, rien n'est modifié.
 */
export async function reassignCategory(
  db: Db,
  fromId: number,
  toId: number,
  opts: { archiveSource?: boolean } = {},
  clock: Clock = {},
): Promise<ReassignResult> {
  return db.transaction(async (tx) => {
    if (fromId === toId) throw new ValidationError('Choisissez une autre catégorie de destination.');
    const from = await getCategory(tx, fromId);
    const to = await getCategory(tx, toId);
    if (!from || !to) throw new ValidationError('Catégorie introuvable.');
    if (from.kind !== to.kind) {
      throw new ValidationError(
        from.kind === 'expense'
          ? `« ${to.name} » est une catégorie de revenu : les dépenses ne peuvent être réaffectées que vers une catégorie de dépense.`
          : `« ${to.name} » est une catégorie de dépense : les entrées ne peuvent être réaffectées que vers une catégorie de revenu.`,
      );
    }
    if (!to.active) throw new ValidationError(`La catégorie « ${to.name} » est désactivée : réactivez-la avant d'y réaffecter des opérations.`);
    const now = nowISO(clock.now);
    const transactions = await moveCategoryTransactions(tx, fromId, toId, now);
    const budgets = await moveCategoryBudgets(tx, fromId, toId, now);
    if (opts.archiveSource) await updateCategoryRow(tx, fromId, { name: from.name, active: false }, now);
    return { transactions, budgetsMoved: budgets.moved, budgetsDropped: budgets.dropped };
  });
}

export { getCategory, listCategories, getCategoryUsage, listCategoryUsage };
export type { CategoryUsage };
