import { DatabaseSync } from 'node:sqlite';
import { createDb, type Db, type DbDriver, type SqlParam } from '../../src/db/types';
import { migrate } from '../../src/db/migrations';

/** node:sqlite lie les nombres JS en REAL : on force INTEGER pour les entiers (comme expo-sqlite). */
const bind = (v: SqlParam): string | number | bigint | null =>
  typeof v === 'number' && Number.isInteger(v) ? BigInt(v) : v;

function driverFor(raw: DatabaseSync): DbDriver {
  return {
    async run(sql, params) {
      const r = raw.prepare(sql).run(...params.map(bind));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    async all<T>(sql: string, params: SqlParam[]) {
      return raw.prepare(sql).all(...params.map(bind)) as unknown as T[];
    },
    async exec(sql) {
      raw.exec(sql);
    },
  };
}

export interface TestDb {
  db: Db;
  close(): void;
}

/** Ouvre (et migre) une base SQLite réelle : en mémoire par défaut, ou dans un fichier. */
export async function openTestDb(path: string = ':memory:'): Promise<TestDb> {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON;');
  const db = createDb(driverFor(raw));
  await migrate(db);
  return { db, close: () => raw.close() };
}
