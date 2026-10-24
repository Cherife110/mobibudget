import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, EmptyState, Money, ProgressBar, RowDivider, Screen, SectionTitle } from '../../src/components/ui';
import { TransactionRow } from '../../src/components/TransactionRow';
import { useQuery } from '../../src/hooks/useQuery';
import { colors } from '../../src/theme';
import { getAccountsWithBalances } from '../../src/services/balance.service';
import { getTotals } from '../../src/services/statistics.service';
import { getBudgetStatuses } from '../../src/services/budget.service';
import { listTransactions } from '../../src/services/transaction.service';
import { formatDateLongFR, monthOf, todayISO } from '../../src/utils/dates';
import { formatFCFA, formatSignedFCFA } from '../../src/utils/money';

export default function Dashboard() {
  const router = useRouter();
  const { data, error } = useQuery(async (db) => {
    const today = todayISO();
    const [accounts, day, recent, budgets] = await Promise.all([
      getAccountsWithBalances(db, false),
      getTotals(db, today, today),
      listTransactions(db, { limit: 5 }),
      getBudgetStatuses(db, monthOf(today)),
    ]);
    return { today, accounts, day, recent, budgets };
  });

  if (error) return <Screen><EmptyState icon="alert-circle-outline" title="Chargement impossible" text={error} /></Screen>;
  if (!data) return <Screen><Text style={styles.muted}>Chargement…</Text></Screen>;

  const total = data.accounts.reduce((s, a) => s + a.balance, 0);
  const net = data.day.net;

  return (
    <Screen>
      <Card style={{ gap: 4 }}>
        <Text style={styles.cardLabel}>Solde total</Text>
        <Money amount={total} size={34} />
        <Text style={styles.muted}>
          {data.accounts.length === 0 ? 'Aucun compte actif' : `${data.accounts.length} compte${data.accounts.length > 1 ? 's' : ''} actif${data.accounts.length > 1 ? 's' : ''}`}
        </Text>
      </Card>

      <Text style={styles.date}>Aujourd'hui · {formatDateLongFR(data.today)}</Text>
      <View style={styles.row}>
        <Card style={styles.half}>
          <Text style={styles.cardLabel}>Entrées du jour</Text>
          <Money amount={data.day.income} kind="income" size={17} />
        </Card>
        <Card style={styles.half}>
          <Text style={styles.cardLabel}>Dépenses du jour</Text>
          <Money amount={data.day.expense} kind="expense" size={17} />
        </Card>
      </View>
      <Card style={styles.netRow}>
        <Text style={styles.cardLabel}>Variation nette du jour</Text>
        <Text style={{ fontWeight: '700', fontSize: 16, color: net > 0 ? colors.income : net < 0 ? colors.expense : colors.text }}>{formatSignedFCFA(net)}</Text>
      </Card>

      <View style={styles.row}>
        <Button label="Entrée" icon="add-circle-outline" variant="income" style={styles.half} onPress={() => router.push({ pathname: '/add-transaction', params: { type: 'income' } })} />
        <Button label="Dépense" icon="remove-circle-outline" variant="expense" style={styles.half} onPress={() => router.push({ pathname: '/add-transaction', params: { type: 'expense' } })} />
      </View>
      <Button label="Transfert entre comptes" icon="swap-horizontal" variant="secondary" onPress={() => router.push({ pathname: '/add-transaction', params: { type: 'transfer' } })} />

      <SectionTitle title="Mes comptes" action="Gérer" onAction={() => router.push('/accounts')} />
      <Card style={{ paddingVertical: 4 }}>
        {data.accounts.length === 0 ? (
          <EmptyState icon="wallet-outline" title="Aucun compte actif" text="Créez un compte pour enregistrer vos opérations." />
        ) : (
          data.accounts.map((a, i) => (
            <View key={a.id}>
              {i > 0 && <RowDivider />}
              <View style={styles.accountRow}>
                <Text style={styles.accountName}>{a.name}</Text>
                <Money amount={a.balance} size={15} />
              </View>
            </View>
          ))
        )}
      </Card>

      <SectionTitle title="Budgets du mois" action="Voir" onAction={() => router.push('/budgets')} />
      <Card style={{ gap: 14 }}>
        {data.budgets.length === 0 ? (
          <Text style={styles.muted}>Aucun budget défini ce mois-ci.</Text>
        ) : (
          data.budgets.slice(0, 3).map((b) => (
            <View key={b.id} style={{ gap: 6 }}>
              <View style={styles.accountRow}>
                <Text style={styles.accountName}>{b.categoryName}</Text>
                <Text style={[styles.muted, b.level !== 'ok' && { color: b.level === 'exceeded' ? colors.expense : colors.warning, fontWeight: '700' }]}>
                  {b.percent} % · {formatFCFA(b.spent)} / {formatFCFA(b.amount)}
                </Text>
              </View>
              <ProgressBar percent={b.percent} level={b.level} />
            </View>
          ))
        )}
      </Card>

      <SectionTitle title="Dernières transactions" action="Tout voir" onAction={() => router.push('/transactions')} />
      <Card style={{ paddingVertical: 4 }}>
        {data.recent.length === 0 ? (
          <EmptyState icon="receipt-outline" title="Aucune opération" text="Enregistrez votre première entrée ou dépense avec les boutons ci-dessus." />
        ) : (
          data.recent.map((t, i) => (
            <View key={t.id}>
              {i > 0 && <RowDivider />}
              <TransactionRow t={t} onPress={() => router.push(`/transactions/${t.id}`)} />
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  cardLabel: { fontSize: 13, color: colors.muted, fontWeight: '600', marginBottom: 2 },
  muted: { fontSize: 13, color: colors.muted },
  date: { fontSize: 13, color: colors.muted, marginTop: 4, textTransform: 'capitalize' },
  netRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  accountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  accountName: { fontSize: 15, fontWeight: '600', color: colors.text },
});
