import type { Db } from '../db/types';
import type { Transaction, TransactionDetail, TransactionType } from '../types';
import { ValidationError } from '../utils/errors';
import { assertValidAmount } from '../utils/money';
import { formatDateFR, isValidISODate, nowISO, todayISO } from '../utils/dates';
import { getAccount } from '../repositories/accounts.repository';
import { getCategory } from '../repositories/categories.repository';
import {
  deleteTransactionRow,
  getTransactionDetail,
  getTransactionRow,
  insertTransaction,
  queryTransactions,
  updateTransactionRow,
  type NewTransaction,
  type TransactionFilter,
} from '../repositories/transactions.repository';
import { getReferenceCurrency, loadRateBook } from './rates.service';
import type { Clock } from './clock';

export const TRANSACTION_TYPES: TransactionType[] = ['income', 'expense', 'transfer'];
export const DESCRIPTION_MAX = 200;

export interface TransactionInput {
  type: TransactionType;
  /** Entier strictement positif (FCFA). */
  amount: number;
  /** Compte source (compte débité pour une dépense/un transfert, crédité pour une entrée). */
  accountId: number;
  /** Compte destinataire (transferts uniquement). */
  toAccountId?: number | null;
  /** Catégorie (entrées et dépenses uniquement). */
  categoryId?: number | null;
  description?: string | null;
  /** Date effective AAAA-MM-JJ (peut être passée, jamais future). */
  date: string;
}

async function requireUsableAccount(db: Db, id: number | null | undefined, role: string, date: string) {
  if (typeof id !== 'number' || !Number.isInteger(id)) {
    throw new ValidationError(`Choisissez le compte ${role}.`);
  }
  const account = await getAccount(db, id);
  if (!account) throw new ValidationError(`Le compte ${role} est introuvable.`);
  if (account.archived) {
    throw new ValidationError(`Le compte « ${account.name} » est archivé : il ne peut plus recevoir d'opérations.`);
  }
  if (date < account.referenceDate) {
    throw new ValidationError(
      `La date est antérieure à la date de référence du compte « ${account.name} » (${formatDateFR(account.referenceDate)}). ` +
        `Choisissez une date plus récente ou modifiez la date de référence du compte.`,
    );
  }
  return account;
}

/** Valide une saisie complète et la normalise. Doit être appelée dans la même transaction que l'écriture. */
async function normalize(db: Db, input: TransactionInput, existing: Transaction | null, today: string): Promise<NewTransaction> {
  if (!TRANSACTION_TYPES.includes(input.type)) throw new ValidationError("Le type d'opération est invalide.");
  assertValidAmount(input.amount);
  if (!isValidISODate(input.date)) throw new ValidationError('La date est invalide.');
  if (input.date > today) throw new ValidationError('La date ne peut pas être dans le futur.');

  let description: string | null = null;
  if (input.description !== undefined && input.description !== null) {
    const d = String(input.description).trim();
    if (d.length > DESCRIPTION_MAX) {
      throw new ValidationError(`La description ne peut pas dépasser ${DESCRIPTION_MAX} caractères.`);
    }
    description = d.length > 0 ? d : null;
  }

  const account = await requireUsableAccount(db, input.accountId, input.type === 'transfer' ? 'source' : '', input.date);
  if (existing && existing.accountId !== account.id) {
    // Déplacer une opération vers un compte d'une autre devise réinterpréterait son montant (12,50 € → 1 250 FCFA).
    const previous = await getAccount(db, existing.accountId);
    if (previous && previous.currency !== account.currency) {
      throw new ValidationError(
        `Le compte d'une opération ne peut pas être remplacé par un compte d'une autre devise (${previous.currency} → ${account.currency}). Supprimez l'opération et recréez-la.`,
      );
    }
  }

  if (input.type === 'transfer') {
    if (input.categoryId !== undefined && input.categoryId !== null) {
      throw new ValidationError("Un transfert n'a pas de catégorie.");
    }
    const to = await requireUsableAccount(db, input.toAccountId, 'destinataire', input.date);
    if (to.id === account.id) {
      throw new ValidationError('Le compte source et le compte destinataire doivent être différents.');
    }
    if (to.currency !== account.currency) {
      // Un transfert déplace un seul montant : entre deux devises il faudrait une vraie opération de change
      // (deux montants + un taux). Tant qu'elle n'existe pas, on refuse plutôt que de créer des soldes faux.
      throw new ValidationError(
        `Transfert impossible entre « ${account.name} » (${account.currency}) et « ${to.name} » (${to.currency}) : ` +
          `les opérations de change ne sont pas encore disponibles. Les transferts se font entre comptes de même devise.`,
      );
    }
    return {
      type: 'transfer',
      amount: input.amount,
      accountId: account.id,
      toAccountId: to.id,
      categoryId: null,
      description,
      date: input.date,
    };
  }

  if (input.toAccountId !== undefined && input.toAccountId !== null) {
    throw new ValidationError('Seul un transfert possède un compte destinataire.');
  }
  if (typeof input.categoryId !== 'number' || !Number.isInteger(input.categoryId)) {
    throw new ValidationError('Choisissez une catégorie.');
  }
  const category = await getCategory(db, input.categoryId);
  if (!category) throw new ValidationError('La catégorie est introuvable.');
  if (category.kind !== input.type) {
    throw new ValidationError(
      input.type === 'expense'
        ? `« ${category.name} » est une catégorie de revenu : elle ne peut pas être utilisée pour une dépense.`
        : `« ${category.name} » est une catégorie de dépense : elle ne peut pas être utilisée pour une entrée.`,
    );
  }
  // Une catégorie désactivée reste valable pour une opération qui l'utilisait déjà.
  if (!category.active && existing?.categoryId !== category.id) {
    throw new ValidationError(`La catégorie « ${category.name} » est désactivée.`);
  }
  return {
    type: input.type,
    amount: input.amount,
    accountId: account.id,
    toAccountId: null,
    categoryId: category.id,
    description,
    date: input.date,
  };
}

async function assertNoArchivedAccount(db: Db, t: Transaction): Promise<void> {
  for (const id of [t.accountId, t.toAccountId]) {
    if (id === null) continue;
    const a = await getAccount(db, id);
    if (a?.archived) {
      throw new ValidationError(
        `Cette opération concerne le compte archivé « ${a.name} ». Désarchivez ce compte pour la modifier ou la supprimer.`,
      );
    }
  }
}

/** Enregistre une entrée, une dépense ou un transfert (les deux comptes sont validés, écriture atomique). */
export async function createTransaction(db: Db, input: TransactionInput, clock: Clock = {}): Promise<Transaction> {
  const now = clock.now ?? new Date();
  return db.transaction(async (tx) => {
    const data = await normalize(tx, input, null, todayISO(now));
    const id = await insertTransaction(tx, data, nowISO(now));
    return (await getTransactionRow(tx, id))!;
  });
}

/** Modifie une opération : soldes, budgets et statistiques suivent automatiquement (tout est calculé). */
export async function updateTransaction(db: Db, id: number, input: TransactionInput, clock: Clock = {}): Promise<Transaction> {
  const now = clock.now ?? new Date();
  return db.transaction(async (tx) => {
    const existing = await getTransactionRow(tx, id);
    if (!existing) throw new ValidationError('Opération introuvable.');
    await assertNoArchivedAccount(tx, existing);
    const data = await normalize(tx, input, existing, todayISO(now));
    await updateTransactionRow(tx, id, data, nowISO(now));
    return (await getTransactionRow(tx, id))!;
  });
}

export async function deleteTransaction(db: Db, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await getTransactionRow(tx, id);
    if (!existing) throw new ValidationError('Opération introuvable.');
    await assertNoArchivedAccount(tx, existing);
    await deleteTransactionRow(tx, id);
  });
}

export function listTransactions(db: Db, filter: TransactionFilter = {}): Promise<TransactionDetail[]> {
  return queryTransactions(db, filter);
}

export interface FilterSummary {
  count: number;
  /** Entrées / dépenses du filtre, converties dans la devise de référence (transferts exclus). */
  income: number;
  expense: number;
  /** Opérations exclues des totaux faute de taux de change applicable. */
  excludedCount: number;
}

export async function summarizeFilter(db: Db, filter: TransactionFilter = {}): Promise<FilterSummary> {
  const [rows, reference, book] = await Promise.all([
    queryTransactions(db, { ...filter, limit: 1_000_000, offset: 0 }),
    getReferenceCurrency(db),
    loadRateBook(db),
  ]);
  let income = 0;
  let expense = 0;
  let excludedCount = 0;
  for (const t of rows) {
    if (t.type === 'transfer') continue;
    const converted = book.convert(t.amount, t.currency, reference, t.date);
    if (converted === null) excludedCount++;
    else if (t.type === 'income') income += converted;
    else expense += converted;
  }
  return { count: rows.length, income, expense, excludedCount };
}

export function getTransaction(db: Db, id: number): Promise<TransactionDetail | null> {
  return getTransactionDetail(db, id);
}

export type { TransactionFilter };
