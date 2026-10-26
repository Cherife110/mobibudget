import { setup, clock, count, type Fixture } from './helpers/fixtures';
import { openTestDb } from './helpers/testDb';
import { createAccount, updateAccount, archiveAccount, unarchiveAccount } from '../src/services/account.service';
import { createTransaction } from '../src/services/transaction.service';
import { getAccountsWithBalances, getGlobalBalance, getAccountBalance } from '../src/services/balance.service';
import { completeOnboarding, loadAppSettings } from '../src/services/onboarding.service';
import { listCategories } from '../src/repositories/categories.repository';
import { ValidationError } from '../src/utils/errors';

describe('comptes', () => {
  let f: Fixture;
  beforeEach(async () => { f = await setup(); });
  afterEach(() => f.close());

  test('création d\'un compte avec solde initial : le solde courant vaut le solde initial', async () => {
    expect(f.cash.initialBalance).toBe(50_000);
    expect(f.cash.referenceDate).toBe('2026-10-01');
    expect(f.cash.archived).toBe(false);
    expect(await getAccountBalance(f.db, f.cash.id)).toBe(50_000);
    const all = await getAccountsWithBalances(f.db);
    expect(all.map((a) => [a.name, a.balance])).toEqual([['Espèces', 50_000], ['Mobile Money', 20_000], ['Banque', 100_000]]);
    expect((await getGlobalBalance(f.db)).total).toBe(170_000);
  });

  test('un compte peut démarrer à découvert (solde négatif) et le solde global en tient compte', async () => {
    await createAccount(f.db, { name: 'Crédit', type: 'other', initialBalance: -30_000, referenceDate: '2026-10-01' }, clock);
    expect((await getGlobalBalance(f.db)).total).toBe(140_000);
  });

  test('validation : nom, type, solde, date de référence, doublon', async () => {
    const ok = { name: 'Test', type: 'cash' as const, initialBalance: 0, referenceDate: '2026-10-01' };
    await expect(createAccount(f.db, { ...ok, name: '   ' }, clock)).rejects.toThrow(ValidationError);
    await expect(createAccount(f.db, { ...ok, name: 'x'.repeat(41) }, clock)).rejects.toThrow(ValidationError);
    await expect(createAccount(f.db, { ...ok, type: 'crypto' as never }, clock)).rejects.toThrow(ValidationError);
    await expect(createAccount(f.db, { ...ok, initialBalance: 12.5 }, clock)).rejects.toThrow(ValidationError);
    await expect(createAccount(f.db, { ...ok, initialBalance: NaN }, clock)).rejects.toThrow(ValidationError);
    await expect(createAccount(f.db, { ...ok, referenceDate: '2026-02-30' }, clock)).rejects.toThrow(ValidationError);
    await expect(createAccount(f.db, { ...ok, referenceDate: '2026-10-25' }, clock)).rejects.toThrow(/futur/);
    await expect(createAccount(f.db, { ...ok, name: 'espèces' }, clock)).rejects.toThrow(/existe déjà/);
    expect(await count(f.db, 'accounts')).toBe(3);
  });

  test('modification d\'un compte ; la date de référence ne peut pas dépasser la 1re opération', async () => {
    await createTransaction(f.db, { type: 'expense', amount: 1000, accountId: f.cash.id, categoryId: f.cat('Transport'), date: '2026-10-05' }, clock);
    const updated = await updateAccount(f.db, f.cash.id, { name: 'Cash', type: 'cash', initialBalance: 60_000, referenceDate: '2026-10-03' }, clock);
    expect(updated.name).toBe('Cash');
    expect(await getAccountBalance(f.db, f.cash.id)).toBe(59_000);
    await expect(
      updateAccount(f.db, f.cash.id, { name: 'Cash', type: 'cash', initialBalance: 60_000, referenceDate: '2026-10-06' }, clock),
    ).rejects.toThrow(/première opération/);
    await expect(updateAccount(f.db, 9999, { name: 'Z', type: 'cash', initialBalance: 0, referenceDate: '2026-10-01' }, clock)).rejects.toThrow(/introuvable/);
  });

  test('un compte archivé reste consultable mais ne reçoit plus d\'opérations et sort du solde global', async () => {
    await archiveAccount(f.db, f.momo.id, clock);
    const all = await getAccountsWithBalances(f.db);
    expect(all.find((a) => a.id === f.momo.id)).toMatchObject({ archived: true, balance: 20_000 });
    expect((await getGlobalBalance(f.db)).total).toBe(150_000);
    await expect(
      createTransaction(f.db, { type: 'income', amount: 500, accountId: f.momo.id, categoryId: f.cat('Vente'), date: '2026-10-10' }, clock),
    ).rejects.toThrow(/archivé/);
    await unarchiveAccount(f.db, f.momo.id, clock);
    expect((await getGlobalBalance(f.db)).total).toBe(170_000);
  });

  test('les clés étrangères sont actives : un compte utilisé ne peut pas être supprimé', async () => {
    const fk = await f.db.first<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(fk?.foreign_keys).toBe(1);
    await createTransaction(f.db, { type: 'income', amount: 500, accountId: f.cash.id, categoryId: f.cat('Vente'), date: '2026-10-10' }, clock);
    await expect(f.db.run('DELETE FROM accounts WHERE id = ?', [f.cash.id])).rejects.toThrow();
  });
});

describe('première utilisation', () => {
  test('crée le premier compte, les catégories par défaut et les paramètres, en une transaction', async () => {
    const t = await openTestDb();
    expect((await loadAppSettings(t.db)).onboardingCompleted).toBe(false);
    await completeOnboarding(t.db, { account: { name: 'Espèces', type: 'cash', initialBalance: 15_000, referenceDate: '2026-10-20' } }, clock);
    const settings = await loadAppSettings(t.db);
    expect(settings).toMatchObject({ onboardingCompleted: true, referenceCurrency: 'XOF' });
    const cats = await listCategories(t.db);
    expect(cats.filter((c) => c.kind === 'income')).toHaveLength(5);
    expect(cats.filter((c) => c.kind === 'expense')).toHaveLength(9);
    expect((await getGlobalBalance(t.db)).total).toBe(15_000);
    await expect(
      completeOnboarding(t.db, { account: { name: 'Autre', type: 'cash', initialBalance: 0, referenceDate: '2026-10-20' } }, clock),
    ).rejects.toThrow(/déjà terminée/);
    t.close();
  });

  test('un échec n\'écrit rien (ni compte, ni catégories, ni paramètres)', async () => {
    const t = await openTestDb();
    await expect(
      completeOnboarding(t.db, { account: { name: '', type: 'cash', initialBalance: 0, referenceDate: '2026-10-20' } }, clock),
    ).rejects.toThrow(ValidationError);
    expect(await count(t.db, 'accounts')).toBe(0);
    expect(await count(t.db, 'categories')).toBe(0);
    expect((await loadAppSettings(t.db)).onboardingCompleted).toBe(false);
    t.close();
  });
});
