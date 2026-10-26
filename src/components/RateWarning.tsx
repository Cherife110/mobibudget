import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '../theme';

/** Avertissement « taux de change manquant », cliquable vers l'écran des taux. */
export function RateWarning({ text }: { text: string }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push('/exchange-rates')} accessibilityRole="button" accessibilityLabel="Ajouter un taux de change" style={styles.box}>
      <Ionicons name="warning-outline" size={18} color={colors.warning} />
      <Text style={styles.text}>
        {text} <Text style={styles.link}>Ajouter un taux ›</Text>
      </Text>
    </Pressable>
  );
}

/** Phrase standard pour des opérations exclues faute de taux. */
export function exclusionText(count: number, currencies: string[]): string {
  return `${count} opération${count > 1 ? 's' : ''} en ${currencies.join(', ')} ${count > 1 ? 'sont exclues' : 'est exclue'} des totaux : aucun taux de change applicable.`;
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningBg, alignItems: 'flex-start' },
  text: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.warning },
  link: { fontWeight: '700', textDecorationLine: 'underline' },
});
