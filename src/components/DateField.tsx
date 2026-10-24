import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Chip, ChipRow, Field } from './ui';
import { colors } from '../theme';
import { addDays, formatDateLongFR, parseInputDate, todayISO, toInputDate } from '../utils/dates';

/** Saisie de date JJ/MM/AAAA avec raccourcis. `maxDate` (inclus) empêche les dates futures. */
export function DateField({
  label, value, onChange, maxDate = todayISO(), shortcuts = true,
}: { label: string; value: string; onChange: (iso: string) => void; maxDate?: string; shortcuts?: boolean }) {
  const [text, setText] = useState(toInputDate(value));
  useEffect(() => setText(toInputDate(value)), [value]);

  const parsed = parseInputDate(text);
  let error: string | null = null;
  if (text.length > 0 && !parsed) error = 'Date invalide (JJ/MM/AAAA).';
  else if (parsed && parsed > maxDate) error = 'La date ne peut pas être dans le futur.';

  const handle = (t: string) => {
    setText(t);
    const iso = parseInputDate(t);
    if (iso && iso <= maxDate) onChange(iso);
  };

  return (
    <View style={{ gap: 8 }}>
      <Field label={label} value={text} onChangeText={handle} placeholder="JJ/MM/AAAA" keyboardType="numbers-and-punctuation" maxLength={10} error={error} />
      {!error && parsed ? <Text style={styles.long}>{formatDateLongFR(parsed)}</Text> : null}
      {shortcuts ? (
        <ChipRow>
          <Chip label="Aujourd'hui" selected={value === maxDate} onPress={() => onChange(maxDate)} />
          <Chip label="Hier" selected={value === addDays(maxDate, -1)} onPress={() => onChange(addDays(maxDate, -1))} />
          <Chip label="‹ Jour précédent" onPress={() => onChange(addDays(value, -1))} />
          {value < maxDate ? <Chip label="Jour suivant ›" onPress={() => onChange(addDays(value, 1))} /> : null}
        </ChipRow>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ long: { color: colors.muted, fontSize: 13, marginTop: -2 } });
