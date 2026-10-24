import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Button, Card, Chip, ChipRow, EmptyState, Field, Money } from '../../src/components/ui';
import { DateField } from '../../src/components/DateField';
import { TransactionRow } from '../../src/components/TransactionRow';
import { useQuery } from '../../src/hooks/useQuery';
import { colors, spacing } from '../../src/theme';
import { listAccounts } from '../../src/repositories/accounts.repository';
import { listCategories } from '../../src/repositories/categories.repository';
import { listTransactions, summarizeFilter, type TransactionFilter } from '../../src/services/transaction.service';
import type { TransactionDetail, TransactionType } from '../../src/types';
import { addDays, endOfMonth, addMonths, formatDateLongFR, monthOf, startOfMonth, todayISO } from '../../src/utils/dates';
import { formatFCFA } from '../../src/utils/money';

type Preset = 'all' | 'today' | '7d' | 'month' | 'lastMonth' | 'custom';
const PAGE = 100;

type Item = { kind: 'header'; date: string; key: string } | { kind: 'tx'; t: TransactionDetail; key: string };

export default function History() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState<Preset>('all');
  const [customFrom, setCustomFrom] = useState(startOfMonth(monthOf(todayISO())));
  const [customTo, setCustomTo] = useState(todayISO());
  const [type, setType] = useState<TransactionType | undefined>();
  const [accountId, setAccountId] = useState<number | undefined>();
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const range = useMemo(() => {
    const today = todayISO();
    switch (preset) {
      case 'today': return { from: today, to: today };
      case '7d': return { from: addDays(today, -6), to: today };
      case 'month': return { from: startOfMonth(monthOf(today)), to: endOfMonth(monthOf(today)) };
      case 'lastMonth': { const m = addMonths(monthOf(today), -1); return { from: startOfMonth(m), to: endOfMonth(m) }; }
      case 'custom': return customFrom <= customTo ? { from: customFrom, to: customTo } : { from: customTo, to: customFrom };
      default: return {};
    }
  }, [preset, customFrom, customTo]);

  const filter: TransactionFilter = { ...range, type, accountId, categoryId, search };

  const { data } = useQuery(async (db) => {
    const [items, summary, accounts, categories] = await Promise.all([
      listTransactions(db, { ...filter, limit }),
      summarizeFilter(db, filter),
      listAccounts(db, true),
      listCategories(db),
    ]);
    return { items, summary, accounts, categories };
  }, [search, preset, customFrom, customTo, type, accountId, categoryId, limit]);

  const rows = useMemo<Item[]>(() => {
    const out: Item[] = [];
    let last = '';
    for (const t of data?.items ?? []) {
      if (t.date !== last) { out.push({ kind: 'header', date: t.date, key: `h${t.date}` }); last = t.date; }
      out.push({ kind: 'tx', t, key: `t${t.id}` });
    }
    return out;
  }, [data]);

  const activeFilters = [preset !== 'all', !!type, accountId !== undefined, categoryId !== undefined].filter(Boolean).length;
  const reset = () => { setPreset('all'); setType(undefined); setAccountId(undefined); setCategoryId(undefined); setSearch(''); setLimit(PAGE); };

  const header = (
    <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Field label="Rechercher" value={search} onChangeText={(t) => { setSearch(t); setLimit(PAGE); }} placeholder="Description, catégorie, compte…" returnKeyType="search" />
        </View>
        <Pressable onPress={() => setShowFilters((v) => !v)} accessibilityRole="button" accessibilityLabel="Filtres" style={styles.filterBtn}>
          <Ionicons name="options-outline" size={22} color={colors.text} />
          {activeFilters > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{activeFilters}</Text></View> : null}
        </Pressable>
      </View>

      {showFilters ? (
        <Card style={{ gap: 14 }}>
          <Text style={styles.filterTitle}>Période</Text>
          <ChipRow>
            {([['all', 'Tout'], ['today', "Aujourd'hui"], ['7d', '7 jours'], ['month', 'Ce mois'], ['lastMonth', 'Mois dernier'], ['custom', 'Personnalisé']] as [Preset, string][]).map(([v, label]) => (
              <Chip key={v} label={label} selected={preset === v} onPress={() => { setPreset(v); setLimit(PAGE); }} />
            ))}
          </ChipRow>
          {preset === 'custom' ? (
            <View style={{ gap: 10 }}>
              <DateField label="Du" value={customFrom} onChange={setCustomFrom} shortcuts={false} />
              <DateField label="Au" value={customTo} onChange={setCustomTo} shortcuts={false} />
            </View>
          ) : null}
          <Text style={styles.filterTitle}>Type</Text>
          <ChipRow>
            <Chip label="Tous" selected={!type} onPress={() => setType(undefined)} />
            <Chip label="Entrées" tone="income" selected={type === 'income'} onPress={() => setType('income')} />
            <Chip label="Dépenses" tone="expense" selected={type === 'expense'} onPress={() => setType('expense')} />
            <Chip label="Transferts" selected={type === 'transfer'} onPress={() => setType('transfer')} />
          </ChipRow>
          <Text style={styles.filterTitle}>Compte</Text>
          <ChipRow>
            <Chip label="Tous" selected={accountId === undefined} onPress={() => setAccountId(undefined)} />
            {(data?.accounts ?? []).map((a) => (
              <Chip key={a.id} label={a.archived ? `${a.name} (archivé)` : a.name} selected={accountId === a.id} onPress={() => setAccountId(a.id)} />
            ))}
          </ChipRow>
          <Text style={styles.filterTitle}>Catégorie</Text>
          <ChipRow>
            <Chip label="Toutes" selected={categoryId === undefined} onPress={() => setCategoryId(undefined)} />
            {(data?.categories ?? []).map((c) => (
              <Chip key={c.id} label={c.name} tone={c.kind} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
            ))}
          </ChipRow>
          <Button label="Réinitialiser les filtres" variant="ghost" onPress={reset} />
        </Card>
      ) : null}

      {data ? (
        <View style={styles.summary}>
          <Text style={styles.summaryText}>{data.summary.count} opération{data.summary.count > 1 ? 's' : ''}</Text>
          <Text style={styles.summaryText}>Entrées <Text style={{ color: colors.income, fontWeight: '700' }}>{formatFCFA(data.summary.income)}</Text></Text>
          <Text style={styles.summaryText}>Dépenses <Text style={{ color: colors.expense, fontWeight: '700' }}>{formatFCFA(data.summary.expense)}</Text></Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={rows}
        keyExtractor={(i) => i.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
        ListHeaderComponent={header}
        renderItem={({ item }) =>
          item.kind === 'header' ? (
            <Text style={styles.dayHeader}>{formatDateLongFR(item.date)}</Text>
          ) : (
            <View style={styles.txWrap}>
              <TransactionRow t={item.t} onPress={() => router.push(`/transactions/${item.t.id}`)} />
            </View>
          )
        }
        ListEmptyComponent={
          data ? (
            <EmptyState
              icon="receipt-outline"
              title={activeFilters > 0 || search ? 'Aucun résultat' : 'Aucune opération'}
              text={activeFilters > 0 || search ? 'Modifiez ou réinitialisez les filtres.' : 'Vos entrées, dépenses et transferts apparaîtront ici.'}
            />
          ) : undefined
        }
        ListFooterComponent={
          data && data.items.length >= limit ? <Button label="Voir plus d'opérations" variant="secondary" onPress={() => setLimit((l) => l + PAGE)} /> : undefined
        }
      />
      <Pressable accessibilityRole="button" accessibilityLabel="Ajouter une opération" style={styles.fab} onPress={() => router.push('/add-transaction')}>
        <Ionicons name="add" size={30} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  filterBtn: { width: 50, height: 50, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  filterTitle: { fontSize: 13, fontWeight: '700', color: colors.muted },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  summaryText: { fontSize: 13, color: colors.muted },
  dayHeader: { fontSize: 13, fontWeight: '700', color: colors.muted, marginTop: 14, marginBottom: 4, textTransform: 'capitalize' },
  txWrap: { backgroundColor: colors.card, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  fab: { position: 'absolute', right: 20, bottom: 24, width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 6 },
});
