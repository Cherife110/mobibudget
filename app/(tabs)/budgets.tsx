import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Banner, Button, Card, Chip, ChipRow, EmptyState, Field, Money, ProgressBar, Screen } from '../../src/components/ui';
import { useApp } from '../../src/context/AppContext';
import { useQuery } from '../../src/hooks/useQuery';
import { colors, radius } from '../../src/theme';
import { listCategories } from '../../src/repositories/categories.repository';
import { copyBudgets, deleteBudget, getBudgetStatuses, setBudget } from '../../src/services/budget.service';
import type { BudgetStatus, Category } from '../../src/types';
import { addMonths, formatMonthFR, monthOf, todayISO } from '../../src/utils/dates';
import { errorMessage } from '../../src/utils/errors';
import { formatFCFA, formatNumber, parseAmount } from '../../src/utils/money';
import { confirmAsync, notify, showError } from '../../src/utils/ui';

interface Editing { budget?: BudgetStatus; categoryId: number | null; digits: string }

export default function Budgets() {
  const { db, refresh } = useApp();
  const currentMonth = monthOf(todayISO());
  const [month, setMonth] = useState(currentMonth);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { data } = useQuery(async (d) => ({
    budgets: await getBudgetStatuses(d, month),
    categories: await listCategories(d, { kind: 'expense' }),
    previous: await getBudgetStatuses(d, addMonths(month, -1)),
  }), [month]);

  const used = new Set((data?.budgets ?? []).map((b) => b.categoryId));
  const available: Category[] = (data?.categories ?? []).filter((c) => c.active && (!used.has(c.id) || c.id === editing?.budget?.categoryId));

  const open = (b?: BudgetStatus) => {
    setFormError(null);
    setEditing({ budget: b, categoryId: b?.categoryId ?? null, digits: b ? String(b.amount) : '' });
  };

  const save = async () => {
    if (!editing) return;
    const amount = parseAmount(editing.digits);
    if (editing.categoryId === null) return setFormError('Choisissez une catégorie.');
    if (amount === null || amount === 0) return setFormError('Saisissez un plafond entier supérieur à 0, en FCFA.');
    try {
      await setBudget(db, { categoryId: editing.categoryId, month, amount });
      await refresh();
      setEditing(null);
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };

  const remove = async () => {
    if (!editing?.budget) return;
    const ok = await confirmAsync('Supprimer ce budget ?', `Le plafond « ${editing.budget.categoryName} » de ${formatMonthFR(month)} sera supprimé. Vos dépenses ne sont pas affectées.`, 'Supprimer');
    if (!ok) return;
    try {
      await deleteBudget(db, editing.budget.id);
      await refresh();
      setEditing(null);
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };

  const copyPrevious = async () => {
    try {
      const n = await copyBudgets(db, addMonths(month, -1), month);
      await refresh();
      if (n === 0) notify('Rien à copier', 'Les catégories du mois précédent ont déjà un budget ou sont désactivées.');
    } catch (e) {
      showError(e);
    }
  };

  return (
    <Screen>
      <View style={styles.nav}>
        <Pressable onPress={() => setMonth(addMonths(month, -1))} hitSlop={12} accessibilityRole="button" accessibilityLabel="Mois précédent" style={styles.arrow}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.navLabel}>{formatMonthFR(month)}</Text>
        <Pressable onPress={() => month < currentMonth && setMonth(addMonths(month, 1))} hitSlop={12} accessibilityRole="button" accessibilityLabel="Mois suivant" style={[styles.arrow, month >= currentMonth && { opacity: 0.25 }]}>
          <Ionicons name="chevron-forward" size={22} color={colors.text} />
        </Pressable>
      </View>

      {data && data.budgets.length === 0 ? (
        <Card>
          <EmptyState icon="pie-chart-outline" title="Aucun budget ce mois-ci" text="Fixez un plafond mensuel par catégorie de dépense pour suivre vos dépenses." />
          {data.previous.length > 0 && month >= currentMonth ? <Button label="Reprendre les budgets du mois précédent" variant="secondary" onPress={copyPrevious} /> : null}
        </Card>
      ) : null}

      {(data?.budgets ?? []).map((b) => (
        <Pressable key={b.id} onPress={() => open(b)} accessibilityRole="button" accessibilityLabel={`Budget ${b.categoryName}`}>
          <Card style={{ gap: 10 }}>
            <View style={styles.between}>
              <Text style={styles.name}>{b.categoryName}</Text>
              <Text style={[styles.percent, b.level === 'exceeded' && { color: colors.expense }, b.level === 'warning' && { color: colors.warning }]}>{b.percent} %</Text>
            </View>
            <ProgressBar percent={b.percent} level={b.level} />
            <View style={styles.between}>
              <Text style={styles.small}>Dépensé : <Text style={{ color: colors.text, fontWeight: '700' }}>{formatFCFA(b.spent)}</Text></Text>
              <Text style={styles.small}>Plafond : <Text style={{ color: colors.text, fontWeight: '700' }}>{formatFCFA(b.amount)}</Text></Text>
            </View>
            <View style={styles.between}>
              <Text style={styles.small}>{b.remaining >= 0 ? 'Restant' : 'Dépassement'}</Text>
              <Money amount={Math.abs(b.remaining)} kind={b.remaining >= 0 ? 'income' : 'expense'} size={14} style={{}} />
            </View>
            {b.level === 'warning' ? <Banner tone="warning" text={`Attention : ${b.percent} % du plafond est utilisé (seuil d'alerte à 80 %).`} /> : null}
            {b.level === 'exceeded' ? <Banner tone="error" text={b.remaining === 0 ? 'Plafond atteint.' : `Plafond dépassé de ${formatFCFA(-b.remaining)}.`} /> : null}
          </Card>
        </Pressable>
      ))}

      <Button label="Ajouter un budget" icon="add" onPress={() => open()} disabled={!!data && available.length === 0} />
      {data && available.length === 0 && data.budgets.length > 0 ? <Text style={styles.small}>Toutes les catégories de dépense actives ont déjà un budget ce mois-ci.</Text> : null}

      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{editing?.budget ? 'Modifier le budget' : 'Nouveau budget'} · {formatMonthFR(month)}</Text>
            {formError ? <Banner tone="error" text={formError} /> : null}
            <Text style={styles.small}>Catégorie de dépense</Text>
            <ChipRow>
              {available.map((c) => (
                <Chip key={c.id} label={c.name} tone="expense" selected={editing?.categoryId === c.id} onPress={() => setEditing((e) => e && { ...e, categoryId: c.id })} />
              ))}
            </ChipRow>
            <Field
              label="Plafond mensuel"
              value={editing?.digits ? formatNumber(Number(editing.digits)) : ''}
              onChangeText={(t) => setEditing((e) => e && { ...e, digits: t.replace(/\D/g, '').slice(0, 13) })}
              keyboardType="number-pad"
              placeholder="0"
              suffix="FCFA"
            />
            <Button label="Enregistrer" icon="checkmark" onPress={save} />
            {editing?.budget ? <Button label="Supprimer ce budget" variant="danger" icon="trash-outline" onPress={remove} /> : null}
            <Button label="Annuler" variant="ghost" onPress={() => setEditing(null)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  navLabel: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.text, textTransform: 'capitalize' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  percent: { fontSize: 16, fontWeight: '700', color: colors.income },
  small: { fontSize: 13, color: colors.muted },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 20, gap: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: colors.text, textTransform: 'capitalize' },
});
