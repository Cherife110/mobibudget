import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RateWarning, exclusionText } from '../../src/components/RateWarning';
import { useApp } from '../../src/context/AppContext';
import { Card, EmptyState, Money, RowDivider, Screen, Segmented, SectionTitle } from '../../src/components/ui';
import { BarChart, DonutChart, LineChart } from '../../src/components/charts';
import { useQuery } from '../../src/hooks/useQuery';
import { colors } from '../../src/theme';
import { getBalanceHistoryDetailed } from '../../src/services/balance.service';
import { getExclusions } from '../../src/services/converted.service';
import {
  chartRange, getCategoryBreakdown, getDailySeries, getMonthlyTotals, getPeriodComparison, getWeeklyTotals,
  periodRange, shiftAnchor, type Granularity,
} from '../../src/services/statistics.service';
import { formatDateFR, formatDateLongFR, formatDayMonthShort, formatMonthFR, monthOf, todayISO } from '../../src/utils/dates';
import { formatMoney } from '../../src/utils/money';

function periodLabel(g: Granularity, anchor: string): string {
  const r = periodRange(g, anchor);
  if (g === 'day') return formatDateLongFR(anchor);
  if (g === 'week') return `${formatDateFR(r.from)} → ${formatDateFR(r.to)}`;
  return formatMonthFR(monthOf(anchor));
}

function changeText(pct: number | null, label: string): string {
  if (pct === null) return `${label} : pas de comparaison possible (période précédente à 0)`;
  if (pct === 0) return `${label} : stable par rapport à la période précédente`;
  return `${label} : ${pct > 0 ? '+' : ''}${pct} % par rapport à la période précédente`;
}

export default function Statistics() {
  const { settings } = useApp();
  const ref = settings.referenceCurrency;
  const [g, setG] = useState<Granularity>('month');
  const [anchor, setAnchor] = useState(todayISO());
  const today = todayISO();
  const range = useMemo(() => periodRange(g, anchor), [g, anchor]);
  const canNext = range.to < today;

  const { data, error } = useQuery(async (db) => {
    const chart = chartRange(g, anchor);
    const wide = { from: range.from < chart.from ? range.from : chart.from, to: range.to > chart.to ? range.to : chart.to };
    const [comparison, daily, breakdown, history, exclusions, weeks, months] = await Promise.all([
      getPeriodComparison(db, g, anchor),
      getDailySeries(db, chart.from, chart.to),
      getCategoryBreakdown(db, range.from, range.to),
      getBalanceHistoryDetailed(db, chart.from, chart.to),
      getExclusions(db, wide.from, wide.to),
      g === 'month' ? getWeeklyTotals(db, monthOf(anchor)) : Promise.resolve([]),
      getMonthlyTotals(db, monthOf(anchor), 6),
    ]);
    return { comparison, daily, breakdown, history, exclusions, weeks, months };
  }, [g, anchor]);

  const cur = data?.comparison.current;
  const prevLabel = g === 'day' ? 'la veille' : g === 'week' ? 'la semaine précédente' : 'le mois précédent';

  return (
    <Screen>
      <Segmented<Granularity>
        value={g}
        onChange={(v) => { setG(v); setAnchor(todayISO()); }}
        options={[{ value: 'day', label: 'Jour' }, { value: 'week', label: 'Semaine' }, { value: 'month', label: 'Mois' }]}
      />
      <View style={styles.nav}>
        <Pressable onPress={() => setAnchor(shiftAnchor(g, anchor, -1))} hitSlop={12} accessibilityRole="button" accessibilityLabel="Période précédente" style={styles.arrow}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.navLabel}>{periodLabel(g, anchor)}</Text>
        <Pressable onPress={() => canNext && setAnchor(shiftAnchor(g, anchor, 1))} hitSlop={12} accessibilityRole="button" accessibilityLabel="Période suivante" style={[styles.arrow, !canNext && { opacity: 0.25 }]}>
          <Ionicons name="chevron-forward" size={22} color={colors.text} />
        </Pressable>
      </View>

      {error ? <EmptyState icon="alert-circle-outline" title="Chargement impossible" text={error} /> : null}

      {data && data.exclusions.count > 0 ? <RateWarning text={exclusionText(data.exclusions.count, data.exclusions.currencies)} /> : null}
      {data && data.history.missingCurrencies.length > 0 ? (
        <RateWarning text={`Le solde en ${data.history.missingCurrencies.join(', ')} n'est pas inclus dans l'évolution certains jours : aucun taux de change applicable.`} />
      ) : null}
      {cur ? (
        <>
          <View style={styles.row}>
            <Card style={styles.half}><Text style={styles.label}>Entrées</Text><Money amount={cur.income} kind="income" size={17} /></Card>
            <Card style={styles.half}><Text style={styles.label}>Dépenses</Text><Money amount={cur.expense} kind="expense" size={17} /></Card>
          </View>
          <Card style={{ gap: 10 }}>
            <View style={styles.between}>
              <Text style={styles.label}>Variation nette</Text>
              <Money amount={cur.net} signed size={16} />
            </View>
            <RowDivider />
            <View style={styles.between}>
              <Text style={styles.label}>Taux d'épargne</Text>
              <Text style={styles.value}>{cur.savingsRate === null ? '—' : `${Math.round(cur.savingsRate)} %`}</Text>
            </View>
            {cur.savingsRate === null ? <Text style={styles.note}>Aucune entrée sur cette période : le taux d'épargne n'est pas défini.</Text> : null}
            <RowDivider />
            <Text style={styles.note}>{changeText(data!.comparison.expenseChangePercent, 'Dépenses')}</Text>
            <Text style={styles.note}>{changeText(data!.comparison.incomeChangePercent, 'Entrées')}</Text>
            <Text style={styles.note}>Comparé à {prevLabel} : {formatMoney(data!.comparison.previous.expense, ref)} de dépenses, {formatMoney(data!.comparison.previous.income, ref)} d'entrées.</Text>
            <Text style={styles.note}>Les transferts entre comptes ne sont pas comptés. Montants exprimés en {ref} (chaque opération est convertie au taux de sa date).</Text>
          </Card>

          <SectionTitle title={g === 'day' ? 'Entrées et dépenses · 7 derniers jours' : 'Entrées et dépenses'} />
          <Card><BarChart currency={ref} data={data!.daily.map((d) => ({ label: formatDayMonthShort(d.date), income: d.income, expense: d.expense }))} /></Card>

          <SectionTitle title="Répartition des dépenses" />
          <Card>
            {data!.breakdown.length === 0 ? (
              <EmptyState icon="pie-chart-outline" title="Aucune dépense" text="Rien à répartir sur cette période." />
            ) : (
              <DonutChart slices={data!.breakdown} currency={ref} />
            )}
          </Card>

          <SectionTitle title="Évolution du solde total" />
          <Card><LineChart points={data!.history.points} currency={ref} /></Card>

          {g === 'month' ? (
            <>
              <SectionTitle title="Totaux par semaine" />
              <Card style={{ paddingVertical: 4 }}>
                {data!.weeks.map((w, i) => (
                  <View key={w.from}>
                    {i > 0 && <RowDivider />}
                    <View style={styles.weekRow}>
                      <Text style={styles.weekName}>{formatDayMonthShort(w.from)} – {formatDayMonthShort(w.to)}</Text>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Money amount={w.income} kind="income" size={13} />
                        <Money amount={w.expense} kind="expense" size={13} />
                      </View>
                    </View>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          <SectionTitle title="Totaux mensuels · 6 derniers mois" />
          <Card style={{ paddingVertical: 4 }}>
            {data!.months.map((m, i) => (
              <View key={m.month}>
                {i > 0 && <RowDivider />}
                <View style={styles.weekRow}>
                  <Text style={[styles.weekName, { textTransform: 'capitalize' }]}>{formatMonthFR(m.month)}</Text>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Money amount={m.income} kind="income" size={13} />
                    <Money amount={m.expense} kind="expense" size={13} />
                  </View>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  navLabel: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '700', color: colors.text, textTransform: 'capitalize' },
  label: { fontSize: 13, color: colors.muted, fontWeight: '600', marginBottom: 2 },
  value: { fontSize: 16, fontWeight: '700', color: colors.text },
  note: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  weekName: { fontSize: 14, fontWeight: '600', color: colors.text },
});
