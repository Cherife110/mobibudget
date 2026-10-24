import { setup, clock, type Fixture } from './helpers/fixtures';
import { createTransaction, updateTransaction, deleteTransaction } from '../src/services/transaction.service';
import { setBudget, deleteBudget, getBudgetStatuses, computeBudgetLevel, copyBudgets } from '../src/services/budget.service';
import { updateAccount } from '../src/services/account.service';
import { ValidationError } from '../src/utils/errors';

describe('budgets', () => {
  let f: Fixture;
  beforeEach(async () => { f = await setup(); });
  afterEach(() => f.close());

  const spend = (amount: number, over = {}) =>
    createTransaction(f.db, { type: 'expense', amount, accountId: f.cash.id, categoryId: f.cat('Nourriture'), date: '2026-10-10', ...over }, clock);
  const status = async (month = '2026-10') => (await getBudgetStatuses(f.db, month)).find((b) => b.categoryName === 'Nourriture')!;

  test('plafond, dépensé, restant, pourcentage — calculés depuis les transactions', async () => {
    await setBudget(f.db, { categoryId: f.cat('Nourriture'), month: '2026-10', amount: 20_000 }, clock);
    expect(await status()).toMatchObject({ amount: 20_000, spent: 0, remaining: 20_000, percent: 0, level: 'ok' });
    await spend(8_000);
    expect(await status()).toMatchObject({ spent: 8_000, remaining: 12_000, percent: 40, level: 'ok' });
  });

  test('avertissement à 80 %, puis plafond atteint/dépassé ; les dépenses restent enregistrables', async () => {
    await setBudget(f.db, { categoryId: f.cat('Nourriture'), month: '2026-10', amount: 20_000 }, clock);
    await spend(16_000);
    expect(await status()).toMatchObject({ percent: 80, level: 'warning' });
    await spend(4_000);
    expect(await status()).toMatchObject({ spent: 20_000, remaining: 0, percent: 100, level: 'exceeded' });
    await expect(spend(5_000)).resolves.toBeTruthy();                                   // jamais bloqué
    expect(await status()).toMatchObject({ spent: 25_000, remaining: -5_000, percent: 125, level: 'exceeded' });
  });

  test('bornes du seuil, en arithmétique entière', () => {
    expect(computeBudgetLevel(7_999, 10_000)).toBe('ok');
    expect(computeBudgetLevel(8_000, 10_000)).toBe('warning');
    expect(computeBudgetLevel(9_999, 10_000)).toBe('warning');
    expect(computeBudgetLevel(10_000, 10_000)).toBe('exceeded');
    expect(computeBudgetLevel(0, 1)).toBe('ok');
  });

  test('un budget ne compte pas les transferts, ni les autres catégories, ni les autres mois', async () => {
    await setBudget(f.db, { categoryId: f.cat('Nourriture'), month: '2026-10', amount: 20_000 }, clock);
    await createTransaction(f.db, { type: 'transfer', amount: 50_000, accountId: f.cash.id, toAccountId: f.momo.id, date: '2026-10-10' }, clock);
    await spend(3_000, { categoryId: f.cat('Transport') });
    await createTransaction(f.db, { type: 'income', amount: 9_000, accountId: f.cash.id, categoryId: f.cat('Vente'), date: '2026-10-10' }, clock);
    await spend(1_000, { date: '2026-10-01' });                                          // 1er du mois : inclus
    expect((await status()).spent).toBe(1_000);
  });

  test('modifier ou supprimer une dépense met le budget à jour automatiquement', async () => {
    await setBudget(f.db, { categoryId: f.cat('Nourriture'), month: '2026-10', amount: 10_000 }, clock);
    const t = await spend(9_000);
    expect(await status()).toMatchObject({ spent: 9_000, level: 'warning' });
    await updateTransaction(f.db, t.id, { type: 'expense', amount: 4_000, accountId: f.cash.id, categoryId: f.cat('Nourriture'), date: '2026-10-10' }, clock);
    expect(await status()).toMatchObject({ spent: 4_000, level: 'ok' });
    await updateTransaction(f.db, t.id, { type: 'expense', amount: 4_000, accountId: f.cash.id, categoryId: f.cat('Transport'), date: '2026-10-10' }, clock);
    expect((await status()).spent).toBe(0);                                              // changement de catégorie
    // changement de mois : on recule d'abord la date de référence du compte pour autoriser septembre
    await updateAccount(f.db, f.cash.id, { name: 'Espèces', type: 'cash', initialBalance: 50_000, referenceDate: '2026-09-01' }, clock);
    await updateTransaction(f.db, t.id, { type: 'expense', amount: 4_000, accountId: f.cash.id, categoryId: f.cat('Nourriture'), date: '2026-09-15' }, clock);
    expect((await status()).spent).toBe(0);
    expect(await getBudgetStatuses(f.db, '2026-09')).toEqual([]);                        // pas de budget défini en septembre
    await updateTransaction(f.db, t.id, { type: 'expense', amount: 4_000, accountId: f.cash.id, categoryId: f.cat('Nourriture'), date: '2026-10-11' }, clock);
    await deleteTransaction(f.db, t.id);
    expect((await status()).spent).toBe(0);
  });

  test('les budgets des mois précédents sont conservés ; redéfinir met à jour sans doublon', async () => {
    await setBudget(f.db, { categoryId: f.cat('Nourriture'), month: '2026-09', amount: 15_000 }, clock);
    await setBudget(f.db, { categoryId: f.cat('Nourriture'), month: '2026-10', amount: 20_000 }, clock);
    await setBudget(f.db, { categoryId: f.cat('Nourriture'), month: '2026-10', amount: 25_000 }, clock);
    expect((await getBudgetStatuses(f.db, '2026-09')).map((b) => b.amount)).toEqual([15_000]);
    expect((await getBudgetStatuses(f.db, '2026-10')).map((b) => b.amount)).toEqual([25_000]);
    const cols = await f.db.all<{ name: string }>('PRAGMA table_info(budgets)');
    expect(cols.map((c) => c.name)).not.toContain('spent');                               // rien de stocké
  });

  test('validation : catégorie de dépense uniquement, montant et mois valides', async () => {
    await expect(setBudget(f.db, { categoryId: f.cat('Salaire'), month: '2026-10', amount: 1_000 }, clock)).rejects.toThrow(/dépense/);
    await expect(setBudget(f.db, { categoryId: f.cat('Nourriture'), month: '2026-10', amount: 0 }, clock)).rejects.toThrow(ValidationError);
    await expect(setBudget(f.db, { categoryId: f.cat('Nourriture'), month: '2026-10', amount: -5 }, clock)).rejects.toThrow(ValidationError);
    await expect(setBudget(f.db, { categoryId: f.cat('Nourriture'), month: '2026-13', amount: 100 }, clock)).rejects.toThrow(/mois/);
    await expect(setBudget(f.db, { categoryId: 9999, month: '2026-10', amount: 100 }, clock)).rejects.toThrow(/introuvable/);
    expect(await getBudgetStatuses(f.db, '2026-10')).toEqual([]);
  });

  test('suppression d\'un budget et copie du mois précédent', async () => {
    await setBudget(f.db, { categoryId: f.cat('Nourriture'), month: '2026-09', amount: 15_000 }, clock);
    await setBudget(f.db, { categoryId: f.cat('Transport'), month: '2026-09', amount: 5_000 }, clock);
    await setBudget(f.db, { categoryId: f.cat('Transport'), month: '2026-10', amount: 7_000 }, clock);
    expect(await copyBudgets(f.db, '2026-09', '2026-10', clock)).toBe(1);               // Transport déjà défini : conservé
    const oct = await getBudgetStatuses(f.db, '2026-10');
    expect(oct.map((b) => [b.categoryName, b.amount]).sort()).toEqual([['Nourriture', 15_000], ['Transport', 7_000]]);
    await deleteBudget(f.db, oct[0].id);
    await expect(deleteBudget(f.db, 9999)).rejects.toThrow(/introuvable/);
  });
});
