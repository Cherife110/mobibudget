import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Button, Card, EmptyState, Money, RowDivider, Screen, SectionTitle } from '../../src/components/ui';
import { useQuery } from '../../src/hooks/useQuery';
import { colors } from '../../src/theme';
import { getAccountsWithBalances } from '../../src/services/balance.service';
import { ACCOUNT_TYPE_LABELS, type AccountWithBalance } from '../../src/types';
import { formatDateFR } from '../../src/utils/dates';

const ICONS = { cash: 'cash-outline', mobile_money: 'phone-portrait-outline', bank: 'card-outline', other: 'wallet-outline' } as const;

function AccountList({ accounts, onOpen }: { accounts: AccountWithBalance[]; onOpen: (id: number) => void }) {
  return (
    <Card style={{ paddingVertical: 4 }}>
      {accounts.map((a, i) => (
        <View key={a.id}>
          {i > 0 && <RowDivider />}
          <Pressable onPress={() => onOpen(a.id)} accessibilityRole="button" style={styles.row}>
            <View style={styles.icon}><Ionicons name={ICONS[a.type]} size={20} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{a.name}</Text>
              <Text style={styles.sub}>{ACCOUNT_TYPE_LABELS[a.type]} · depuis le {formatDateFR(a.referenceDate)}</Text>
            </View>
            <Money amount={a.balance} size={15} />
          </Pressable>
        </View>
      ))}
    </Card>
  );
}

export default function Accounts() {
  const router = useRouter();
  const { data } = useQuery((db) => getAccountsWithBalances(db, true));
  const active = (data ?? []).filter((a) => !a.archived);
  const archived = (data ?? []).filter((a) => a.archived);
  const total = active.reduce((s, a) => s + a.balance, 0);
  return (
    <Screen>
      <Card style={{ gap: 4 }}>
        <Text style={styles.sub}>Solde global (comptes actifs)</Text>
        <Money amount={total} size={26} />
      </Card>
      {data && active.length === 0 ? <Card><EmptyState icon="wallet-outline" title="Aucun compte actif" text="Créez un compte pour enregistrer vos opérations." /></Card> : null}
      {active.length > 0 ? <AccountList accounts={active} onOpen={(id) => router.push(`/accounts/${id}`)} /> : null}
      <Button label="Nouveau compte" icon="add" onPress={() => router.push('/accounts/new')} />
      {archived.length > 0 ? (
        <>
          <SectionTitle title="Comptes archivés" />
          <Text style={styles.sub}>Ils restent consultables mais ne reçoivent plus d'opérations et ne comptent pas dans le solde global.</Text>
          <AccountList accounts={archived} onOpen={(id) => router.push(`/accounts/${id}`)} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, minHeight: 64 },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.neutralBg, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
