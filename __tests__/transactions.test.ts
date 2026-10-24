import { setup, clock, count, type Fixture } from './helpers/fixtures';
import {
  createTransaction, updateTransaction, deleteTransaction, listTransactions, summarizeFilter, getTransaction,
} from '../src/services/transaction.service';
import { archiveAccount } from '../src/services/account.service';
import { updateCategory } from '../src/services/category.service';
import { getAccountBalance, getGlobalBalance } from '../src/services/balance.service';
import { ValidationError } from '../src/utils/errors';
import { MAX_AMOUNT } from '../src/utils/money';

describe('transactions', () => {
  let f: Fixture;
  beforeEach(async () => { f = await setup(); });
  afterEach(() => f.close());

  const income = (over = {}) => ({ type: 'income' as const, amount: 30_000, accountId: f.cash.id, categoryId: f.cat('Salaire'), date: '2026-10-05', ...over });
  const expense = (over = {}) => ({ type: 'expense' as const, amount: 12_500, accountId: f.cash.id, categoryId: f.cat('Nourriture'), date: '2026-10-10', ...over });

  test('enregistrement d\'une entrée : solde du compte et solde global augmentent', async () => {
    const t = await createTransaction(f.db, income({ description: '  Salaire d\'octobre  ' }), clock);
    expect(t).toMatchObject({ type: 'income', amount: 30_000, accountId: f.cash.id, toAccountId: null, description: "Salaire d'octobre", date: '2026-10-05' });
    expect(t.createdAt).toBe(t.updatedAt);
    expect(await getAccountBalance(f.db, f.cash.id)).toBe(80_000);
    expect(await getGlobalBalance(f.db)).toBe(200_000);
  });

  test('enregistrement d\'une dépense : les soldes diminuent', async () => {
    await createTransaction(f.db, expense(), clock);
    expect(await getAccountBalance(f.db, f.cash.id)).toBe(37_500);
    expect(await getGlobalBalance(f.db)).toBe(157_500);
  });

  test('transfert entre deux comptes : mouvements opposés, solde global inchangé', async () => {
    const t = await createTransaction(f.db, { type: 'transfer', amount: 10_000, accountId: f.cash.id, toAccountId: f.momo.id, date: '2026-10-06' }, clock);
    expect(t).toMatchObject({ type: 'transfer', categoryId: null, toAccountId: f.momo.id });
    expect(await getAccountBalance(f.db, f.cash.id)).toBe(40_000);
    expect(await getAccountBalance(f.db, f.momo.id)).toBe(30_000);
    expect(await getGlobalBalance(f.db)).toBe(170_000);
  });

  test('calcul du solde global avec plusieurs opérations (formule complète)', async () => {
    await createTransaction(f.db, income(), clock);                                   // cash +30 000
    await createTransaction(f.db, expense({ accountId: f.momo.id }), clock);          // momo −12 500
    await createTransaction(f.db, { type: 'transfer', amount: 5_000, accountId: f.bank.id, toAccountId: f.cash.id, date: '2026-10-11' }, clock);
    // cash : 50 000 + 30 000 + 5 000 ; momo : 20 000 − 12 500 ; banque : 100 000 − 5 000
    expect(await getAccountBalance(f.db, f.cash.id)).toBe(85_000);
    expect(await getAccountBalance(f.db, f.momo.id)).toBe(7_500);
    expect(await getAccountBalance(f.db, f.bank.id)).toBe(95_000);
    expect(await getGlobalBalance(f.db)).toBe(187_500);
  });

  test('un solde peut devenir négatif et reste compté dans le solde global', async () => {
    await createTransaction(f.db, expense({ amount: 70_000, accountId: f.momo.id }), clock);
    expect(await getAccountBalance(f.db, f.momo.id)).toBe(-50_000);
    expect(await getGlobalBalance(f.db)).toBe(100_000);
  });

  test('modification : soldes recalculés, updatedAt change, createdAt conservé', async () => {
    const t = await createTransaction(f.db, expense(), clock);
    const later = { now: new Date(2026, 9, 24, 18, 0, 0) };
    const u = await updateTransaction(f.db, t.id, expense({ amount: 2_500, accountId: f.momo.id, description: 'Marché' }), later);
    expect(u).toMatchObject({ amount: 2_500, accountId: f.momo.id, description: 'Marché' });
    expect(u.createdAt).toBe(t.createdAt);
    expect(u.updatedAt).not.toBe(t.updatedAt);
    expect(await getAccountBalance(f.db, f.cash.id)).toBe(50_000);   // dépense retirée du compte espèces
    expect(await getAccountBalance(f.db, f.momo.id)).toBe(17_500);   // et reportée sur Mobile Money
    await expect(updateTransaction(f.db, 9999, expense(), clock)).rejects.toThrow(/introuvable/);
  });

  test('on peut changer le type d\'une opération (dépense → transfert)', async () => {
    const t = await createTransaction(f.db, expense(), clock);
    await updateTransaction(f.db, t.id, { type: 'transfer', amount: 12_500, accountId: f.cash.id, toAccountId: f.bank.id, date: '2026-10-10' }, clock);
    expect(await getGlobalBalance(f.db)).toBe(170_000);
    expect((await getTransaction(f.db, t.id))?.categoryName).toBeNull();
  });

  test('suppression : le solde revient à sa valeur d\'origine', async () => {
    const t = await createTransaction(f.db, expense(), clock);
    expect(await getAccountBalance(f.db, f.cash.id)).toBe(37_500);
    await deleteTransaction(f.db, t.id);
    expect(await getAccountBalance(f.db, f.cash.id)).toBe(50_000);
    expect(await count(f.db, 'transactions')).toBe(0);
    await expect(deleteTransaction(f.db, t.id)).rejects.toThrow(/introuvable/);
  });

  test('dépense oubliée la veille : date passée acceptée ; futur et avant la date de référence refusés', async () => {
    const t = await createTransaction(f.db, expense({ date: '2026-10-23' }), clock);
    expect(t.date).toBe('2026-10-23');
    expect((await listTransactions(f.db, { from: '2026-10-23', to: '2026-10-23' })).map((x) => x.id)).toEqual([t.id]);
    await expect(createTransaction(f.db, expense({ date: '2026-10-25' }), clock)).rejects.toThrow(/futur/);
    await expect(createTransaction(f.db, expense({ date: '2026-09-30' }), clock)).rejects.toThrow(/date de référence/);
    await expect(createTransaction(f.db, expense({ date: '2026-02-30' }), clock)).rejects.toThrow(/invalide/);
    await expect(createTransaction(f.db, expense({ date: '' }), clock)).rejects.toThrow(/invalide/);
  });

  test('montants nuls, négatifs, décimaux ou invalides sont rejetés sans rien écrire', async () => {
    for (const amount of [0, -1, -5000, 12.5, NaN, Infinity, MAX_AMOUNT + 1, '1000' as never, null as never, undefined as never]) {
      await expect(createTransaction(f.db, expense({ amount }), clock)).rejects.toThrow(ValidationError);
    }
    expect(await count(f.db, 'transactions')).toBe(0);
    const t = await createTransaction(f.db, expense(), clock);
    await expect(updateTransaction(f.db, t.id, expense({ amount: 0 }), clock)).rejects.toThrow(ValidationError);
    expect((await getTransaction(f.db, t.id))?.amount).toBe(12_500);
  });

  test('une catégorie de revenu ne sert pas à une dépense, et inversement', async () => {
    await expect(createTransaction(f.db, expense({ categoryId: f.cat('Salaire') }), clock)).rejects.toThrow(/catégorie de revenu/);
    await expect(createTransaction(f.db, income({ categoryId: f.cat('Nourriture') }), clock)).rejects.toThrow(/catégorie de dépense/);
    await expect(createTransaction(f.db, expense({ categoryId: undefined }), clock)).rejects.toThrow(/catégorie/);
    await expect(createTransaction(f.db, expense({ categoryId: 9999 }), clock)).rejects.toThrow(/introuvable/);
  });

  test('catégorie désactivée : refusée pour une nouvelle opération, conservée sur les anciennes', async () => {
    const old = await createTransaction(f.db, expense(), clock);
    await updateCategory(f.db, f.cat('Nourriture'), { active: false }, clock);
    await expect(createTransaction(f.db, expense(), clock)).rejects.toThrow(/désactivée/);
    const edited = await updateTransaction(f.db, old.id, expense({ amount: 9_000 }), clock);   // même catégorie : autorisé
    expect(edited.amount).toBe(9_000);
    const detail = await getTransaction(f.db, old.id);
    expect(detail?.categoryName).toBe('Nourriture');
  });

  test('transferts : mêmes comptes, destinataire manquant/archivé, catégorie interdite', async () => {
    const tr = (over = {}) => ({ type: 'transfer' as const, amount: 1_000, accountId: f.cash.id, toAccountId: f.momo.id, date: '2026-10-06', ...over });
    await expect(createTransaction(f.db, tr({ toAccountId: f.cash.id }), clock)).rejects.toThrow(/différents/);
    await expect(createTransaction(f.db, tr({ toAccountId: null }), clock)).rejects.toThrow(/destinataire/);
    await expect(createTransaction(f.db, tr({ toAccountId: 9999 }), clock)).rejects.toThrow(/introuvable/);
    await expect(createTransaction(f.db, tr({ categoryId: f.cat('Transport') }), clock)).rejects.toThrow(/pas de catégorie/);
    await archiveAccount(f.db, f.momo.id, clock);
    await expect(createTransaction(f.db, tr(), clock)).rejects.toThrow(/archivé/);
    expect(await count(f.db, 'transactions')).toBe(0);
  });

  test('un transfert vers le compte source est aussi bloqué par la base (CHECK)', async () => {
    await expect(
      f.db.run(
        `INSERT INTO transactions (type, amount, account_id, to_account_id, date, created_at, updated_at) VALUES ('transfer', 100, ?, ?, '2026-10-06', 'x', 'x')`,
        [f.cash.id, f.cash.id],
      ),
    ).rejects.toThrow();
  });

  test('atomicité : une erreur au milieu d\'une transaction SQLite annule toutes les écritures', async () => {
    await expect(
      f.db.transaction(async (tx) => {
        await createTransaction(tx, expense(), clock);
        await createTransaction(tx, income(), clock);
        await createTransaction(tx, expense({ amount: -1 }), clock);  // invalide → rollback global
      }),
    ).rejects.toThrow(ValidationError);
    expect(await count(f.db, 'transactions')).toBe(0);
    expect(await getGlobalBalance(f.db)).toBe(170_000);
  });

  test('opérations sur un compte archivé : modification et suppression bloquées', async () => {
    const t = await createTransaction(f.db, expense(), clock);
    await archiveAccount(f.db, f.cash.id, clock);
    await expect(updateTransaction(f.db, t.id, expense({ amount: 1 }), clock)).rejects.toThrow(/archivé/);
    await expect(deleteTransaction(f.db, t.id)).rejects.toThrow(/archivé/);
  });

  test('recherche et filtres : période, type, compte, catégorie, texte (jokers échappés)', async () => {
    await createTransaction(f.db, income({ description: 'Paie 100% net' }), clock);
    await createTransaction(f.db, expense({ description: 'Riz au marché', date: '2026-10-08' }), clock);
    await createTransaction(f.db, expense({ amount: 3_000, categoryId: f.cat('Transport'), accountId: f.momo.id, date: '2026-10-12' }), clock);
    await createTransaction(f.db, { type: 'transfer', amount: 4_000, accountId: f.cash.id, toAccountId: f.momo.id, date: '2026-10-15' }, clock);

    expect(await listTransactions(f.db)).toHaveLength(4);
    expect((await listTransactions(f.db))[0].type).toBe('transfer');                       // plus récent d'abord
    expect(await listTransactions(f.db, { from: '2026-10-08', to: '2026-10-12' })).toHaveLength(2);
    expect(await listTransactions(f.db, { type: 'expense' })).toHaveLength(2);
    expect(await listTransactions(f.db, { accountId: f.momo.id })).toHaveLength(2);          // source OU destination
    expect(await listTransactions(f.db, { categoryId: f.cat('Transport') })).toHaveLength(1);
    expect(await listTransactions(f.db, { search: 'marché' })).toHaveLength(1);
    expect(await listTransactions(f.db, { search: 'Transport' })).toHaveLength(1);           // nom de catégorie
    expect(await listTransactions(f.db, { search: '100%' })).toHaveLength(1);
    expect(await listTransactions(f.db, { search: '%' })).toHaveLength(1);                   // % littéral, pas un joker
    expect(await listTransactions(f.db, { search: 'introuvable' })).toHaveLength(0);

    const s = await summarizeFilter(f.db, {});
    expect(s).toEqual({ count: 4, income: 30_000, expense: 15_500 });                        // transfert exclu des totaux
  });

  test('les requêtes sont paramétrées : une saisie hostile reste du texte', async () => {
    await createTransaction(f.db, expense({ description: "x'; DROP TABLE transactions; --" }), clock);
    expect(await listTransactions(f.db, { search: "'; DROP TABLE" })).toHaveLength(1);
    expect(await count(f.db, 'transactions')).toBe(1);
  });
});
