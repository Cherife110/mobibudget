import React from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme';
import { formatFCFA, formatSignedFCFA } from '../utils/money';
import type { BudgetLevel } from '../types';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function Screen({ children, scroll = true, style }: { children: React.ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle> }) {
  if (!scroll) return <View style={[styles.screen, style]}>{children}</View>;
  return (
    <ScrollView style={styles.flex} contentContainerStyle={[styles.screenContent, style]} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button">
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'income' | 'expense' | 'ghost';

const buttonColors: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: '#fff', border: colors.primary },
  secondary: { bg: colors.card, fg: colors.text, border: colors.border },
  danger: { bg: colors.card, fg: colors.expense, border: '#FCA5A5' },
  income: { bg: colors.income, fg: '#fff', border: colors.income },
  expense: { bg: colors.expense, fg: '#fff', border: colors.expense },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
};

export function Button({
  label, onPress, variant = 'primary', icon, disabled, loading, style,
}: {
  label: string; onPress: () => void; variant?: ButtonVariant; icon?: IconName; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const c = buttonColors[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: c.bg, borderColor: c.border, opacity: inactive ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={c.fg} /> : icon ? <Ionicons name={icon} size={20} color={c.fg} /> : null}
      <Text style={[styles.buttonText, { color: c.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({
  label, error, hint, suffix, style, ...input
}: TextInputProps & { label: string; error?: string | null; hint?: string; suffix?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, error ? { borderColor: colors.expense } : null]}>
        <TextInput
          placeholderTextColor={colors.faint}
          {...input}
          style={[styles.input, input.multiline ? { minHeight: 64, textAlignVertical: 'top' } : null, style]}
          accessibilityLabel={label}
        />
        {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Chip({ label, selected, onPress, tone }: { label: string; selected?: boolean; onPress?: () => void; tone?: 'income' | 'expense' }) {
  const active = tone === 'income' ? colors.income : tone === 'expense' ? colors.expense : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={[styles.chip, selected ? { backgroundColor: active, borderColor: active } : null]}
    >
      <Text style={[styles.chipText, selected ? { color: '#fff' } : null]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

export function Segmented<T extends string>({
  options, value, onChange,
}: { options: { value: T; label: string; color?: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[styles.segment, selected ? { backgroundColor: o.color ?? colors.primary } : null]}
          >
            <Text style={[styles.segmentText, selected ? { color: '#fff' } : null]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Montant coloré : vert (entrée / positif), rouge (dépense / négatif), gris (transfert). */
export function Money({
  amount, kind = 'auto', size = 16, signed = false, style,
}: { amount: number; kind?: 'auto' | 'income' | 'expense' | 'transfer' | 'plain'; size?: number; signed?: boolean; style?: StyleProp<ViewStyle> }) {
  let color = colors.text;
  let text = formatFCFA(amount);
  if (kind === 'income') { color = colors.income; text = `+${formatFCFA(amount)}`; }
  else if (kind === 'expense') { color = colors.expense; text = `-${formatFCFA(amount)}`; }
  else if (kind === 'transfer') { color = colors.transfer; }
  else if (kind === 'auto') {
    color = amount > 0 ? colors.income : amount < 0 ? colors.expense : colors.text;
    text = signed ? formatSignedFCFA(amount) : formatFCFA(amount);
  }
  return <Text style={[{ color, fontSize: size, fontWeight: '700' }, style as never]}>{text}</Text>;
}

export function EmptyState({ icon = 'file-tray-outline', title, text, action }: { icon?: IconName; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={40} color={colors.faint} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={styles.emptyText}>{text}</Text> : null}
      {action}
    </View>
  );
}

export function ProgressBar({ percent, level }: { percent: number; level: BudgetLevel }) {
  const color = level === 'exceeded' ? colors.expense : level === 'warning' ? '#F59E0B' : colors.income;
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.min(percent, 100) }}>
      <View style={[styles.fill, { width: `${Math.max(2, Math.min(percent, 100))}%`, backgroundColor: color }]} />
    </View>
  );
}

export function Banner({ tone, text }: { tone: 'warning' | 'error' | 'info'; text: string }) {
  const map = {
    warning: { bg: colors.warningBg, fg: colors.warning, icon: 'warning-outline' as IconName },
    error: { bg: colors.expenseBg, fg: colors.expense, icon: 'alert-circle-outline' as IconName },
    info: { bg: colors.neutralBg, fg: colors.muted, icon: 'information-circle-outline' as IconName },
  }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: map.bg }]}>
      <Ionicons name={map.icon} size={18} color={map.fg} />
      <Text style={[styles.bannerText, { color: map.fg }]}>{text}</Text>
    </View>
  );
}

export function RowDivider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  screenContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  sectionAction: { fontSize: 14, color: colors.chart, fontWeight: '600' },
  button: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  buttonText: { fontSize: 16, fontWeight: '700' },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md },
  input: { flex: 1, minHeight: 50, fontSize: 16, color: colors.text },
  suffix: { fontSize: 15, color: colors.muted, fontWeight: '600', marginLeft: 8 },
  error: { color: colors.expense, fontSize: 13 },
  hint: { color: colors.muted, fontSize: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.text },
  segmented: { flexDirection: 'row', backgroundColor: colors.neutralBg, borderRadius: radius.md, padding: 4, gap: 4 },
  segment: { flex: 1, minHeight: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 14, fontWeight: '700', color: colors.muted },
  empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'center' },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.neutralBg, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  banner: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'flex-start' },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
});
