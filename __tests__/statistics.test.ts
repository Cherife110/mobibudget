import { setup, clock, TODAY, type Fixture } from './helpers/fixtures';
import { openTestDb } from './helpers/testDb';
import { createTransaction } from '../src/services/transaction.service';
import { archiveAccount } from '../src/services/account.service';
import { getBalanceHistory, getGlobalBalance, getAccountsWithBalances, buildBalanceSeries } from '../src/services/balance.service';
import {
  getTotals, getDailySeries, getCategoryBreakdown, getPeriodComparison, getWeeklyTotals, getMonthlyTotals,
  computeTotals, periodRange, previousPeriodRange, chartRange, shiftAnchor,
} from '../src/services/statistics.service';

describe('statistiques', () => {
  let f: Fixture;
  beforeEach(async () => { f = await setup(); });
  afterEach(() => f.close());

  const tx = (type: 'income' | 'expense', amount: number, cat: string, date: string, accountId = f.cash.id) =>
    createTransaction(f.db, { type, amount, accountId, categoryId: f.cat(cat), date }, clock);

  async function scenario() {
    await tx('income', 30_000, 'Salaire', '2026-10-05');
    await tx('expense', 12_500, 'Nourriture', '2026-10-10');
    await tx('expense', 2_500, 'Transport', '2026-10-10');
    await createTransaction(f.db, { type: 'transfer', amount: 40_000, accountId: f.bank.id, toAccountId: f.cash.id, date: '2026-10-12' }, clock);
  }

  test('base de données vide : aucun plantage, tout à zéro', async () => {
    const e = await openTestDb();
    expect(await getTotals(e.db, '2026-10-01', '2026-10-31')).toEqual({ income: 0, expense: 0, net: 0, savingsRate: null });
    expect(await getCategoryBreakdown(e.db, '2026-10-01', '2026-10-31')).toEqual([]);
    expect((await getDailySeries(e.db, '2026-10-01', '2026-10-03')).map((d) => [d.income, d.expense])).toEqual([[0, 0], [0, 0], [0, 0]]);
    expect(await getGlobalBalance(e.db)).toBe(0);
    expect(await getAccountsWithBalances(e.db)).toEqual([]);
    expect((await getBalanceHistory(e.db, '2026-10-01', '2026-10-03')).map((p) => p.balance)).toEqual([0, 0, 0]);
    const cmp = await getPeriodComparison(e.db, 'month', '2026-10-24');
    expect(cmp).toMatchObject({ expenseChangePercent: null, incomeChangePercent: null });
    expect(await getWeeklyTotals(e.db, '2026-10')).toHaveLength(5);
    e.close();
  });

  test('les transferts ne sont ni des revenus ni des dépenses dans les statistiques globales', async () => {
    await scenario();
    const t = await getTotals(f.db, '2026-10-01', '2026-10-31');
    expect(t).toMatchObject({ income: 30_000, expense: 15_000, net: 15_000 });
    expect(t.savingsRate).toBeCloseTo(50, 5);
    const day = await getTotals(f.db, '2026-10-12', '2026-10-12');                         // jour du transfert
    expect(day).toMatchObject({ income: 0, expense: 0, net: 0 });
    const series = await getDailySeries(f.db, '2026-10-12', '2026-10-12');
    expect(series).toEqual([{ date: '2026-10-12', income: 0, expense: 0 }]);
    expect(await getGlobalBalance(f.db)).toBe(170_000 + 30_000 - 15_000);                  // le transfert ne change pas le global
  });

  test('série quotidienne : jours sans transaction à zéro, jours chargés agrégés', async () => {
    await scenario();
    const s = await getDailySeries(f.db, '2026-10-09', '2026-10-11');
    expect(s).toEqual([
      { date: '2026-10-09', income: 0, expense: 0 },
      { date: '2026-10-10', income: 0, expense: 15_000 },
      { date: '2026-10-11', income: 0, expense: 0 },
    ]);
  });

  test('répartition par catégorie : triée, parts en %, seules les dépenses', async () => {
    await scenario();
    const b = await getCategoryBreakdown(f.db, '2026-10-01', '2026-10-31');
    expect(b.map((c) => [c.name, c.amount, c.percent])).toEqual([['Nourriture', 12_500, 83], ['Transport', 2_500, 17]]);
  });

  test('taux d\'épargne : indéfini sans entrées, négatif si on dépense plus qu\'on ne gagne', async () => {
    await tx('expense', 4_000, 'Loisirs', '2026-10-03');
    const noIncome = await getTotals(f.db, '2026-10-01', '2026-10-31');
    expect(noIncome.savingsRate).toBeNull();
    expect(noIncome.net).toBe(-4_000);
    await tx('income', 1_000, 'Vente', '2026-10-04');
    const over = await getTotals(f.db, '2026-10-01', '2026-10-31');
    expect(over.savingsRate).toBeCloseTo(-300, 5);
    expect(computeTotals(0, 0).savingsRate).toBeNull();
    expect(computeTotals(10_000, 10_000).savingsRate).toBe(0);
  });

  test('évolution du solde : reconstituée jour par jour (pas la simple variation du jour)', async () => {
    await scenario();
    const h = await getBalanceHistory(f.db, '2026-09-29', TODAY);
    const at = (d: string) => h.find((p) => p.date === d)!.balance;
    expect(at('2026-09-29')).toBe(0);                    // avant la date de référence des comptes
    expect(at('2026-09-30')).toBe(0);
    expect(at('2026-10-01')).toBe(170_000);              // soldes initiaux
    expect(at('2026-10-04')).toBe(170_000);
    expect(at('2026-10-05')).toBe(200_000);              // + salaire
    expect(at('2026-10-09')).toBe(200_000);              // jour sans transaction : le solde persiste
    expect(at('2026-10-10')).toBe(185_000);              // − dépenses
    expect(at('2026-10-12')).toBe(185_000);              // transfert interne : inchangé
    expect(at(TODAY)).toBe(185_000);
    expect(at(TODAY)).toBe(await getGlobalBalance(f.db));  // cohérent avec le solde affiché
    expect(h).toHaveLength(26);
  });

  test('évolution du solde : fenêtre qui commence au milieu de l\'historique', async () => {
    await scenario();
    const h = await getBalanceHistory(f.db, '2026-10-10', '2026-10-11');
    expect(h).toEqual([{ date: '2026-10-10', balance: 185_000 }, { date: '2026-10-11', balance: 185_000 }]);
  });

  test('un compte archivé sort de l\'évolution du solde comme du solde global', async () => {
    await tx('income', 5_000, 'Vente', '2026-10-05', f.momo.id);
    await archiveAccount(f.db, f.momo.id, clock);
    const h = await getBalanceHistory(f.db, '2026-10-05', '2026-10-05');
    expect(h[0].balance).toBe(150_000);
    expect(h[0].balance).toBe(await getGlobalBalance(f.db));
  });

  test('buildBalanceSeries (fonction pure) cumule correctement les variations', () => {
    const s = buildBalanceSeries([{ date: '2026-01-01', delta: 100 }, { date: '2026-01-03', delta: -30 }, { date: '2025-12-01', delta: 50 }], '2026-01-01', '2026-01-04');
    expect(s.map((p) => p.balance)).toEqual([150, 150, 120, 120]);
  });

  test('comparaison avec le mois précédent (mois sans revenu inclus)', async () => {
    await f.db.run("UPDATE accounts SET reference_date = '2026-08-01'");                     // comptes actifs depuis août
    await tx('expense', 10_000, 'Nourriture', '2026-09-10');
    await tx('expense', 15_000, 'Nourriture', '2026-10-10');
    await tx('income', 8_000, 'Vente', '2026-10-11');
    const c = await getPeriodComparison(f.db, 'month', '2026-10-24');
    expect(c.current).toMatchObject({ income: 8_000, expense: 15_000 });
    expect(c.previous).toMatchObject({ income: 0, expense: 10_000, savingsRate: null });     // septembre sans revenu
    expect(c.expenseChangePercent).toBe(50);
    expect(c.incomeChangePercent).toBeNull();                                                 // base nulle
  });

  test('périodes : jour, semaine (lun→dim), mois, précédent et fenêtre de graphique', () => {
    expect(periodRange('day', TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(periodRange('week', TODAY)).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(periodRange('month', TODAY)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(previousPeriodRange('week', TODAY)).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(previousPeriodRange('month', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(chartRange('day', TODAY)).toEqual({ from: '2026-10-18', to: TODAY });
    expect(shiftAnchor('month', '2026-03-31', -1)).toBe('2026-02-28');
    expect(shiftAnchor('month', '2026-12-15', 1)).toBe('2027-01-15');
    expect(shiftAnchor('week', TODAY, -1)).toBe('2026-10-17');
  });

  test('totaux hebdomadaires et mensuels cohérents entre eux', async () => {
    await scenario();
    await tx('expense', 1_000, 'Loisirs', '2026-10-23');
    const weeks = await getWeeklyTotals(f.db, '2026-10');
    expect(weeks[0]).toMatchObject({ from: '2026-10-01', to: '2026-10-04' });               // semaine tronquée au 1er
    expect(weeks[weeks.length - 1]).toMatchObject({ from: '2026-10-26', to: '2026-10-31' });
    expect(weeks.reduce((s, w) => s + w.income, 0)).toBe(30_000);
    expect(weeks.reduce((s, w) => s + w.expense, 0)).toBe(16_000);
    const months = await getMonthlyTotals(f.db, '2026-10', 3);
    expect(months.map((m) => m.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(months[2]).toMatchObject({ income: 30_000, expense: 16_000 });
    expect(months[0]).toMatchObject({ income: 0, expense: 0 });
  });
});
