import { DatabaseSync } from 'node:sqlite';
import { setup, clock, count, type Fixture } from './helpers/fixtures';
import { openTestDb } from './helpers/testDb';
import { createDb } from '../src/db/types';
import { MIGRATIONS, migrate, getSchemaVersion } from '../src/db/migrations';
import { createAccount, updateAccount } from '../src/services/account.service';
import { createTransaction, getTransaction, summarizeFilter, updateTransaction } from '../src/services/transaction.service';
import { saveRate, deleteRate, listRates, getReferenceCurrency } from '../src/services/rates.service';
import {
  getAccountsWithBalances, getAccountBalance, getGlobalBalance, getBalanceHistoryDetailed,
} from '../src/services/balance.service';
import { getTotals, getDailySeries, getCategoryBreakdown, getPeriodComparison } from '../src/services/statistics.service';
import { getExclusions } from '../src/services/converted.service';
import { setBudget, getBudgetStatuses } from '../src/services/budget.service';
import {
  createBackup, serializeBackup, parseBackup, restoreBackup, validateBackup, BackupError,
} from '../src/services/backup.service';
import { loadAppSettings } from '../src/services/onboarding.service';
import { parseRate } from '../src/utils/fx';
import { ValidationError } from '../src/utils/errors';
import type { Account } from '../src/types';

const rate = (s: string) => parseRate(s)!;

describe('devises par compte', () => {
  let f: Fixture;
  let eur: Account;
  beforeEach(async () => {
    f = await setup();
    eur = await createAccount(f.db, { name: 'Compte Euro', type: 'bank', currency: 'EUR', initialBalance: 10_000, referenceDate: '2026-10-01' }, clock);
  });
  afterEach(() => f.close());

  const eurTx = (type: 'income' | 'expense', amount: number, cat: string, date: string, accountId = eur.id) =>
    createTransaction(f.db, { type, amount, accountId, categoryId: f.cat(cat), date }, clock);
  const xofTx = (type: 'income' | 'expense', amount: number, cat: string, date: string) =>
    createTransaction(f.db, { type, amount, accountId: f.cash.id, categoryId: f.cat(cat), date }, clock);

  test('devise par défaut XOF ; devise invalide refusée ; référence XOF', async () => {
    expect(f.cash.currency).toBe('XOF');
    expect(eur.currency).toBe('EUR');
    const base = { name: 'Test', type: 'cash' as const, initialBalance: 0, referenceDate: '2026-10-01' };
    for (const currency of ['ZZZ', 'eur', '', 'EURO', 12 as never]) {
      await expect(createAccount(f.db, { ...base, currency }, clock)).rejects.toThrow(/devise/);
    }
    expect(await getReferenceCurrency(f.db)).toBe('XOF');
    expect((await loadAppSettings(f.db)).referenceCurrency).toBe('XOF');
  });

  test('la devise d\'un compte ne peut plus changer dès qu\'il a des opérations', async () => {
    const empty = await createAccount(f.db, { name: 'Vide', type: 'cash', currency: 'USD', initialBalance: 0, referenceDate: '2026-10-01' }, clock);
    await expect(updateAccount(f.db, empty.id, { name: 'Vide', type: 'cash', currency: 'GBP', initialBalance: 0, referenceDate: '2026-10-01' }, clock))
      .resolves.toMatchObject({ currency: 'GBP' });                                       // aucune opération : autorisé
    await eurTx('expense', 500, 'Transport', '2026-10-05');
    await expect(updateAccount(f.db, eur.id, { name: 'Compte Euro', type: 'bank', currency: 'USD', initialBalance: 10_000, referenceDate: '2026-10-01' }, clock))
      .rejects.toThrow(/ne peut plus changer/);
    // sans préciser la devise, elle est conservée
    await expect(updateAccount(f.db, eur.id, { name: 'Euro 2', type: 'bank', initialBalance: 10_000, referenceDate: '2026-10-01' }, clock))
      .resolves.toMatchObject({ name: 'Euro 2', currency: 'EUR' });
  });

  test('soldes dans la devise du compte, avec centimes exacts', async () => {
    await eurTx('income', 2_550, 'Vente', '2026-10-05');       // +25,50 €
    await eurTx('expense', 10, 'Transport', '2026-10-06');     // −0,10 €
    await eurTx('expense', 20, 'Transport', '2026-10-06');     // −0,20 €
    expect(await getAccountBalance(f.db, eur.id)).toBe(12_520);   // 125,20 € exactement
    const accounts = await getAccountsWithBalances(f.db);
    expect(accounts.find((a) => a.id === eur.id)).toMatchObject({ currency: 'EUR', balance: 12_520 });
    expect(accounts.find((a) => a.id === f.cash.id)).toMatchObject({ currency: 'XOF', balance: 50_000 });
  });

  test('solde global : jamais de somme directe entre devises ; devise sans taux exclue et signalée', async () => {
    const g = await getGlobalBalance(f.db, '2026-10-24');
    expect(g.total).toBe(170_000);                                                       // 170 000 FCFA seulement, pas 170 000 + 10 000
    expect(g.currency).toBe('XOF');
    expect(g.excluded).toEqual([{ currency: 'EUR', amount: 10_000 }]);
    expect(g.byCurrency.map((b) => [b.currency, b.amount, b.converted])).toEqual([['XOF', 170_000, 170_000], ['EUR', 10_000, null]]);

    await saveRate(f.db, { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: rate('655,957'), effectiveDate: '2026-10-01' }, clock);
    const withRate = await getGlobalBalance(f.db, '2026-10-24');
    expect(withRate.excluded).toEqual([]);
    expect(withRate.total).toBe(170_000 + 65_596);                                        // 100 € × 655,957 = 65 595,7 → 65 596
    expect(withRate.byCurrency.find((b) => b.currency === 'EUR')).toMatchObject({ amount: 10_000, converted: 65_596 });
  });

  test('taux en vigueur à la date demandée ; pas de taux « futur »', async () => {
    await saveRate(f.db, { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: rate('655,957'), effectiveDate: '2026-10-01' }, clock);
    await saveRate(f.db, { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: rate('660'), effectiveDate: '2026-10-20' }, clock);
    expect((await getGlobalBalance(f.db, '2026-10-10')).total).toBe(170_000 + 65_596);
    expect((await getGlobalBalance(f.db, '2026-10-24')).total).toBe(170_000 + 66_000);
    expect((await getGlobalBalance(f.db, '2026-09-30')).excluded).toHaveLength(1);       // avant le premier taux
  });

  test('un taux saisi dans le sens inverse (XOF → EUR) sert aussi', async () => {
    await saveRate(f.db, { fromCurrency: 'XOF', toCurrency: 'EUR', rateScaled: rate('0,00152449'), effectiveDate: '2026-10-01' }, clock);
    const g = await getGlobalBalance(f.db, '2026-10-24');
    expect(g.excluded).toEqual([]);
    expect(Math.abs(g.total - (170_000 + 65_596))).toBeLessThanOrEqual(2);              // ≈ 100 € en FCFA, arrondi de taux près
  });

  test('statistiques : chaque opération est convertie à SON taux d\'époque, sans toucher au montant d\'origine', async () => {
    await saveRate(f.db, { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: rate('655,957'), effectiveDate: '2026-10-01' }, clock);
    await saveRate(f.db, { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: rate('660'), effectiveDate: '2026-10-20' }, clock);
    const a = await eurTx('expense', 2_000, 'Nourriture', '2026-10-10');     // 20 € au taux 655,957 → 13 119
    const b = await eurTx('expense', 2_000, 'Nourriture', '2026-10-22');     // 20 € au taux 660 → 13 200
    await xofTx('expense', 5_000, 'Nourriture', '2026-10-10');
    await xofTx('income', 40_000, 'Salaire', '2026-10-05');

    const daily = await getDailySeries(f.db, '2026-10-10', '2026-10-22');
    expect(daily.find((d) => d.date === '2026-10-10')?.expense).toBe(13_119 + 5_000);
    expect(daily.find((d) => d.date === '2026-10-22')?.expense).toBe(13_200);          // l'ancienne opération n'est PAS réévaluée
    const totals = await getTotals(f.db, '2026-10-01', '2026-10-31');
    expect(totals).toMatchObject({ income: 40_000, expense: 13_119 + 5_000 + 13_200 });
    expect((await getCategoryBreakdown(f.db, '2026-10-01', '2026-10-31'))[0]).toMatchObject({ name: 'Nourriture', amount: 31_319 });
    // les montants d'origine restent intacts, dans leur devise
    expect(await getTransaction(f.db, a.id)).toMatchObject({ amount: 2_000, currency: 'EUR', accountName: 'Compte Euro' });
    expect(await getTransaction(f.db, b.id)).toMatchObject({ amount: 2_000, currency: 'EUR' });
    // même total par catégorie que par jour (arrondis cohérents)
    expect(daily.reduce((s, d) => s + d.expense, 0)).toBe(totals.expense);
  });

  test('taux manquant : l\'opération est exclue des totaux avec avertissement, puis incluse dès qu\'un taux existe', async () => {
    await eurTx('expense', 2_000, 'Nourriture', '2026-10-10');
    await xofTx('expense', 5_000, 'Nourriture', '2026-10-10');
    expect(await getTotals(f.db, '2026-10-01', '2026-10-31')).toMatchObject({ expense: 5_000 });
    expect(await getExclusions(f.db, '2026-10-01', '2026-10-31')).toEqual({ count: 1, currencies: ['EUR'] });
    expect(await getExclusions(f.db, '2026-10-11', '2026-10-31')).toEqual({ count: 0, currencies: [] });
    expect(await getCategoryBreakdown(f.db, '2026-10-01', '2026-10-31')).toEqual([{ categoryId: f.cat('Nourriture'), name: 'Nourriture', amount: 5_000, percent: 100 }]);
    expect((await summarizeFilter(f.db, {})).excludedCount).toBe(1);

    await saveRate(f.db, { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: rate('655,957'), effectiveDate: '2026-10-01' }, clock);
    expect((await getTotals(f.db, '2026-10-01', '2026-10-31')).expense).toBe(5_000 + 13_119);
    expect((await getExclusions(f.db, '2026-10-01', '2026-10-31')).count).toBe(0);
  });

  test('un taux daté après l\'opération ne s\'applique pas (opération exclue)', async () => {
    await eurTx('expense', 2_000, 'Nourriture', '2026-10-10');
    await saveRate(f.db, { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: rate('655,957'), effectiveDate: '2026-10-15' }, clock);
    expect((await getExclusions(f.db, '2026-10-01', '2026-10-31')).count).toBe(1);
  });

  test('budgets en devise de référence : dépenses converties, exclusions comptées', async () => {
    await setBudget(f.db, { categoryId: f.cat('Nourriture'), month: '2026-10', amount: 50_000 }, clock);
    await xofTx('expense', 10_000, 'Nourriture', '2026-10-05');
    await eurTx('expense', 2_000, 'Nourriture', '2026-10-10');
    let b = (await getBudgetStatuses(f.db, '2026-10'))[0];
    expect(b).toMatchObject({ spent: 10_000, excludedCount: 1, percent: 20, level: 'ok' });   // la dépense en € est exclue, pas ignorée en silence

    await saveRate(f.db, { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: rate('655,957'), effectiveDate: '2026-10-01' }, clock);
    b = (await getBudgetStatuses(f.db, '2026-10'))[0];
    expect(b).toMatchObject({ spent: 23_119, excludedCount: 0, remaining: 26_881, percent: 46 });
    // un transfert (même devise) ne compte jamais
    const eur2 = await createAccount(f.db, { name: 'Euro épargne', type: 'bank', currency: 'EUR', initialBalance: 0, referenceDate: '2026-10-01' }, clock);
    await createTransaction(f.db, { type: 'transfer', amount: 5_000, accountId: eur.id, toAccountId: eur2.id, date: '2026-10-12' }, clock);
    expect((await getBudgetStatuses(f.db, '2026-10'))[0].spent).toBe(23_119);
  });

  test('comparaison de périodes en devise de référence', async () => {
    await saveRate(f.db, { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: rate('650'), effectiveDate: '2026-08-01' }, clock);
    await f.db.run("UPDATE accounts SET reference_date = '2026-08-01'");
    await eurTx('expense', 1_000, 'Loisirs', '2026-09-10');      // 10 € × 650 = 6 500
    await eurTx('expense', 2_000, 'Loisirs', '2026-10-10');      // 20 € × 650 = 13 000
    const c = await getPeriodComparison(f.db, 'month', '2026-10-24');
    expect(c.previous.expense).toBe(6_500);
    expect(c.current.expense).toBe(13_000);
    expect(c.expenseChangePercent).toBe(100);
  });

  test('transferts : refusés entre devises différentes, autorisés dans la même devise', async () => {
    const before = await count(f.db, 'transactions');
    await expect(createTransaction(f.db, { type: 'transfer', amount: 1_000, accountId: eur.id, toAccountId: f.cash.id, date: '2026-10-06' }, clock))
      .rejects.toThrow(/opérations de change ne sont pas encore disponibles/);
    await expect(createTransaction(f.db, { type: 'transfer', amount: 1_000, accountId: f.cash.id, toAccountId: eur.id, date: '2026-10-06' }, clock))
      .rejects.toThrow(/EUR/);
    expect(await count(f.db, 'transactions')).toBe(before);
    expect((await getGlobalBalance(f.db, '2026-10-24')).total).toBe(170_000);           // rien n'a bougé
    const eur2 = await createAccount(f.db, { name: 'Euro 2', type: 'cash', currency: 'EUR', initialBalance: 0, referenceDate: '2026-10-01' }, clock);
    await createTransaction(f.db, { type: 'transfer', amount: 2_500, accountId: eur.id, toAccountId: eur2.id, date: '2026-10-06' }, clock);
    expect(await getAccountBalance(f.db, eur.id)).toBe(7_500);
    expect(await getAccountBalance(f.db, eur2.id)).toBe(2_500);
    // transformer une dépense en transfert inter-devises est refusé aussi
    const t = await xofTx('expense', 500, 'Transport', '2026-10-07');
    await expect(updateTransaction(f.db, t.id, { type: 'transfer', amount: 500, accountId: f.cash.id, toAccountId: eur.id, date: '2026-10-07' }, clock)).rejects.toThrow(/change/);
  });

  test('déplacer une opération vers un compte d\'une autre devise est refusé ; même devise autorisé', async () => {
    const t = await xofTx('expense', 5_000, 'Transport', '2026-10-07');
    const input = (accountId: number) => ({ type: 'expense' as const, amount: 5_000, accountId, categoryId: f.cat('Transport'), date: '2026-10-07' });
    await expect(updateTransaction(f.db, t.id, input(eur.id), clock)).rejects.toThrow(/autre devise \(XOF → EUR\)/);
    expect((await getTransaction(f.db, t.id))).toMatchObject({ accountId: f.cash.id, amount: 5_000, currency: 'XOF' });
    await expect(updateTransaction(f.db, t.id, input(f.momo.id), clock)).resolves.toMatchObject({ accountId: f.momo.id });
  });

  test('évolution du solde : chaque jour au taux du jour ; le dernier point égale le solde global', async () => {
    await saveRate(f.db, { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: rate('655,957'), effectiveDate: '2026-10-01' }, clock);
    await saveRate(f.db, { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: rate('660'), effectiveDate: '2026-10-20' }, clock);
    await eurTx('income', 2_000, 'Vente', '2026-10-10');       // +20 € → 120 € à partir du 10
    const h = await getBalanceHistoryDetailed(f.db, '2026-10-09', '2026-10-24');
    const at = (d: string) => h.points.find((p) => p.date === d)!.balance;
    expect(h.missingCurrencies).toEqual([]);
    expect(at('2026-10-09')).toBe(170_000 + 65_596);            // 100 € à 655,957
    expect(at('2026-10-10')).toBe(170_000 + 78_715);            // 120 € × 655,957 = 78 714,84
    expect(at('2026-10-19')).toBe(170_000 + 78_715);
    expect(at('2026-10-20')).toBe(170_000 + 79_200);            // 120 € à 660 : le solde est revalorisé par le taux (voir README)
    expect(at('2026-10-24')).toBe((await getGlobalBalance(f.db, '2026-10-24')).total);
  });

  test('évolution du solde sans taux : la devise est exclue et signalée', async () => {
    const h = await getBalanceHistoryDetailed(f.db, '2026-10-20', '2026-10-24');
    expect(h.missingCurrencies).toEqual(['EUR']);
    expect(h.points.every((p) => p.balance === 170_000)).toBe(true);
  });

  test('totaux d\'un filtre d\'historique convertis (transferts exclus)', async () => {
    await saveRate(f.db, { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: rate('655,957'), effectiveDate: '2026-10-01' }, clock);
    await eurTx('income', 1_000, 'Vente', '2026-10-05');       // 10 € → 6 560
    await xofTx('expense', 2_000, 'Transport', '2026-10-06');
    expect(await summarizeFilter(f.db, {})).toEqual({ count: 2, income: 6_560, expense: 2_000, excludedCount: 0 });
  });
});

describe('taux de change : saisie manuelle', () => {
  let f: Fixture;
  beforeEach(async () => { f = await setup(); });
  afterEach(() => f.close());

  test('validation : devises, taux, date', async () => {
    const ok = { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: rate('655,957'), effectiveDate: '2026-10-01' };
    await expect(saveRate(f.db, { ...ok, fromCurrency: 'ZZZ' }, clock)).rejects.toThrow(/devises valides/);
    await expect(saveRate(f.db, { ...ok, toCurrency: 'eur' }, clock)).rejects.toThrow(/devises valides/);
    await expect(saveRate(f.db, { ...ok, toCurrency: 'EUR' }, clock)).rejects.toThrow(/différentes/);
    for (const bad of [0, -5, 1.5, NaN, Infinity, '655' as never, null as never, 10_000_001 * 100_000_000]) {
      await expect(saveRate(f.db, { ...ok, rateScaled: bad }, clock)).rejects.toThrow(ValidationError);
    }
    await expect(saveRate(f.db, { ...ok, effectiveDate: '2026-02-30' }, clock)).rejects.toThrow(/date/i);
    await expect(saveRate(f.db, { ...ok, effectiveDate: '2026-10-25' }, clock)).rejects.toThrow(/futur/);
    expect(await count(f.db, 'exchange_rates')).toBe(0);
  });

  test('même paire et même date : le taux est remplacé, pas dupliqué ; suppression', async () => {
    const a = await saveRate(f.db, { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: rate('650'), effectiveDate: '2026-10-01' }, clock);
    const b = await saveRate(f.db, { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: rate('656'), effectiveDate: '2026-10-01' }, clock);
    expect(b.id).toBe(a.id);
    expect(b.rateScaled).toBe(rate('656'));
    await saveRate(f.db, { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: rate('660'), effectiveDate: '2026-10-20' }, clock);
    expect((await listRates(f.db)).map((r) => r.effectiveDate)).toEqual(['2026-10-20', '2026-10-01']);   // récent d'abord
    await deleteRate(f.db, a.id);
    expect(await count(f.db, 'exchange_rates')).toBe(1);
    await expect(deleteRate(f.db, 9999)).rejects.toThrow(/introuvable/);
  });

  test('la base refuse les taux incohérents (CHECK / UNIQUE)', async () => {
    const ins = (from: string, to: string, r: number) =>
      f.db.run("INSERT INTO exchange_rates (from_currency, to_currency, rate_scaled, effective_date, created_at, updated_at) VALUES (?, ?, ?, '2026-10-01', 'x', 'x')", [from, to, r]);
    await expect(ins('EUR', 'EUR', 100)).rejects.toThrow();
    await expect(ins('EUR', 'XOF', 0)).rejects.toThrow();
    await ins('EUR', 'XOF', 100);
    await expect(ins('EUR', 'XOF', 200)).rejects.toThrow();
  });
});

describe('migration v1 → v2', () => {
  test('les données FCFA existantes sont conservées à l\'identique (comptes en XOF, soldes inchangés)', async () => {
    // Une vraie base « version 1 », comme celle d'un téléphone déjà utilisé
    const raw = new DatabaseSync(':memory:');
    raw.exec('PRAGMA foreign_keys = ON;');
    const db = createDb({
      async run(sql, params) { const r = raw.prepare(sql).run(...params.map((v) => (typeof v === 'number' && Number.isInteger(v) ? BigInt(v) : v))); return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) }; },
      async all<T>(sql: string, params: (string | number | null)[]) { return raw.prepare(sql).all(...params.map((v) => (typeof v === 'number' && Number.isInteger(v) ? BigInt(v) : v))) as unknown as T[]; },
      async exec(sql) { raw.exec(sql); },
    });
    for (const st of MIGRATIONS[0].statements) await db.exec(st);
    await db.exec('PRAGMA user_version = 1');
    expect(await getSchemaVersion(db)).toBe(1);
    await db.exec(`
      INSERT INTO accounts VALUES (1, 'Espèces', 'cash', 50000, '2026-10-01', 0, 'x', 'x');
      INSERT INTO accounts VALUES (2, 'Mobile Money', 'mobile_money', 20000, '2026-10-01', 0, 'x', 'x');
      INSERT INTO categories VALUES (1, 'Nourriture', 'expense', 1, 1, 'x', 'x');
      INSERT INTO transactions VALUES (1, 'expense', 12500, 1, NULL, 1, 'Marché', '2026-10-10', 'x', 'x');
      INSERT INTO transactions VALUES (2, 'transfer', 5000, 1, 2, NULL, NULL, '2026-10-11', 'x', 'x');
      INSERT INTO budgets VALUES (1, 1, '2026-10', 20000, 'x', 'x');
      INSERT INTO settings VALUES ('currency', 'FCFA');
    `);

    await migrate(db);
    expect(await getSchemaVersion(db)).toBe(2);
    const accounts = await getAccountsWithBalances(db);
    expect(accounts.map((a) => [a.name, a.currency, a.initialBalance, a.balance])).toEqual([
      ['Espèces', 'XOF', 50_000, 32_500],         // 50 000 − 12 500 − 5 000
      ['Mobile Money', 'XOF', 20_000, 25_000],    // + 5 000
    ]);
    const g = await getGlobalBalance(db, '2026-10-24');
    expect(g).toMatchObject({ currency: 'XOF', total: 57_500, excluded: [] });
    expect((await getBudgetStatuses(db, '2026-10'))[0]).toMatchObject({ spent: 12_500, amount: 20_000, excludedCount: 0 });
    expect(await getReferenceCurrency(db)).toBe('XOF');
    expect(await count(db, 'exchange_rates')).toBe(0);
    expect((await db.all<{ n: number }>('PRAGMA foreign_key_check')).length).toBe(0);
    await migrate(db);                                      // idempotent
    expect(await count(db, 'transactions')).toBe(2);
    raw.close();
  });
});

describe('sauvegarde v2 et compatibilité v1', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await setup();
    const eur = await createAccount(f.db, { name: 'Compte Euro', type: 'bank', currency: 'EUR', initialBalance: 10_000, referenceDate: '2026-10-01' }, clock);
    await saveRate(f.db, { fromCurrency: 'EUR', toCurrency: 'XOF', rateScaled: rate('655,957'), effectiveDate: '2026-10-01' }, clock);
    await createTransaction(f.db, { type: 'expense', amount: 1_250, accountId: eur.id, categoryId: f.cat('Transport'), date: '2026-10-08', description: 'Taxi' }, clock);
  });
  afterEach(() => f.close());

  test('export puis restauration : devises, taux et soldes identiques', async () => {
    const file = await createBackup(f.db, clock);
    expect(file.formatVersion).toBe(2);
    expect(file.data.settings.referenceCurrency).toBe('XOF');
    expect(file.data.accounts.map((a) => a.currency)).toEqual(['XOF', 'XOF', 'XOF', 'EUR']);
    expect(file.data.exchangeRates).toHaveLength(1);
    const target = await openTestDb();
    const summary = await restoreBackup(target.db, parseBackup(serializeBackup(file)));
    expect(summary).toMatchObject({ accounts: 4, transactions: 1, exchangeRates: 1 });
    expect((await createBackup(target.db, clock)).data).toEqual(file.data);
    expect(await getGlobalBalance(target.db, '2026-10-24')).toEqual(await getGlobalBalance(f.db, '2026-10-24'));
    expect((await getAccountsWithBalances(target.db)).find((a) => a.currency === 'EUR')?.balance).toBe(8_750);   // 87,50 €
    target.close();
  });

  test('une ancienne sauvegarde v1 (FCFA) se restaure : tout passe en XOF, sans taux', async () => {
    const j = JSON.parse(serializeBackup(await createBackup(f.db, clock)));
    j.formatVersion = 1;
    j.data.settings = { currency: 'FCFA' };
    delete j.data.exchangeRates;
    j.data.accounts = j.data.accounts.filter((a: { currency: string }) => a.currency === 'XOF');
    j.data.transactions = [];
    j.data.accounts.forEach((a: Record<string, unknown>) => delete a.currency);
    const t = await openTestDb();
    await restoreBackup(t.db, parseBackup(JSON.stringify(j)));
    const accounts = await getAccountsWithBalances(t.db);
    expect(accounts.every((a) => a.currency === 'XOF')).toBe(true);
    expect(accounts.map((a) => a.balance)).toEqual([50_000, 20_000, 100_000]);
    expect(await count(t.db, 'exchange_rates')).toBe(0);
    expect(await getReferenceCurrency(t.db)).toBe('XOF');
    t.close();
  });

  test('la restauration remplace aussi les taux existants', async () => {
    const file = await createBackup(f.db, clock);
    const other = await openTestDb();
    await other.db.run("INSERT INTO exchange_rates (from_currency, to_currency, rate_scaled, effective_date, created_at, updated_at) VALUES ('USD','XOF',60000000000,'2026-01-01','x','x')");
    await restoreBackup(other.db, parseBackup(serializeBackup(file)));
    expect((await listRates(other.db)).map((r) => r.fromCurrency)).toEqual(['EUR']);
    other.close();
  });

  test('fichiers v2 invalides rejetés', async () => {
    const base = async () => JSON.parse(serializeBackup(await createBackup(f.db, clock)));
    const cases: Array<[string, (j: any) => void, RegExp]> = [
      ['devise de compte inconnue', (j) => { j.data.accounts[3].currency = 'ZZZ'; }, /devise inconnue/],
      ['devise de compte absente', (j) => { delete j.data.accounts[0].currency; }, /currency/],
      ['devise de référence inconnue', (j) => { j.data.settings.referenceCurrency = 'ZZZ'; }, /devise inconnue/],
      ['taux nul', (j) => { j.data.exchangeRates[0].rateScaled = 0; }, /rateScaled/],
      ['taux décimal', (j) => { j.data.exchangeRates[0].rateScaled = 1.5; }, /entier attendu/],
      ['taux trop grand', (j) => { j.data.exchangeRates[0].rateScaled = 1e17; }, /rateScaled/],
      ['taux même devise', (j) => { j.data.exchangeRates[0].toCurrency = 'EUR'; }, /différentes/],
      ['taux devise inconnue', (j) => { j.data.exchangeRates[0].fromCurrency = 'QQQ'; }, /devise inconnue/],
      ['taux date invalide', (j) => { j.data.exchangeRates[0].effectiveDate = '2026-13-01'; }, /date invalide/],
      ['taux en double', (j) => { j.data.exchangeRates.push({ ...j.data.exchangeRates[0], id: 99 }); }, /même paire/],
      ['liste de taux absente', (j) => { delete j.data.exchangeRates; }, /liste attendue/],
      ['transfert entre devises différentes', (j) => {
        j.data.transactions.push({ id: 50, type: 'transfer', amount: 100, accountId: j.data.accounts[0].id, toAccountId: j.data.accounts[3].id, categoryId: null, description: null, date: '2026-10-09', createdAt: 'x'.replace('x', '2026-10-09T00:00:00Z'), updatedAt: '2026-10-09T00:00:00Z' });
      }, /deux devises différentes/],
    ];
    for (const [label, mutate, re] of cases) {
      const j = await base();
      mutate(j);
      try { validateBackup(j); throw new Error(`« ${label} » aurait dû être rejeté`); }
      catch (e) { expect(e).toBeInstanceOf(BackupError); expect((e as Error).message).toMatch(re); }
    }
  });
});
