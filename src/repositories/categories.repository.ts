import type { Db } from '../db/types';
import type { Category, CategoryKind } from '../types';

export interface CategoryRow {
  id: number;
  name: string;
  kind: CategoryKind;
  active: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export function mapCategory(r: CategoryRow): Category {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    active: r.active === 1,
    isDefault: r.is_default === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listCategories(db: Db, opts: { kind?: CategoryKind; activeOnly?: boolean } = {}): Promise<Category[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.kind) {
    where.push('kind = ?');
    params.push(opts.kind);
  }
  if (opts.activeOnly) where.push('active = 1');
  const rows = await db.all<CategoryRow>(
    `SELECT * FROM categories ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY kind ASC, active DESC, id ASC`,
    params,
  );
  return rows.map(mapCategory);
}

export async function getCategory(db: Db, id: number): Promise<Category | null> {
  const row = await db.first<CategoryRow>('SELECT * FROM categories WHERE id = ?', [id]);
  return row ? mapCategory(row) : null;
}

export async function findCategoryByName(db: Db, name: string, kind: CategoryKind): Promise<Category | null> {
  const row = await db.first<CategoryRow>(
    'SELECT * FROM categories WHERE kind = ? AND name = ? COLLATE NOCASE',
    [kind, name],
  );
  return row ? mapCategory(row) : null;
}

export async function insertCategory(
  db: Db,
  c: { name: string; kind: CategoryKind; isDefault: boolean },
  now: string,
): Promise<number> {
  const r = await db.run(
    `INSERT INTO categories (name, kind, active, is_default, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)`,
    [c.name, c.kind, c.isDefault ? 1 : 0, now, now],
  );
  return r.lastInsertRowId;
}

export async function updateCategoryRow(
  db: Db,
  id: number,
  c: { name: string; active: boolean },
  now: string,
): Promise<void> {
  await db.run('UPDATE categories SET name = ?, active = ?, updated_at = ? WHERE id = ?', [
    c.name,
    c.active ? 1 : 0,
    now,
    id,
  ]);
}

export interface CategoryUsage {
  /** Nombre d'opérations (entrées/dépenses) qui utilisent la catégorie. */
  transactions: number;
  /** Nombre de budgets mensuels définis sur la catégorie. */
  budgets: number;
}

const USAGE_SELECT = `SELECT c.id,
  (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS tx,
  (SELECT COUNT(*) FROM budgets b WHERE b.category_id = c.id) AS bd
  FROM categories c`;

export async function getCategoryUsage(db: Db, id: number): Promise<CategoryUsage> {
  const row = await db.first<{ tx: number; bd: number }>(`${USAGE_SELECT} WHERE c.id = ?`, [id]);
  return { transactions: row?.tx ?? 0, budgets: row?.bd ?? 0 };
}

export async function listCategoryUsage(db: Db): Promise<Map<number, CategoryUsage>> {
  const rows = await db.all<{ id: number; tx: number; bd: number }>(USAGE_SELECT);
  return new Map(rows.map((r) => [r.id, { transactions: r.tx, budgets: r.bd }]));
}

export async function deleteCategoryRow(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM categories WHERE id = ?', [id]);
}

export async function deleteBudgetsOfCategory(db: Db, categoryId: number): Promise<void> {
  await db.run('DELETE FROM budgets WHERE category_id = ?', [categoryId]);
}

/** Reporte les opérations d'une catégorie sur une autre ; retourne le nombre d'opérations modifiées. */
export async function moveCategoryTransactions(db: Db, fromId: number, toId: number, now: string): Promise<number> {
  const r = await db.run('UPDATE transactions SET category_id = ?, updated_at = ? WHERE category_id = ?', [toId, now, fromId]);
  return r.changes;
}

/**
 * Reporte les budgets de la catégorie source sur la cible.
 * Si la cible a déjà un budget pour le même mois, c'est celui de la cible qui prévaut (celui de la source est supprimé).
 */
export async function moveCategoryBudgets(
  db: Db,
  fromId: number,
  toId: number,
  now: string,
): Promise<{ moved: number; dropped: number }> {
  const source = await db.all<{ id: number; month: string }>('SELECT id, month FROM budgets WHERE category_id = ?', [fromId]);
  let moved = 0;
  let dropped = 0;
  for (const b of source) {
    const clash = await db.first<{ id: number }>('SELECT id FROM budgets WHERE category_id = ? AND month = ?', [toId, b.month]);
    if (clash) {
      await db.run('DELETE FROM budgets WHERE id = ?', [b.id]);
      dropped++;
    } else {
      await db.run('UPDATE budgets SET category_id = ?, updated_at = ? WHERE id = ?', [toId, now, b.id]);
      moved++;
    }
  }
  return { moved, dropped };
}
