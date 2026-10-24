export type SqlParam = string | number | null;

export interface RunResult {
  changes: number;
  lastInsertRowId: number;
}

/** Interface minimale d'un moteur SQLite (expo-sqlite en production, node:sqlite en test). */
export interface DbDriver {
  run(sql: string, params: SqlParam[]): Promise<RunResult>;
  all<T>(sql: string, params: SqlParam[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

/**
 * Accès base utilisé par repositories et services.
 * Règle : à l'intérieur de `transaction(async (tx) => …)`, n'utiliser QUE `tx`.
 */
export interface Db {
  run(sql: string, params?: SqlParam[]): Promise<RunResult>;
  all<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlParam[]): Promise<T | null>;
  exec(sql: string): Promise<void>;
  /** Exécute `fn` de façon atomique : tout est validé (COMMIT) ou tout est annulé (ROLLBACK). */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

/**
 * Construit un `Db` au-dessus d'un driver.
 * - Les écritures et transactions sont sérialisées par un verrou : deux opérations
 *   concurrentes ne peuvent jamais s'entrelacer dans une même transaction SQLite.
 * - Un `transaction` imbriqué rejoint la transaction en cours.
 */
export function createDb(driver: DbDriver): Db {
  let tail: Promise<void> = Promise.resolve();

  async function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  const reads = {
    all: <T>(sql: string, params: SqlParam[] = []) => driver.all<T>(sql, params),
    first: async <T>(sql: string, params: SqlParam[] = []) => {
      const rows = await driver.all<T>(sql, params);
      return rows.length > 0 ? rows[0] : null;
    },
  };

  // Handle utilisé DANS une transaction : le verrou est déjà détenu.
  const inner: Db = {
    ...reads,
    run: (sql, params = []) => driver.run(sql, params),
    exec: (sql) => driver.exec(sql),
    transaction: (fn) => fn(inner),
  };

  return {
    ...reads,
    run: (sql, params = []) => withLock(() => driver.run(sql, params)),
    exec: (sql) => withLock(() => driver.exec(sql)),
    transaction: <T>(fn: (tx: Db) => Promise<T>) =>
      withLock(async () => {
        await driver.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(inner);
          await driver.exec('COMMIT');
          return result;
        } catch (e) {
          try {
            await driver.exec('ROLLBACK');
          } catch {
            /* la transaction a déjà été annulée par SQLite */
          }
          throw e;
        }
      }),
  };
}
