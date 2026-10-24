import type { Db } from '../db/types';
import type { Account, Budget, Category, Transaction } from '../types';
import { ACCOUNT_TYPES } from './account.service';
import { TRANSACTION_TYPES, DESCRIPTION_MAX } from './transaction.service';
import { CURRENCY_CODE, APP_VERSION } from '../constants/defaults';
import { isValidISODate, isValidMonth, nowISO } from '../utils/dates';
import { MAX_AMOUNT } from '../utils/money';
import { SETTING_KEYS, getSetting, setSetting } from '../repositories/settings.repository';
import { listAccounts } from '../repositories/accounts.repository';
import { listCategories } from '../repositories/categories.repository';
import { mapTransaction, type TransactionRow } from '../repositories/transactions.repository';
import { mapBudget, type BudgetRow } from '../repositories/budgets.repository';
import type { Clock } from './clock';

export const BACKUP_APP = 'MobiBudget';
export const BACKUP_FORMAT_VERSION = 1;
/** Garde-fous : un fichier de sauvegarde raisonnable reste très en dessous de ces limites. */
export const BACKUP_MAX_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 500_000;
const NAME_MAX = 100;

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export interface BackupData {
  settings: { currency: string };
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
}

/**
 * Sauvegarde JSON versionnée. ATTENTION : ce fichier est en clair (non chiffré) —
 * il contient toutes les données financières de l'utilisateur.
 */
export interface BackupFile {
  app: typeof BACKUP_APP;
  formatVersion: number;
  appVersion: string;
  exportedAt: string;
  data: BackupData;
}

export async function createBackup(db: Db, clock: Clock = {}): Promise<BackupFile> {
  // Lecture dans une transaction : instantané cohérent même si une écriture survient en parallèle.
  return db.transaction(async (tx) => {
    const [accounts, categories, txRows, budgetRows, currency] = await Promise.all([
      listAccounts(tx, true),
      listCategories(tx),
      tx.all<TransactionRow>('SELECT * FROM transactions ORDER BY id ASC'),
      tx.all<BudgetRow>('SELECT * FROM budgets ORDER BY id ASC'),
      getSetting(tx, SETTING_KEYS.currency),
    ]);
    return {
      app: BACKUP_APP,
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: APP_VERSION,
      exportedAt: nowISO(clock.now),
      data: {
        settings: { currency: currency ?? CURRENCY_CODE },
        accounts: [...accounts].sort((a, b) => a.id - b.id),
        categories: [...categories].sort((a, b) => a.id - b.id),
        transactions: txRows.map(mapTransaction),
        budgets: budgetRows.map(mapBudget),
      },
    };
  });
}

export function serializeBackup(file: BackupFile): string {
  return JSON.stringify(file, null, 2);
}

export function backupFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `mobibudget-sauvegarde-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

// ---------------------------------------------------------------------------------------------
// Validation : le fichier importé est traité comme une donnée non fiable. Il n'est jamais exécuté,
// seulement analysé (JSON.parse) puis copié champ par champ après contrôle.
// ---------------------------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(path: string, problem: string): never {
  throw new BackupError(`Sauvegarde invalide — ${path} : ${problem}.`);
}

function reqRecord(v: unknown, path: string): Rec {
  if (!isRecord(v)) fail(path, 'objet attendu');
  return v;
}

function reqArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'liste attendue');
  if (v.length > MAX_ROWS) fail(path, 'trop d\'éléments');
  return v;
}

function reqInt(r: Rec, key: string, path: string, opts: { min?: number; max?: number } = {}): number {
  const v = r[key];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) fail(`${path}.${key}`, 'entier attendu');
  if (opts.min !== undefined && v < opts.min) fail(`${path}.${key}`, `doit être ≥ ${opts.min}`);
  if (opts.max !== undefined && v > opts.max) fail(`${path}.${key}`, `doit être ≤ ${opts.max}`);
  return v;
}

function reqString(r: Rec, key: string, path: string, max = NAME_MAX): string {
  const v = r[key];
  if (typeof v !== 'string') fail(`${path}.${key}`, 'texte attendu');
  const s = v.trim();
  if (s.length === 0) fail(`${path}.${key}`, 'ne peut pas être vide');
  if (s.length > max) fail(`${path}.${key}`, 'texte trop long');
  return s;
}

function reqBool(r: Rec, key: string, path: string): boolean {
  const v = r[key];
  if (typeof v !== 'boolean') fail(`${path}.${key}`, 'booléen attendu');
  return v;
}

function reqTimestamp(r: Rec, key: string, path: string): string {
  const v = r[key];
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) fail(`${path}.${key}`, 'horodatage invalide');
  return v;
}

function reqOneOf<T extends string>(r: Rec, key: string, path: string, allowed: readonly T[]): T {
  const v = r[key];
  if (typeof v !== 'string' || !allowed.includes(v as T)) fail(`${path}.${key}`, `valeur invalide (attendu : ${allowed.join(', ')})`);
  return v as T;
}

/** Valide l'objet JSON complet et en retourne une copie propre et typée. Lève BackupError sinon. */
export function validateBackup(raw: unknown): BackupFile {
  const root = reqRecord(raw, 'fichier');
  if (root.app !== BACKUP_APP) {
    throw new BackupError("Ce fichier n'est pas une sauvegarde MobiBudget.");
  }
  const version = root.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BackupError('Sauvegarde invalide — version du format manquante ou incorrecte.');
  }
  if (version > BACKUP_FORMAT_VERSION) {
    throw new BackupError(
      'Cette sauvegarde a été créée par une version plus récente de MobiBudget. Mettez l\'application à jour pour la restaurer.',
    );
  }
  const data = reqRecord(root.data, 'data');

  const settingsRaw = reqRecord(data.settings, 'data.settings');
  const currency = reqString(settingsRaw, 'currency', 'data.settings', 10);

  const accountIds = new Set<number>();
  const accounts = reqArray(data.accounts, 'data.accounts').map((item, i): Account => {
    const p = `comptes[${i}]`;
    const r = reqRecord(item, p);
    const id = reqInt(r, 'id', p, { min: 1 });
    if (accountIds.has(id)) fail(`${p}.id`, 'identifiant en double');
    accountIds.add(id);
    const referenceDate = r.referenceDate;
    if (!isValidISODate(referenceDate)) fail(`${p}.referenceDate`, 'date invalide');
    return {
      id,
      name: reqString(r, 'name', p),
      type: reqOneOf(r, 'type', p, ACCOUNT_TYPES),
      initialBalance: reqInt(r, 'initialBalance', p, { min: -MAX_AMOUNT, max: MAX_AMOUNT }),
      referenceDate,
      archived: reqBool(r, 'archived', p),
      createdAt: reqTimestamp(r, 'createdAt', p),
      updatedAt: reqTimestamp(r, 'updatedAt', p),
    };
  });

  const categoryKinds = new Map<number, 'income' | 'expense'>();
  const categoryKeys = new Set<string>();
  const categories = reqArray(data.categories, 'data.categories').map((item, i): Category => {
    const p = `catégories[${i}]`;
    const r = reqRecord(item, p);
    const id = reqInt(r, 'id', p, { min: 1 });
    if (categoryKinds.has(id)) fail(`${p}.id`, 'identifiant en double');
    const kind = reqOneOf(r, 'kind', p, ['income', 'expense'] as const);
    const name = reqString(r, 'name', p);
    const key = `${kind}:${name}`;
    if (categoryKeys.has(key)) fail(`${p}.name`, `catégorie « ${name} » en double`);
    categoryKeys.add(key);
    categoryKinds.set(id, kind);
    return {
      id,
      name,
      kind,
      active: reqBool(r, 'active', p),
      isDefault: reqBool(r, 'isDefault', p),
      createdAt: reqTimestamp(r, 'createdAt', p),
      updatedAt: reqTimestamp(r, 'updatedAt', p),
    };
  });

  const transactionIds = new Set<number>();
  const transactions = reqArray(data.transactions, 'data.transactions').map((item, i): Transaction => {
    const p = `opérations[${i}]`;
    const r = reqRecord(item, p);
    const id = reqInt(r, 'id', p, { min: 1 });
    if (transactionIds.has(id)) fail(`${p}.id`, 'identifiant en double');
    transactionIds.add(id);
    const type = reqOneOf(r, 'type', p, TRANSACTION_TYPES);
    const amount = reqInt(r, 'amount', p, { min: 1, max: MAX_AMOUNT });
    const accountId = reqInt(r, 'accountId', p, { min: 1 });
    if (!accountIds.has(accountId)) fail(`${p}.accountId`, `le compte ${accountId} n'existe pas`);
    const date = r.date;
    if (!isValidISODate(date)) fail(`${p}.date`, 'date invalide');

    let description: string | null = null;
    if (r.description !== null && r.description !== undefined) {
      if (typeof r.description !== 'string') fail(`${p}.description`, 'texte ou null attendu');
      if (r.description.length > DESCRIPTION_MAX * 5) fail(`${p}.description`, 'texte trop long');
      description = r.description.trim() || null;
    }

    let toAccountId: number | null = null;
    let categoryId: number | null = null;
    if (type === 'transfer') {
      toAccountId = reqInt(r, 'toAccountId', p, { min: 1 });
      if (!accountIds.has(toAccountId)) fail(`${p}.toAccountId`, `le compte ${toAccountId} n'existe pas`);
      if (toAccountId === accountId) fail(`${p}.toAccountId`, 'un transfert vers le même compte est interdit');
      if (r.categoryId !== null && r.categoryId !== undefined) fail(`${p}.categoryId`, 'un transfert n\'a pas de catégorie');
    } else {
      if (r.toAccountId !== null && r.toAccountId !== undefined) fail(`${p}.toAccountId`, 'réservé aux transferts');
      categoryId = reqInt(r, 'categoryId', p, { min: 1 });
      const kind = categoryKinds.get(categoryId);
      if (!kind) fail(`${p}.categoryId`, `la catégorie ${categoryId} n'existe pas`);
      if (kind !== type) fail(`${p}.categoryId`, 'la catégorie ne correspond pas au type d\'opération');
    }
    return {
      id,
      type,
      amount,
      accountId,
      toAccountId,
      categoryId,
      description,
      date,
      createdAt: reqTimestamp(r, 'createdAt', p),
      updatedAt: reqTimestamp(r, 'updatedAt', p),
    };
  });

  const budgetIds = new Set<number>();
  const budgetKeys = new Set<string>();
  const budgets = reqArray(data.budgets, 'data.budgets').map((item, i): Budget => {
    const p = `budgets[${i}]`;
    const r = reqRecord(item, p);
    const id = reqInt(r, 'id', p, { min: 1 });
    if (budgetIds.has(id)) fail(`${p}.id`, 'identifiant en double');
    budgetIds.add(id);
    const categoryId = reqInt(r, 'categoryId', p, { min: 1 });
    if (categoryKinds.get(categoryId) !== 'expense') fail(`${p}.categoryId`, 'doit référencer une catégorie de dépense existante');
    const month = r.month;
    if (!isValidMonth(month)) fail(`${p}.month`, 'mois invalide (AAAA-MM attendu)');
    const key = `${categoryId}:${month}`;
    if (budgetKeys.has(key)) fail(p, 'deux budgets pour la même catégorie et le même mois');
    budgetKeys.add(key);
    return {
      id,
      categoryId,
      month,
      amount: reqInt(r, 'amount', p, { min: 1, max: MAX_AMOUNT }),
      createdAt: reqTimestamp(r, 'createdAt', p),
      updatedAt: reqTimestamp(r, 'updatedAt', p),
    };
  });

  return {
    app: BACKUP_APP,
    formatVersion: version,
    appVersion: typeof root.appVersion === 'string' ? root.appVersion.slice(0, 20) : 'inconnue',
    exportedAt: typeof root.exportedAt === 'string' ? root.exportedAt : '',
    data: { settings: { currency }, accounts, categories, transactions, budgets },
  };
}

/** Analyse (sans jamais l'exécuter) un texte JSON puis le valide. */
export function parseBackup(text: string): BackupFile {
  if (text.length > BACKUP_MAX_BYTES) throw new BackupError('Le fichier est trop volumineux pour être une sauvegarde MobiBudget.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new BackupError("Ce fichier n'est pas un JSON valide : il est vide, tronqué ou endommagé.");
  }
  return validateBackup(parsed);
}

export interface BackupSummary {
  accounts: number;
  categories: number;
  transactions: number;
  budgets: number;
}

export function summarizeBackup(file: BackupFile): BackupSummary {
  return {
    accounts: file.data.accounts.length,
    categories: file.data.categories.length,
    transactions: file.data.transactions.length,
    budgets: file.data.budgets.length,
  };
}

/**
 * Remplace TOUTES les données par celles de la sauvegarde, de façon atomique :
 * en cas d'erreur à n'importe quelle étape, ROLLBACK et les données précédentes restent intactes.
 * `backup` doit avoir été produit par `validateBackup` / `parseBackup`.
 */
export async function restoreBackup(db: Db, backup: BackupFile): Promise<BackupSummary> {
  const d = backup.data;
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM budgets');
    await tx.run('DELETE FROM transactions');
    await tx.run('DELETE FROM categories');
    await tx.run('DELETE FROM accounts');
    await tx.run('DELETE FROM sqlite_sequence');

    for (const a of d.accounts) {
      await tx.run(
        `INSERT INTO accounts (id, name, type, initial_balance, reference_date, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [a.id, a.name, a.type, a.initialBalance, a.referenceDate, a.archived ? 1 : 0, a.createdAt, a.updatedAt],
      );
    }
    for (const c of d.categories) {
      await tx.run(
        `INSERT INTO categories (id, name, kind, active, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.kind, c.active ? 1 : 0, c.isDefault ? 1 : 0, c.createdAt, c.updatedAt],
      );
    }
    for (const t of d.transactions) {
      await tx.run(
        `INSERT INTO transactions (id, type, amount, account_id, to_account_id, category_id, description, date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.id, t.type, t.amount, t.accountId, t.toAccountId, t.categoryId, t.description, t.date, t.createdAt, t.updatedAt],
      );
    }
    for (const b of d.budgets) {
      await tx.run(
        `INSERT INTO budgets (id, category_id, month, amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [b.id, b.categoryId, b.month, b.amount, b.createdAt, b.updatedAt],
      );
    }
    await setSetting(tx, SETTING_KEYS.currency, d.settings.currency);
    await setSetting(tx, SETTING_KEYS.onboardingCompleted, '1');
  });
  return summarizeBackup(backup);
}

export async function markBackupExported(db: Db, clock: Clock = {}): Promise<void> {
  await setSetting(db, SETTING_KEYS.lastBackupAt, nowISO(clock.now));
}

export interface BackupInfo extends BackupSummary {
  lastBackupAt: string | null;
}

export async function getBackupInfo(db: Db): Promise<BackupInfo> {
  const row = await db.first<{ a: number; c: number; t: number; b: number }>(
    `SELECT (SELECT COUNT(*) FROM accounts) AS a, (SELECT COUNT(*) FROM categories) AS c,
            (SELECT COUNT(*) FROM transactions) AS t, (SELECT COUNT(*) FROM budgets) AS b`,
  );
  return {
    accounts: row?.a ?? 0,
    categories: row?.c ?? 0,
    transactions: row?.t ?? 0,
    budgets: row?.b ?? 0,
    lastBackupAt: await getSetting(db, SETTING_KEYS.lastBackupAt),
  };
}
