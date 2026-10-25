import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Banner, Button, Card, Chip, ChipRow, Field, RowDivider, Screen, SectionTitle } from '../src/components/ui';
import { useApp } from '../src/context/AppContext';
import { useQuery } from '../src/hooks/useQuery';
import { colors, radius } from '../src/theme';
import {
  createCategory, deleteCategory, listCategories, listCategoryUsage, reassignCategory, updateCategory,
} from '../src/services/category.service';
import type { Category, CategoryKind } from '../src/types';
import { errorMessage } from '../src/utils/errors';
import { confirmAsync, notify } from '../src/utils/ui';

interface Editing { id?: number; kind: CategoryKind; name: string }

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export default function Categories() {
  const { db, refresh } = useApp();
  const { data } = useQuery(async (d) => ({ categories: await listCategories(d), usage: await listCategoryUsage(d) }));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState(false);
  const [target, setTarget] = useState<number | null>(null);
  const [archiveAfter, setArchiveAfter] = useState(true);

  const categories = data?.categories ?? [];
  const current: Category | undefined = editing?.id !== undefined ? categories.find((c) => c.id === editing.id) : undefined;
  const usage = (id: number) => data?.usage.get(id) ?? { transactions: 0, budgets: 0 };
  const currentUsage = current ? usage(current.id) : { transactions: 0, budgets: 0 };

  const close = () => { setEditing(null); setError(null); setReassigning(false); setTarget(null); setArchiveAfter(true); };
  const open = (e: Editing) => { setError(null); setReassigning(false); setTarget(null); setArchiveAfter(true); setEditing(e); };

  const save = async () => {
    if (!editing) return;
    try {
      if (editing.id === undefined) await createCategory(db, { name: editing.name, kind: editing.kind });
      else await updateCategory(db, editing.id, { name: editing.name });
      await refresh();
      close();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const toggle = async (c: Category, active: boolean) => {
    try {
      await updateCategory(db, c.id, { active });
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const remove = async () => {
    if (!current) return;
    const hasBudgets = currentUsage.budgets > 0;
    const ok = await confirmAsync(
      'Supprimer cette catégorie ?',
      hasBudgets
        ? `« ${current.name} » n'est utilisée par aucune opération, mais ${plural(currentUsage.budgets, 'budget mensuel sera supprimé', 'budgets mensuels seront supprimés')} avec elle. Cette action est définitive.`
        : `« ${current.name} » n'est utilisée par aucune opération. Cette action est définitive.`,
      'Supprimer',
    );
    if (!ok) return;
    try {
      await deleteCategory(db, current.id, { deleteBudgets: hasBudgets });
      await refresh();
      close();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const reassign = async () => {
    if (!current || target === null) return;
    const dest = categories.find((c) => c.id === target);
    const ok = await confirmAsync(
      'Réaffecter les opérations ?',
      `${plural(currentUsage.transactions, 'opération sera déplacée', 'opérations seront déplacées')} de « ${current.name} » vers « ${dest?.name} ». Les montants, dates et soldes ne changent pas.` +
        (currentUsage.budgets > 0 ? `\n\nLes budgets de « ${current.name} » sont reportés sur « ${dest?.name} » (si celle-ci a déjà un budget pour le même mois, le sien est conservé).` : '') +
        (archiveAfter ? `\n\n« ${current.name} » sera ensuite archivée.` : ''),
      'Réaffecter',
      false,
    );
    if (!ok) return;
    try {
      const r = await reassignCategory(db, current.id, target, { archiveSource: archiveAfter });
      await refresh();
      close();
      notify('Réaffectation terminée', `${plural(r.transactions, 'opération déplacée', 'opérations déplacées')}.`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const section = (kind: CategoryKind, title: string) => {
    const list = categories.filter((c) => c.kind === kind);
    return (
      <>
        <SectionTitle title={title} action="Ajouter" onAction={() => open({ kind, name: '' })} />
        <Card style={{ paddingVertical: 4 }}>
          {list.map((c, i) => {
            const u = usage(c.id);
            const used = u.transactions === 0 && u.budgets === 0 ? 'Inutilisée' : [u.transactions > 0 ? plural(u.transactions, 'opération', 'opérations') : null, u.budgets > 0 ? plural(u.budgets, 'budget', 'budgets') : null].filter(Boolean).join(' · ');
            return (
              <View key={c.id}>
                {i > 0 && <RowDivider />}
                <View style={styles.row}>
                  <Pressable style={{ flex: 1 }} onPress={() => open({ id: c.id, kind: c.kind, name: c.name })} accessibilityRole="button" accessibilityLabel={`Modifier ${c.name}`}>
                    <Text style={[styles.name, !c.active && { color: colors.faint }]}>{c.name}</Text>
                    <Text style={styles.sub}>{c.active ? used : `Archivée · ${used}`}</Text>
                  </Pressable>
                  <Switch value={c.active} onValueChange={(v) => toggle(c, v)} trackColor={{ true: colors.income, false: colors.border }} accessibilityLabel={`${c.active ? 'Archiver' : 'Réactiver'} ${c.name}`} />
                </View>
              </View>
            );
          })}
        </Card>
      </>
    );
  };

  const targets = categories.filter((c) => current && c.kind === current.kind && c.active && c.id !== current.id);

  return (
    <Screen>
      <Banner tone="info" text="Touchez une catégorie pour la renommer, la supprimer (si elle est inutilisée) ou réaffecter ses opérations. L'interrupteur l'archive ou la réactive : l'historique est toujours conservé." />
      {error && !editing ? <Banner tone="error" text={error} /> : null}
      {section('income', 'Catégories de revenus')}
      {section('expense', 'Catégories de dépenses')}

      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>
                {editing?.id === undefined ? 'Nouvelle catégorie' : 'Modifier la catégorie'} · {editing?.kind === 'income' ? 'revenu' : 'dépense'}
              </Text>
              {error ? <Banner tone="error" text={error} /> : null}
              <Field label="Nom" value={editing?.name ?? ''} onChangeText={(t) => setEditing((e) => e && { ...e, name: t })} maxLength={40} autoFocus={editing?.id === undefined} />
              <Button label="Enregistrer" icon="checkmark" onPress={save} />

              {current ? (
                <>
                  <RowDivider />
                  <Text style={styles.sub}>
                    {currentUsage.transactions === 0 && currentUsage.budgets === 0
                      ? 'Cette catégorie n\'est utilisée nulle part.'
                      : `Utilisée par ${plural(currentUsage.transactions, 'opération', 'opérations')} et ${plural(currentUsage.budgets, 'budget', 'budgets')}.`}
                  </Text>

                  {currentUsage.transactions === 0 ? (
                    <Button label="Supprimer la catégorie" variant="danger" icon="trash-outline" onPress={remove} />
                  ) : (
                    <>
                      <Banner tone="info" text="Une catégorie utilisée ne peut pas être supprimée, pour préserver l'historique. Archivez-la avec l'interrupteur, ou réaffectez ses opérations vers une autre catégorie." />
                      {!reassigning ? (
                        <Button label="Réaffecter les opérations…" variant="secondary" icon="swap-horizontal" onPress={() => setReassigning(true)} />
                      ) : (
                        <View style={{ gap: 10 }}>
                          <Text style={styles.label}>Nouvelle catégorie des {plural(currentUsage.transactions, 'opération', 'opérations')}</Text>
                          {targets.length === 0 ? (
                            <Text style={styles.sub}>Aucune autre catégorie active du même type. Créez-en une d'abord.</Text>
                          ) : (
                            <ChipRow>
                              {targets.map((c) => <Chip key={c.id} label={c.name} tone={c.kind} selected={target === c.id} onPress={() => setTarget(c.id)} />)}
                            </ChipRow>
                          )}
                          <ChipRow>
                            <Chip label={archiveAfter ? '✓ Archiver ensuite l\'ancienne catégorie' : 'Archiver ensuite l\'ancienne catégorie'} selected={archiveAfter} onPress={() => setArchiveAfter((v) => !v)} />
                          </ChipRow>
                          <Button label="Réaffecter" icon="checkmark" onPress={reassign} disabled={target === null} />
                        </View>
                      )}
                    </>
                  )}
                </>
              ) : null}
              <Button label="Fermer" variant="ghost" onPress={close} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 56 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 17 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 20, maxHeight: '92%' },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
});
