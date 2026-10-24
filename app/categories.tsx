import React, { useState } from 'react';
import { Modal, StyleSheet, Switch, Text, View, Pressable } from 'react-native';
import { Banner, Button, Card, Field, RowDivider, Screen, SectionTitle } from '../src/components/ui';
import { useApp } from '../src/context/AppContext';
import { useQuery } from '../src/hooks/useQuery';
import { colors, radius } from '../src/theme';
import { createCategory, listCategories, updateCategory } from '../src/services/category.service';
import type { Category, CategoryKind } from '../src/types';
import { errorMessage } from '../src/utils/errors';

interface Editing { id?: number; kind: CategoryKind; name: string }

export default function Categories() {
  const { db, refresh } = useApp();
  const { data } = useQuery((d) => listCategories(d));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!editing) return;
    try {
      if (editing.id === undefined) await createCategory(db, { name: editing.name, kind: editing.kind });
      else await updateCategory(db, editing.id, { name: editing.name });
      await refresh();
      setEditing(null);
      setError(null);
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

  const section = (kind: CategoryKind, title: string) => {
    const list = (data ?? []).filter((c) => c.kind === kind);
    return (
      <>
        <SectionTitle title={title} action="Ajouter" onAction={() => { setError(null); setEditing({ kind, name: '' }); }} />
        <Card style={{ paddingVertical: 4 }}>
          {list.map((c, i) => (
            <View key={c.id}>
              {i > 0 && <RowDivider />}
              <View style={styles.row}>
                <Pressable style={{ flex: 1 }} onPress={() => { setError(null); setEditing({ id: c.id, kind: c.kind, name: c.name }); }} accessibilityRole="button" accessibilityLabel={`Renommer ${c.name}`}>
                  <Text style={[styles.name, !c.active && { color: colors.faint }]}>{c.name}</Text>
                  {!c.active ? <Text style={styles.sub}>Désactivée · conservée dans l'historique</Text> : null}
                </Pressable>
                <Switch value={c.active} onValueChange={(v) => toggle(c, v)} trackColor={{ true: colors.income, false: colors.border }} accessibilityLabel={`Activer ${c.name}`} />
              </View>
            </View>
          ))}
        </Card>
      </>
    );
  };

  return (
    <Screen>
      <Banner tone="info" text="Désactiver une catégorie la retire des nouvelles saisies sans toucher aux anciennes opérations. Touchez un nom pour le modifier." />
      {error && !editing ? <Banner tone="error" text={error} /> : null}
      {section('income', 'Catégories de revenus')}
      {section('expense', 'Catégories de dépenses')}

      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{editing?.id === undefined ? 'Nouvelle catégorie' : 'Renommer la catégorie'} · {editing?.kind === 'income' ? 'revenu' : 'dépense'}</Text>
            {error ? <Banner tone="error" text={error} /> : null}
            <Field label="Nom" value={editing?.name ?? ''} onChangeText={(t) => setEditing((e) => e && { ...e, name: t })} maxLength={40} autoFocus />
            <Button label="Enregistrer" icon="checkmark" onPress={save} />
            <Button label="Annuler" variant="ghost" onPress={() => { setEditing(null); setError(null); }} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 56 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 20, gap: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
});
