import type { Db } from '../db/types';
import type { Account, AccountType } from '../types';
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
  initialBalance: number;
  referenceDate: string;
}

function normalizeInput(input: AccountInput, today: string): AccountInput {
  const name = String(input.name ?? '').trim();
  if (name.length === 0) throw new ValidationError('Le nom du compte est obligatoire.');
  if (name.length > ACCOUNT_NAME_MAX) {
    throw new ValidationError(`Le nom du compte ne peut pas dépasser ${ACCOUNT_NAME_MAX} caractères.`);
  }
  if (!ACCOUNT_TYPES.includes(input.type)) throw new ValidationError('Le type de compte est invalide.');
  assertValidBalance(input.initialBalance);
  if (!isValidISODate(input.referenceDate)) throw new ValidationError('La date de référence est invalide.');
  if (input.referenceDate > today) {
    throw new ValidationError('La date de référence ne peut pas être dans le futur.');
  }
  return { name, type: input.type, initialBalance: input.initialBalance, referenceDate: input.referenceDate };
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
  const data = normalizeInput(input, todayISO(now));
  return db.transaction(async (tx) => {
    await assertNameAvailable(tx, data.name);
    const id = await insertAccount(tx, data, nowISO(now));
    return (await getAccount(tx, id))!;
  });
}

export async function updateAccount(db: Db, id: number, input: AccountInput, clock: Clock = {}): Promise<Account> {
  const now = clock.now ?? new Date();
  const data = normalizeInput(input, todayISO(now));
  return db.transaction(async (tx) => {
    const existing = await getAccount(tx, id);
    if (!existing) throw new ValidationError('Compte introuvable.');
    await assertNameAvailable(tx, data.name, id);
    const earliest = await earliestTransactionDate(tx, id);
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
