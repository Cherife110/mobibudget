import type { Db } from '../db/types';
import type { Category, CategoryKind } from '../types';
import { ValidationError } from '../utils/errors';
import { nowISO } from '../utils/dates';
import {
  findCategoryByName,
  getCategory,
  insertCategory,
  listCategories,
  updateCategoryRow,
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

export { getCategory, listCategories };
