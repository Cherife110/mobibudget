import { setup, clock, count, type Fixture } from './helpers/fixtures';
import {
  createCategory, updateCategory, deleteCategory, reassignCategory, getCategoryUsage, listCategoryUsage, listCategories,
} from '../src/services/category.service';
import { createTransaction, getTransaction, updateTransaction, listTransactions } from '../src/services/transaction.service';
import { setBudget, getBudgetStatuses } from '../src/services/budget.service';
import { getGlobalBalance, getAccountBalance } from '../src/services/balance.service';
import { getCategoryBreakdown } from '../src/services/statistics.service';
import { createBackup, serializeBackup, parseBackup } from '../src/services/backup.service';
import { ValidationError } from '../src/utils/errors';

describe('gestion des catégories', () => {
  let f: Fixture;
  beforeEach(async () => { f = await setup(); });
  afterEach(() => f.close());

  const spend = (cat: string, amount = 1_000, date = '2026-10-10') =>
    createTransaction(f.db, { type: 'expense', amount, accountId: f.cash.id, categoryId: f.cat(cat), date }, clock);
  const earn = (cat: string, amount = 5_000, date = '2026-10-10') =>
    createTransaction(f.db, { type: 'income', amount, accountId: f.cash.id, categoryId: f.cat(cat), date }, clock);

  test('modifier : renommer conserve le lien avec les opérations existantes', async () => {
    const t = await spend('Loisirs', 2_000);
    const renamed = await updateCategory(f.db, f.cat('Loisirs'), { name: '  Sorties  ' }, clock);
    expect(renamed.name).toBe('Sorties');
    expect((await getTransaction(f.db, t.id))?.categoryName).toBe('Sorties');
    await expect(updateCategory(f.db, f.cat('Loisirs'), { name: 'transport' }, clock)).rejects.toThrow(/existe déjà/);
    await expect(updateCategory(f.db, f.cat('Loisirs'), { name: '   ' }, clock)).rejects.toThrow(ValidationError);
    await expect(updateCategory(f.db, 9999, { name: 'X' }, clock)).rejects.toThrow(/introuvable/);
    // le même nom est permis dans l'autre type (revenu / dépense)
    await expect(updateCategory(f.db, f.cat('Vente'), { name: 'Transport' }, clock)).resolves.toMatchObject({ name: 'Transport', kind: 'income' });
  });

  test('supprimer une catégorie inutilisée', async () => {
    const c = await createCategory(f.db, { name: 'Cadeaux', kind: 'expense' }, clock);
    expect(await getCategoryUsage(f.db, c.id)).toEqual({ transactions: 0, budgets: 0 });
    await deleteCategory(f.db, c.id);
    expect((await listCategories(f.db)).some((x) => x.id === c.id)).toBe(false);
    await expect(deleteCategory(f.db, c.id)).rejects.toThrow(/introuvable/);
    // une catégorie par défaut inutilisée peut aussi être supprimée
    await expect(deleteCategory(f.db, f.cat('Factures'))).resolves.toBeUndefined();
  });

  test('une catégorie utilisée par des opérations ne peut PAS être supprimée : rien n\'est perdu', async () => {
    const t = await spend('Nourriture', 4_000);
    await expect(deleteCategory(f.db, f.cat('Nourriture'))).rejects.toThrow(/1 opération/);
    await expect(deleteCategory(f.db, f.cat('Nourriture'), { deleteBudgets: true })).rejects.toThrow(/ne peut pas être supprimée/);
    expect((await getTransaction(f.db, t.id))?.categoryName).toBe('Nourriture');
    expect(await getAccountBalance(f.db, f.cash.id)).toBe(46_000);
  });

  test('supprimer une catégorie qui a des budgets exige une confirmation explicite', async () => {
    const c = await createCategory(f.db, { name: 'Cadeaux', kind: 'expense' }, clock);
    await setBudget(f.db, { categoryId: c.id, month: '2026-10', amount: 10_000 }, clock);
    await setBudget(f.db, { categoryId: c.id, month: '2026-09', amount: 8_000 }, clock);
    await expect(deleteCategory(f.db, c.id)).rejects.toThrow(/2 budgets/);
    expect(await count(f.db, 'budgets')).toBe(2);
    await deleteCategory(f.db, c.id, { deleteBudgets: true });
    expect(await count(f.db, 'budgets')).toBe(0);
    expect((await listCategories(f.db)).some((x) => x.id === c.id)).toBe(false);
  });

  test('archiver une catégorie utilisée : l\'historique et les budgets restent, plus de nouvelles saisies ; réactivable', async () => {
    const t = await spend('Loisirs', 3_000);
    await setBudget(f.db, { categoryId: f.cat('Loisirs'), month: '2026-10', amount: 10_000 }, clock);
    await updateCategory(f.db, f.cat('Loisirs'), { active: false }, clock);
    expect((await getTransaction(f.db, t.id))?.categoryName).toBe('Loisirs');
    expect((await getBudgetStatuses(f.db, '2026-10'))[0]).toMatchObject({ categoryName: 'Loisirs', spent: 3_000 });
    expect((await getCategoryBreakdown(f.db, '2026-10-01', '2026-10-31')).map((c) => c.name)).toEqual(['Loisirs']);
    await expect(spend('Loisirs')).rejects.toThrow(/désactivée/);
    await updateCategory(f.db, f.cat('Loisirs'), { active: true }, clock);
    await expect(spend('Loisirs', 500)).resolves.toBeTruthy();
  });

  test('réaffecter : les opérations passent à l\'autre catégorie, soldes et montants inchangés', async () => {
    const a = await spend('Achats', 7_000, '2026-10-05');
    const b = await spend('Achats', 2_000, '2026-10-12');
    await spend('Transport', 1_000);
    const balance = (await getGlobalBalance(f.db)).total;
    const before = await getTransaction(f.db, a.id);

    const r = await reassignCategory(f.db, f.cat('Achats'), f.cat('Autres dépenses'), {}, { now: new Date(2026, 9, 24, 18, 0) });
    expect(r).toEqual({ transactions: 2, budgetsMoved: 0, budgetsDropped: 0 });

    const after = await getTransaction(f.db, a.id);
    expect(after).toMatchObject({ categoryName: 'Autres dépenses', amount: 7_000, date: '2026-10-05', accountId: f.cash.id });
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(after?.updatedAt).not.toBe(before?.updatedAt);
    expect((await getTransaction(f.db, b.id))?.categoryName).toBe('Autres dépenses');
    expect((await getGlobalBalance(f.db)).total).toBe(balance);                         // aucun solde ne bouge
    expect(await getCategoryUsage(f.db, f.cat('Achats'))).toEqual({ transactions: 0, budgets: 0 });
    // la catégorie vidée peut maintenant être supprimée
    await deleteCategory(f.db, f.cat('Achats'));
    expect((await getCategoryBreakdown(f.db, '2026-10-01', '2026-10-31')).map((c) => [c.name, c.amount]))
      .toEqual([['Autres dépenses', 9_000], ['Transport', 1_000]]);
  });

  test('réaffecter avec archivage de l\'ancienne catégorie', async () => {
    await spend('Achats', 7_000);
    await reassignCategory(f.db, f.cat('Achats'), f.cat('Autres dépenses'), { archiveSource: true }, clock);
    const old = (await listCategories(f.db)).find((c) => c.id === f.cat('Achats'));
    expect(old).toMatchObject({ active: false, name: 'Achats' });
  });

  test('réaffecter : budgets déplacés, ou supprimés si la cible a déjà un budget le même mois', async () => {
    await setBudget(f.db, { categoryId: f.cat('Achats'), month: '2026-09', amount: 5_000 }, clock);
    await setBudget(f.db, { categoryId: f.cat('Achats'), month: '2026-10', amount: 9_000 }, clock);
    await setBudget(f.db, { categoryId: f.cat('Autres dépenses'), month: '2026-10', amount: 3_000 }, clock);
    await spend('Achats', 2_000);
    const r = await reassignCategory(f.db, f.cat('Achats'), f.cat('Autres dépenses'), {}, clock);
    expect(r).toMatchObject({ transactions: 1, budgetsMoved: 1, budgetsDropped: 1 });
    const oct = (await getBudgetStatuses(f.db, '2026-10'))[0];
    expect(oct).toMatchObject({ categoryName: 'Autres dépenses', amount: 3_000, spent: 2_000 });   // le budget de la cible prévaut
    expect((await getBudgetStatuses(f.db, '2026-09'))[0]).toMatchObject({ categoryName: 'Autres dépenses', amount: 5_000 });
    expect(await count(f.db, 'budgets')).toBe(2);
  });

  test('réaffecter : refusé entre revenu et dépense, vers soi-même, vers une catégorie désactivée ou inconnue — sans rien modifier', async () => {
    const t = await spend('Achats', 7_000);
    const i = await earn('Vente', 5_000);
    await updateCategory(f.db, f.cat('Santé'), { active: false }, clock);
    const attempts: Array<[number, number, RegExp]> = [
      [f.cat('Achats'), f.cat('Salaire'), /catégorie de revenu/],
      [f.cat('Vente'), f.cat('Transport'), /catégorie de dépense/],
      [f.cat('Achats'), f.cat('Achats'), /autre catégorie/],
      [f.cat('Achats'), f.cat('Santé'), /désactivée/],
      [f.cat('Achats'), 9999, /introuvable/],
      [9999, f.cat('Transport'), /introuvable/],
    ];
    for (const [from, to, re] of attempts) await expect(reassignCategory(f.db, from, to, {}, clock)).rejects.toThrow(re);
    expect((await getTransaction(f.db, t.id))?.categoryName).toBe('Achats');
    expect((await getTransaction(f.db, i.id))?.categoryName).toBe('Vente');
  });

  test('réaffecter des entrées entre catégories de revenu', async () => {
    await earn('Vente', 5_000);
    const r = await reassignCategory(f.db, f.cat('Vente'), f.cat('Freelance'), {}, clock);
    expect(r.transactions).toBe(1);
    expect((await listTransactions(f.db, { categoryId: f.cat('Freelance') }))).toHaveLength(1);
  });

  test('l\'historique reste cohérent : les opérations réaffectées peuvent être modifiées normalement', async () => {
    const t = await spend('Achats', 7_000);
    await reassignCategory(f.db, f.cat('Achats'), f.cat('Autres dépenses'), { archiveSource: true }, clock);
    await expect(
      updateTransaction(f.db, t.id, { type: 'expense', amount: 6_000, accountId: f.cash.id, categoryId: f.cat('Autres dépenses'), date: '2026-10-10' }, clock),
    ).resolves.toMatchObject({ amount: 6_000 });
    // et elles ne peuvent pas retourner dans la catégorie archivée
    await expect(
      updateTransaction(f.db, t.id, { type: 'expense', amount: 6_000, accountId: f.cash.id, categoryId: f.cat('Achats'), date: '2026-10-10' }, clock),
    ).rejects.toThrow(/désactivée/);
  });

  test('usage par catégorie (écran) et sauvegarde/restauration après réaffectation et suppression', async () => {
    await spend('Achats', 7_000);
    await spend('Achats', 1_000);
    await setBudget(f.db, { categoryId: f.cat('Achats'), month: '2026-10', amount: 9_000 }, clock);
    const usage = await listCategoryUsage(f.db);
    expect(usage.get(f.cat('Achats'))).toEqual({ transactions: 2, budgets: 1 });
    expect(usage.get(f.cat('Transport'))).toEqual({ transactions: 0, budgets: 0 });

    await reassignCategory(f.db, f.cat('Achats'), f.cat('Autres dépenses'), {}, clock);
    await deleteCategory(f.db, f.cat('Achats'));
    const file = parseBackup(serializeBackup(await createBackup(f.db, clock)));   // doit rester valide
    expect(file.data.categories.some((c) => c.name === 'Achats')).toBe(false);
    expect(file.data.transactions.every((t) => t.categoryId !== null)).toBe(true);
  });
});
