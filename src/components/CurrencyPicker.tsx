import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Chip, ChipRow } from './ui';
import { colors, radius } from '../theme';
import { COMMON_CURRENCIES, CURRENCIES, getCurrency } from '../constants/currencies';

/** Choix d'une devise ISO 4217 : raccourcis XOF / EUR / USD + liste complète avec recherche. */
export function CurrencyPicker({
  label, value, onChange, disabled, only,
}: { label?: string; value: string; onChange: (code: string) => void; disabled?: boolean; only?: string[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const quick = useMemo(() => {
    const base = only ?? COMMON_CURRENCIES;
    return base.includes(value) ? base : [...base, value];
  }, [value, only]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CURRENCIES.filter((c) => (only ? only.includes(c.code) : true) && (!q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)));
  }, [query, only]);

  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <ChipRow>
        {quick.map((code) => (
          <Chip key={code} label={code} selected={value === code} onPress={() => !disabled && onChange(code)} />
        ))}
        {!disabled && !only ? <Chip label="Autre devise…" onPress={() => setOpen(true)} /> : null}
      </ChipRow>
      <Text style={styles.hint}>{getCurrency(value).name}</Text>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Choisir une devise</Text>
            <TextInput value={query} onChangeText={setQuery} placeholder="Rechercher (code ou nom)" placeholderTextColor={colors.faint} style={styles.search} autoCapitalize="none" />
            <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
              {list.map((c) => (
                <Pressable key={c.code} onPress={() => { onChange(c.code); setOpen(false); setQuery(''); }} accessibilityRole="button" accessibilityLabel={`${c.code} ${c.name}`} style={[styles.row, c.code === value && { backgroundColor: colors.neutralBg }]}>
                  <Text style={styles.code}>{c.code}</Text>
                  <Text style={styles.name}>{c.name}</Text>
                </Pressable>
              ))}
              {list.length === 0 ? <Text style={styles.hint}>Aucune devise trouvée.</Text> : null}
            </ScrollView>
            <Button label="Fermer" variant="ghost" onPress={() => { setOpen(false); setQuery(''); }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: colors.muted },
  hint: { fontSize: 12, color: colors.muted },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 20, gap: 12 },
  title: { fontSize: 17, fontWeight: '700', color: colors.text },
  search: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.card, paddingHorizontal: 12, fontSize: 16, color: colors.text },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 12, paddingHorizontal: 8, borderRadius: radius.sm },
  code: { width: 48, fontWeight: '700', color: colors.text },
  name: { flex: 1, color: colors.muted },
});
