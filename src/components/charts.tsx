import React, { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { colors, chartPalette } from '../theme';
import { formatCompact, formatMoney, currencySymbol } from '../utils/money';
import { formatDayMonthShort } from '../utils/dates';

function useWidth(initial = 320) {
  const [width, setWidth] = useState(initial);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    if (w > 0 && w !== width) setWidth(w);
  };
  return { width, onLayout };
}

/** Pas « agréable » pour l'axe vertical (1, 2, 5 × 10^n). */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function labelIndexes(n: number, max: number): Set<number> {
  if (n <= max) return new Set(Array.from({ length: n }, (_, i) => i));
  const out = new Set<number>();
  for (let k = 0; k < max; k++) out.add(Math.round((k * (n - 1)) / (max - 1)));
  return out;
}

const PAD = { left: 8, right: 8, top: 18, bottom: 22 };

export interface BarDatum { label: string; income: number; expense: number }

/** Entrées (vert) et dépenses (rouge) côte à côte pour chaque jour. */
export function BarChart({ data, height = 190, currency = 'XOF' }: { data: BarDatum[]; height?: number; currency?: string }) {
  const { width, onLayout } = useWidth();
  const max = niceMax(Math.max(0, ...data.flatMap((d) => [d.income, d.expense])));
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const group = innerW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(14, group * 0.38));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const show = labelIndexes(data.length, 6);
  const allZero = data.every((d) => d.income === 0 && d.expense === 0);
  return (
    <View onLayout={onLayout} accessible accessibilityLabel="Graphique des entrées et dépenses">
      <Svg width={width} height={height}>
        {[0, 0.5, 1].map((r) => (
          <Line key={r} x1={PAD.left} x2={width - PAD.right} y1={y(max * r)} y2={y(max * r)} stroke={colors.border} strokeWidth={1} />
        ))}
        <SvgText x={PAD.left} y={11} fontSize={10} fill={colors.muted}>{formatCompact(max)} {currencySymbol(currency)}</SvgText>
        {data.map((d, i) => {
          const cx = PAD.left + group * i + group / 2;
          return (
            <G key={d.label + i}>
              {d.income > 0 && <Rect x={cx - barW - 1} y={y(d.income)} width={barW} height={PAD.top + innerH - y(d.income)} rx={2} fill={colors.income} />}
              {d.expense > 0 && <Rect x={cx + 1} y={y(d.expense)} width={barW} height={PAD.top + innerH - y(d.expense)} rx={2} fill={colors.expense} />}
              {show.has(i) && <SvgText x={cx} y={height - 6} fontSize={10} fill={colors.muted} textAnchor="middle">{d.label}</SvgText>}
            </G>
          );
        })}
      </Svg>
      {allZero ? <Text style={styles.chartNote}>Aucune entrée ni dépense sur cette période.</Text> : null}
      <View style={styles.legend}>
        <LegendDot color={colors.income} label="Entrées" />
        <LegendDot color={colors.expense} label="Dépenses" />
      </View>
    </View>
  );
}

export interface Slice { name: string; amount: number; percent: number }

/** Répartition des dépenses par catégorie (anneau + légende). */
export function DonutChart({ slices, size = 170, currency = 'XOF' }: { slices: Slice[]; size?: number; currency?: string }) {
  const total = slices.reduce((s, x) => s + x.amount, 0);
  const stroke = 26;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <View style={{ gap: 12 }} accessible accessibilityLabel="Répartition des dépenses par catégorie">
      <View style={{ alignItems: 'center' }}>
        <Svg width={size} height={size}>
          <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.neutralBg} strokeWidth={stroke} fill="none" />
            {slices.map((s, i) => {
              const len = (s.amount / total) * C;
              const el = (
                <Circle
                  key={s.name}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  stroke={chartPalette[i % chartPalette.length]}
                  strokeWidth={stroke}
                  fill="none"
                  strokeDasharray={`${Math.max(0, len - (slices.length > 1 ? 1.5 : 0))} ${C}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return el;
            })}
          </G>
          <SvgText x={size / 2} y={size / 2 - 2} fontSize={11} fill={colors.muted} textAnchor="middle">Total</SvgText>
          <SvgText x={size / 2} y={size / 2 + 15} fontSize={14} fontWeight="bold" fill={colors.text} textAnchor="middle">{formatCompact(total)}</SvgText>
        </Svg>
      </View>
      {slices.map((s, i) => (
        <View key={s.name} style={styles.legendRow}>
          <View style={[styles.dot, { backgroundColor: chartPalette[i % chartPalette.length] }]} />
          <Text style={styles.legendName} numberOfLines={1}>{s.name}</Text>
          <Text style={styles.legendPct}>{s.percent} %</Text>
          <Text style={styles.legendAmount}>{formatMoney(s.amount, currency)}</Text>
        </View>
      ))}
    </View>
  );
}

export interface LinePoint { date: string; balance: number }

/** Évolution du solde total (valeur réelle à chaque date). */
export function LineChart({ points, height = 190, currency = 'XOF' }: { points: LinePoint[]; height?: number; currency?: string }) {
  const { width, onLayout } = useWidth();
  if (points.length === 0) return null;
  const values = points.map((p) => p.balance);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.1;
  min -= pad; max += pad;
  const innerW = width - PAD.left - PAD.right - 4;
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + 2 + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - min) / (max - min)) * innerH;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.balance).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${PAD.top + innerH} L${x(0).toFixed(1)} ${PAD.top + innerH} Z`;
  const last = points[points.length - 1];
  return (
    <View onLayout={onLayout} accessible accessibilityLabel="Évolution du solde total">
      <Svg width={width} height={height}>
        {min < 0 && max > 0 && <Line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} stroke={colors.faint} strokeDasharray="4 4" strokeWidth={1} />}
        <Path d={area} fill={colors.chart} opacity={0.08} />
        <Path d={line} stroke={colors.chart} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        <Circle cx={x(points.length - 1)} cy={y(last.balance)} r={4} fill={colors.chart} />
        <SvgText x={PAD.left} y={11} fontSize={10} fill={colors.muted}>max {formatCompact(Math.max(...values))}</SvgText>
        <SvgText x={width - PAD.right} y={11} fontSize={10} fill={colors.muted} textAnchor="end">min {formatCompact(Math.min(...values))}</SvgText>
        <SvgText x={PAD.left} y={height - 6} fontSize={10} fill={colors.muted}>{formatDayMonthShort(points[0].date)}</SvgText>
        <SvgText x={width - PAD.right} y={height - 6} fontSize={10} fill={colors.muted} textAnchor="end">{formatDayMonthShort(last.date)}</SvgText>
      </Svg>
      <Text style={styles.chartNote}>Solde au {formatDayMonthShort(last.date)} : {formatMoney(last.balance, currency)}</Text>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendName}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendName: { flex: 1, fontSize: 13, color: colors.text },
  legendPct: { fontSize: 12, color: colors.muted, width: 44, textAlign: 'right' },
  legendAmount: { fontSize: 13, fontWeight: '600', color: colors.text, minWidth: 92, textAlign: 'right' },
  chartNote: { textAlign: 'center', color: colors.muted, fontSize: 12, marginTop: 4 },
});
