import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Money } from './ui';
import { colors, radius, spacing } from '../theme';
import type { TransactionDetail } from '../types';

export function TransactionRow({ t, onPress }: { t: TransactionDetail; onPress?: () => void }) {
  const isTransfer = t.type === 'transfer';
  const icon = t.type === 'income' ? 'arrow-down' : t.type === 'expense' ? 'arrow-up' : 'swap-horizontal';
  const tint = t.type === 'income' ? colors.income : t.type === 'expense' ? colors.expense : colors.transfer;
  const bg = t.type === 'income' ? colors.incomeBg : t.type === 'expense' ? colors.expenseBg : colors.neutralBg;
  const title = isTransfer ? `${t.accountName} → ${t.toAccountName}` : (t.categoryName ?? 'Sans catégorie');
  const subtitle = [isTransfer ? 'Transfert' : t.accountName, t.description].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <View style={[styles.icon, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.sub} numberOfLines={1}>{subtitle}</Text>
      </View>
      <Money amount={t.amount} kind={t.type} size={15} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, minHeight: 60 },
  icon: { width: 38, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
