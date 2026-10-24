import type { Db } from './types';
import { SCHEMA_V1 } from './schema';

export interface Migration {
  version: number;
  statements: string[];
}

/** Migrations ordonnées. Ne jamais modifier une migration déjà publiée : en ajouter une nouvelle. */
export const MIGRATIONS: Migration[] = [{ version: 1, statements: SCHEMA_V1 }];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export async function getSchemaVersion(db: Db): Promise<number> {
  const row = await db.first<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Applique les migrations manquantes. Chaque migration est atomique
 * (schéma + numéro de version dans la même transaction).
 */
export async function migrate(db: Db): Promise<number> {
  const current = await getSchemaVersion(db);
  if (current > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Base de données créée par une version plus récente de l'application (schéma ${current}).`,
    );
  }
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.transaction(async (tx) => {
      for (const statement of m.statements) await tx.exec(statement);
      await tx.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
  return LATEST_SCHEMA_VERSION;
}
