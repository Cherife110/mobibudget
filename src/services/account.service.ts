import type { Db } from '../db/types';
import type { Account, AccountType } from '../types';
import { DEFAULT_REFERENCE_CURRENCY, isKnownCurrency } from '../constants/currencies';
import { ValidationError } from '../utils/errors';
import { assertValidBalance } from '../utils/money';
import { formatDateFR, isValidISODate, nowISO, todayISO } from '../utils/dates';
import {
  earliestTransactionDate,
  getAccount,
  insertAccount,
  listAccounts,
  setAccountArchived,
  updateAccountRow,
} from '../repositories/accounts.repository';
import type { Clock } from './clock';

export const ACCOUNT_TYPES: AccountType[] = ['cash', 'mobile_money', 'bank', 'other'];
export const ACCOUNT_NAME_MAX = 40;

export interface AccountInput {
  name: string;
  type: AccountType;
  /** Code ISO 4217. À la création : XOF par défaut. À la modification : inchangée si omise. */
  currency?: string;
  /** Solde initial dans la plus petite unité de la devise du compte (entier). */
  initialBalance: number;
  referenceDate: string;
}

type NormalizedAccountInput = Required<AccountInput>;

function normalizeInput(input: AccountInput, today: string, fallbackCurrency: string): NormalizedAccountInput {
  const name = String(input.name ?? '').trim();
  if (name.length === 0) throw new ValidationError('Le nom du compte est obligatoire.');
  if (name.length > ACCOUNT_NAME_MAX) {
    throw new ValidationError(`Le nom du compte ne peut pas dépasser ${ACCOUNT_NAME_MAX} caractères.`);
  }
  if (!ACCOUNT_TYPES.includes(input.type)) throw new ValidationError('Le type de compte est invalide.');
  const currency = input.currency ?? fallbackCurrency;
  if (!isKnownCurrency(currency)) throw new ValidationError('La devise du compte est invalide.');
  assertValidBalance(input.initialBalance);
  if (!isValidISODate(input.referenceDate)) throw new ValidationError('La date de référence est invalide.');
  if (input.referenceDate > today) {
    throw new ValidationError('La date de référence ne peut pas être dans le futur.');
  }
  return { name, type: input.type, currency, initialBalance: input.initialBalance, referenceDate: input.referenceDate };
}

async function assertNameAvailable(db: Db, name: string, exceptId?: number): Promise<void> {
  const row = await db.first<{ id: number }>(
    'SELECT id FROM accounts WHERE name = ? COLLATE NOCASE AND id <> ?',
    [name, exceptId ?? -1],
  );
  if (row) throw new ValidationError(`Un compte nommé « ${name} » existe déjà.`);
}

export async function createAccount(db: Db, input: AccountInput, clock: Clock = {}): Promise<Account> {
  const now = clock.now ?? new Date();
  const data = normalizeInput(input, todayISO(now), DEFAULT_REFERENCE_CURRENCY);
  return db.transaction(async (tx) => {
    await assertNameAvailable(tx, data.name);
    const id = await insertAccount(tx, data, nowISO(now));
    return (await getAccount(tx, id))!;
  });
}

export async function updateAccount(db: Db, id: number, input: AccountInput, clock: Clock = {}): Promise<Account> {
  const now = clock.now ?? new Date();
  return db.transaction(async (tx) => {
    const existing = await getAccount(tx, id);
    if (!existing) throw new ValidationError('Compte introuvable.');
    const data = normalizeInput(input, todayISO(now), existing.currency);
    await assertNameAvailable(tx, data.name, id);
    const earliest = await earliestTransactionDate(tx, id);
    if (earliest && data.currency !== existing.currency) {
      // Changer la devise réinterpréterait tous les montants déjà enregistrés : interdit.
      throw new ValidationError(
        `La devise d'un compte ne peut plus changer une fois des opérations enregistrées (${existing.currency}).`,
      );
    }
    if (earliest && data.referenceDate > earliest) {
      throw new ValidationError(
        `La date de référence ne peut pas être postérieure à la première opération du compte (${formatDateFR(earliest)}).`,
      );
    }
    await updateAccountRow(tx, id, data, nowISO(now));
    return (await getAccount(tx, id))!;
  });
}

/** Archive un compte : il reste dans l'historique mais ne reçoit plus d'opérations. */
export async function archiveAccount(db: Db, id: number, clock: Clock = {}): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await getAccount(tx, id);
    if (!existing) throw new ValidationError('Compte introuvable.');
    await setAccountArchived(tx, id, true, nowISO(clock.now));
  });
}

export async function unarchiveAccount(db: Db, id: number, clock: Clock = {}): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await getAccount(tx, id);
    if (!existing) throw new ValidationError('Compte introuvable.');
    await setAccountArchived(tx, id, false, nowISO(clock.now));
  });
}

export { getAccount, listAccounts };
