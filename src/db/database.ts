import * as SQLite from 'expo-sqlite';
import { createDb, type Db, type DbDriver, type SqlParam } from './types';
import { migrate } from './migrations';

export const DATABASE_NAME = 'mobibudget.db';

function expoDriver(database: SQLite.SQLiteDatabase): DbDriver {
  return {
    async run(sql, params: SqlParam[]) {
      const r = await database.runAsync(sql, params);
      return { changes: r.changes, lastInsertRowId: r.lastInsertRowId };
    },
    all: <T>(sql: string, params: SqlParam[]) => database.getAllAsync<T>(sql, params),
    exec: (sql) => database.execAsync(sql),
  };
}

/** Ouvre la base locale, active les clés étrangères puis applique les migrations. */
export async function openDatabase(name: string = DATABASE_NAME): Promise<Db> {
  const database = await SQLite.openDatabaseAsync(name);
  await database.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const db = createDb(expoDriver(database));
  await migrate(db);
  return db;
}
