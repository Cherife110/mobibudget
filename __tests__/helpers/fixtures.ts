import { openTestDb, type TestDb } from './testDb';
import type { Db } from '../../src/db/types';
import { createAccount } from '../../src/services/account.service';
import { seedDefaultCategories } from '../../src/services/category.service';
import { listCategories } from '../../src/repositories/categories.repository';
import type { Account } from '../../src/types';

/** « Aujourd'hui » figé : samedi 24 octobre 2026. */
export const clock = { now: new Date(2026, 9, 24, 12, 0, 0) };
export const TODAY = '2026-10-24';

export interface Fixture extends TestDb {
  cash: Account;
  momo: Account;
  bank: Account;
  /** id d'une catégorie par nom, ex. cat('Nourriture'). */
  cat: (name: string) => number;
}

/** Trois comptes (50 000 / 20 000 / 100 000 FCFA au 1er octobre 2026) + catégories par défaut. */
export async function setup(): Promise<Fixture> {
  const t = await openTestDb();
  await seedDefaultCategories(t.db, {}, clock);
  const cash = await createAccount(t.db, { name: 'Espèces', type: 'cash', initialBalance: 50_000, referenceDate: '2026-10-01' }, clock);
  const momo = await createAccount(t.db, { name: 'Mobile Money', type: 'mobile_money', initialBalance: 20_000, referenceDate: '2026-10-01' }, clock);
  const bank = await createAccount(t.db, { name: 'Banque', type: 'bank', initialBalance: 100_000, referenceDate: '2026-10-01' }, clock);
  // Comme dans l'application : des comptes n'existent qu'après la configuration initiale.
  await t.db.run("INSERT INTO settings (key, value) VALUES ('onboarding_completed', '1')");
  const cats = await listCategories(t.db);
  const byName = new Map(cats.map((c) => [`${c.kind}:${c.name}`, c.id]));
  const cat = (name: string) => {
    const id = byName.get(`expense:${name}`) ?? byName.get(`income:${name}`);
    if (id === undefined) throw new Error(`Catégorie inconnue dans le test : ${name}`);
    return id;
  };
  return { ...t, cash, momo, bank, cat };
}

export async function count(db: Db, table: string): Promise<number> {
  const row = await db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return row!.n;
}
