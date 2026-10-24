import type { Db } from '../db/types';
import {
  addDays,
  addMonths,
  daysBetween,
  eachDay,
  endOfMonth,
  endOfWeek,
  monthOf,
  startOfMonth,
  startOfWeek,
} from '../utils/dates';

/**
 * Statistiques globales : seules les entrées et dépenses sont comptées.
 * Les TRANSFERTS sont toujours exclus (ni revenu ni dépense).
 */

export type Granularity = 'day' | 'week' | 'month';

export interface DateRange {
  from: string;
  to: string;
}

export interface PeriodTotals {
  income: number;
  expense: number;
  /** Entrées − dépenses. */
  net: number;
  /** (entrées − dépenses) / entrées en pourcentage, ou null si les entrées ne sont pas positives. */
  savingsRate: number | null;
}

export interface DailyPoint {
  date: string;
  income: number;
  expense: number;
}

export interface CategoryShare {
  categoryId: number;
  name: string;
  amount: number;
  /** Part des dépenses de la période, en % (affichage). */
  percent: number;
}

export function computeTotals(income: number, expense: number): PeriodTotals {
  return {
    income,
    expense,
    net: income - expense,
    savingsRate: income > 0 ? ((income - expense) * 100) / income : null,
  };
}

export async function getTotals(db: Db, from: string, to: string): Promise<PeriodTotals> {
  const row = await db.first<{ income: number | null; expense: number | null }>(
    `SELECT
       SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
       SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
     FROM transactions WHERE type IN ('income', 'expense') AND date >= ? AND date <= ?`,
    [from, to],
  );
  return computeTotals(row?.income ?? 0, row?.expense ?? 0);
}

/** Entrées/dépenses de chaque jour de la période, y compris les jours sans transaction (à 0). */
export async function getDailySeries(db: Db, from: string, to: string): Promise<DailyPoint[]> {
  const rows = await db.all<{ date: string; income: number; expense: number }>(
    `SELECT date,
       SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
       SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
     FROM transactions WHERE type IN ('income', 'expense') AND date >= ? AND date <= ?
     GROUP BY date`,
    [from, to],
  );
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return eachDay(from, to).map((date) => {
    const r = byDate.get(date);
    return { date, income: r?.income ?? 0, expense: r?.expense ?? 0 };
  });
}

/** Répartition des dépenses par catégorie, de la plus importante à la plus faible. */
export async function getCategoryBreakdown(db: Db, from: string, to: string): Promise<CategoryShare[]> {
  const rows = await db.all<{ category_id: number; name: string; amount: number }>(
    `SELECT t.category_id, c.name, SUM(t.amount) AS amount
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.type = 'expense' AND t.date >= ? AND t.date <= ?
     GROUP BY t.category_id, c.name ORDER BY amount DESC, c.name ASC`,
    [from, to],
  );
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return rows.map((r) => ({
    categoryId: r.category_id,
    name: r.name,
    amount: r.amount,
    percent: total > 0 ? Math.round((r.amount * 100) / total) : 0,
  }));
}

/** Période affichée dans les totaux : le jour, la semaine (lundi→dimanche) ou le mois de `anchor`. */
export function periodRange(g: Granularity, anchor: string): DateRange {
  switch (g) {
    case 'day':
      return { from: anchor, to: anchor };
    case 'week':
      return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
    case 'month':
      return { from: startOfMonth(monthOf(anchor)), to: endOfMonth(monthOf(anchor)) };
  }
}

/** Période de comparaison : la précédente de même nature (jour / semaine / mois). */
export function previousPeriodRange(g: Granularity, anchor: string): DateRange {
  return periodRange(g, shiftAnchor(g, anchor, -1));
}

/** Fenêtre des graphiques : 7 derniers jours pour « jour », sinon la période elle-même. */
export function chartRange(g: Granularity, anchor: string): DateRange {
  if (g === 'day') return { from: addDays(anchor, -6), to: anchor };
  return periodRange(g, anchor);
}

export function shiftAnchor(g: Granularity, anchor: string, direction: 1 | -1): string {
  switch (g) {
    case 'day':
      return addDays(anchor, direction);
    case 'week':
      return addDays(anchor, 7 * direction);
    case 'month': {
      const target = addMonths(monthOf(anchor), direction);
      const day = Math.min(Number(anchor.slice(8, 10)), Number(endOfMonth(target).slice(8, 10)));
      return `${target}-${String(day).padStart(2, '0')}`;
    }
  }
}

export interface PeriodComparison {
  current: PeriodTotals;
  previous: PeriodTotals;
  /** Évolution en % des dépenses / entrées par rapport à la période précédente (null si base nulle). */
  expenseChangePercent: number | null;
  incomeChangePercent: number | null;
}

function changePercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) * 100) / previous);
}

export async function getPeriodComparison(db: Db, g: Granularity, anchor: string): Promise<PeriodComparison> {
  const cur = periodRange(g, anchor);
  const prev = previousPeriodRange(g, anchor);
  const [current, previous] = await Promise.all([getTotals(db, cur.from, cur.to), getTotals(db, prev.from, prev.to)]);
  return {
    current,
    previous,
    expenseChangePercent: changePercent(current.expense, previous.expense),
    incomeChangePercent: changePercent(current.income, previous.income),
  };
}

export interface WeekTotals extends PeriodTotals {
  from: string;
  to: string;
}

/** Totaux hebdomadaires d'un mois (semaines lundi→dimanche, tronquées aux bornes du mois). */
export async function getWeeklyTotals(db: Db, month: string): Promise<WeekTotals[]> {
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const daily = await getDailySeries(db, first, last);
  const weeks: WeekTotals[] = [];
  let cursor = first;
  while (cursor <= last) {
    const to = endOfWeek(cursor) < last ? endOfWeek(cursor) : last;
    const slice = daily.filter((d) => d.date >= cursor && d.date <= to);
    const totals = computeTotals(
      slice.reduce((s, d) => s + d.income, 0),
      slice.reduce((s, d) => s + d.expense, 0),
    );
    weeks.push({ from: cursor, to, ...totals });
    cursor = addDays(to, 1);
  }
  return weeks;
}

export interface MonthTotals extends PeriodTotals {
  month: string;
}

/** Totaux mensuels sur `count` mois se terminant à `endMonth` (mois sans données = 0). */
export async function getMonthlyTotals(db: Db, endMonth: string, count: number): Promise<MonthTotals[]> {
  const out: MonthTotals[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = addMonths(endMonth, -i);
    out.push({ month, ...(await getTotals(db, startOfMonth(month), endOfMonth(month))) });
  }
  return out;
}

export function daysInRange(r: DateRange): number {
  return daysBetween(r.from, r.to) + 1;
}
