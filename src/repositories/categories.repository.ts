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
