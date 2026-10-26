import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Banner, Button, Card, EmptyState, Field, RowDivider, Screen } from '../src/components/ui';
import { CurrencyPicker } from '../src/components/CurrencyPicker';
import { DateField } from '../src/components/DateField';
import { useApp } from '../src/context/AppContext';
import { useQuery } from '../src/hooks/useQuery';
import { colors, radius } from '../src/theme';
import { listAccounts } from '../src/repositories/accounts.repository';
import { deleteRate, listRates, saveRate } from '../src/services/rates.service';
import type { ExchangeRate } from '../src/types';
import { formatDateFR, todayISO } from '../src/utils/dates';
import { errorMessage } from '../src/utils/errors';
import { formatRate, parseRate } from '../src/utils/fx';
import { confirmAsync } from '../src/utils/ui';

interface Editing { id?: number; from: string; to: string; rateText: string; date: string }

export default function ExchangeRates() {
  const { db, refresh, settings } = useApp();
  const ref = settings.referenceCurrency;
  const { data } = useQuery(async (d) => ({ rates: await listRates(d), accounts: await listAccounts(d, true) }));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const used = [...new Set((data?.accounts ?? []).map((a) => a.currency))].filter((c) => c !== ref);
  const covered = (c: string) => (data?.rates ?? []).some((r) => (r.fromCurrency === c && r.toCurrency === ref) || (r.fromCurrency === ref && r.toCurrency === c));
  const missing = used.filter((c) => !covered(c));

  const open = (e: Editing) => { setError(null); setEditing(e); };
  const close = () => { setEditing(null); setError(null); };

  const save = async () => {
    if (!editing) return;
    const rateScaled = parseRate(editing.rateText);
    if (rateScaled === null) return setError('Saisissez un taux positif (8 décimales au plus), par exemple 655,957.');
    try {
      await saveRate(db, { fromCurrency: editing.from, toCurrency: editing.to, rateScaled, effectiveDate: editing.date });
      await refresh();
      close();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const remove = async (r: ExchangeRate) => {
    const ok = await confirmAsync('Supprimer ce taux ?', `1 ${r.fromCurrency} = ${formatRate(r.rateScaled)} ${r.toCurrency} (depuis le ${formatDateFR(r.effectiveDate)}). Les opérations qui l'utilisaient seront exclues des totaux si aucun autre taux ne s'applique.`, 'Supprimer');
    if (!ok) return;
    try {
      await deleteRate(db, r.id);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Screen>
      <Banner tone="info" text={`Les totaux, budgets et statistiques sont exprimés en ${ref}. Chaque opération est convertie au taux en vigueur à sa date : le dernier taux saisi dont la date d'effet est antérieure ou égale à celle de l'opération. Les montants d'origine ne sont jamais modifiés.`} />
      {missing.length > 0 ? <Banner tone="warning" text={`Aucun taux pour ${missing.join(', ')} : les opérations de ces comptes sont exclues des totaux.`} /> : null}
      {error && !editing ? <Banner tone="error" text={error} /> : null}

      <Button label="Ajouter un taux" icon="add" onPress={() => open({ from: missing[0] ?? (used[0] ?? 'EUR'), to: ref, rateText: '', date: todayISO() })} />

      <Card style={{ paddingVertical: 4 }}>
        {(data?.rates ?? []).length === 0 ? (
          <EmptyState icon="swap-horizontal-outline" title="Aucun taux" text="Ajoutez un taux pour inclure vos comptes en devises étrangères dans les totaux." />
        ) : (
          data!.rates.map((r, i) => (
            <View key={r.id}>
              {i > 0 && <RowDivider />}
              <Pressable style={styles.row} accessibilityRole="button" accessibilityLabel={`Taux ${r.fromCurrency} vers ${r.toCurrency}`} onPress={() => open({ id: r.id, from: r.fromCurrency, to: r.toCurrency, rateText: formatRate(r.rateScaled), date: r.effectiveDate })}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pair}>1 {r.fromCurrency} = {formatRate(r.rateScaled)} {r.toCurrency}</Text>
                  <Text style={styles.sub}>À partir du {formatDateFR(r.effectiveDate)}</Text>
                </View>
                <Pressable onPress={() => remove(r)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Supprimer ce taux">
                  <Text style={styles.delete}>Supprimer</Text>
                </Pressable>
              </Pressable>
            </View>
          ))
        )}
      </Card>

      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>{editing?.id === undefined ? 'Nouveau taux de change' : 'Modifier le taux'}</Text>
              {error ? <Banner tone="error" text={error} /> : null}
              {editing ? (
                <>
                  <CurrencyPicker label="Devise de départ (1 unité de…)" value={editing.from} onChange={(c) => setEditing({ ...editing, from: c })} />
                  <CurrencyPicker label="Devise d'arrivée (…vaut)" value={editing.to} onChange={(c) => setEditing({ ...editing, to: c })} />
                  <Field
                    label={`Taux : 1 ${editing.from} = … ${editing.to}`}
                    value={editing.rateText}
                    onChangeText={(t) => setEditing({ ...editing, rateText: t.replace(/\./g, ',').replace(/[^\d,\s]/g, '') })}
                    keyboardType="decimal-pad"
                    placeholder="Ex. : 655,957"
                    hint="8 décimales au plus. Vous pouvez saisir le taux dans un sens ou dans l'autre : l'application sait l'utiliser dans les deux."
                  />
                  <DateField label="Date d'effet" value={editing.date} onChange={(d) => setEditing({ ...editing, date: d })} />
                </>
              ) : null}
              <Button label="Enregistrer" icon="checkmark" onPress={save} />
              <Button label="Annuler" variant="ghost" onPress={close} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, minHeight: 60 },
  pair: { fontSize: 15, fontWeight: '700', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  delete: { fontSize: 13, fontWeight: '700', color: colors.expense },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 20, maxHeight: '92%' },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
});
