import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Banner, Button, Card, Chip, ChipRow, EmptyState, Field, Money, RowDivider, Screen, SectionTitle } from '../../src/components/ui';
import { DateField } from '../../src/components/DateField';
import { TransactionRow } from '../../src/components/TransactionRow';
import { useApp } from '../../src/context/AppContext';
import { useQuery } from '../../src/hooks/useQuery';
import { colors } from '../../src/theme';
import { archiveAccount, createAccount, unarchiveAccount, updateAccount, ACCOUNT_TYPES } from '../../src/services/account.service';
import { getAccountsWithBalances } from '../../src/services/balance.service';
import { listTransactions } from '../../src/services/transaction.service';
import { ACCOUNT_TYPE_LABELS, type AccountType } from '../../src/types';
import { todayISO } from '../../src/utils/dates';
import { errorMessage } from '../../src/utils/errors';
import { formatNumber, parseSignedAmount } from '../../src/utils/money';
import { confirmAsync } from '../../src/utils/ui';

export default function AccountScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const numeric = Number(id);
  const router = useRouter();
  const { db, refresh } = useApp();

  const { data, loading } = useQuery(async (d) => {
    if (isNew) return null;
    const account = (await getAccountsWithBalances(d, true)).find((a) => a.id === numeric) ?? null;
    const recent = account ? await listTransactions(d, { accountId: numeric, limit: 8 }) : [];
    return { account, recent };
  }, [id]);

  const account = data?.account ?? null;
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('cash');
  const [balanceText, setBalanceText] = useState('');
  const [refDate, setRefDate] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(isNew);

  useEffect(() => {
    if (account && !loaded) {
      setName(account.name);
      setType(account.type);
      setBalanceText(String(account.initialBalance));
      setRefDate(account.referenceDate);
      setLoaded(true);
    }
  }, [account, loaded]);

  if (!isNew && loading) return <Screen><Text>Chargement…</Text></Screen>;
  if (!isNew && !account) return <Screen><EmptyState icon="alert-circle-outline" title="Compte introuvable" /></Screen>;

  const save = async () => {
    setError(null);
    const initialBalance = parseSignedAmount(balanceText === '' ? '0' : balanceText);
    if (initialBalance === null) return setError('Le solde initial doit être un nombre entier de FCFA (négatif autorisé).');
    try {
      const input = { name, type, initialBalance, referenceDate: refDate };
      if (isNew) await createAccount(db, input);
      else await updateAccount(db, numeric, input);
      await refresh();
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const toggleArchive = async () => {
    if (!account) return;
    if (account.archived) {
      await unarchiveAccount(db, numeric);
    } else {
      const ok = await confirmAsync(
        'Archiver ce compte ?',
        `« ${account.name} » ne pourra plus recevoir d'opérations et son solde (${formatNumber(account.balance)} FCFA) ne comptera plus dans le solde global. L'historique est conservé et vous pourrez le désarchiver.`,
        'Archiver',
      );
      if (!ok) return;
      await archiveAccount(db, numeric);
    }
    await refresh();
    router.back();
  };

  return (
    <Screen>
      {account ? (
        <Card style={{ gap: 4 }}>
          <Text style={styles.small}>Solde courant{account.archived ? ' (compte archivé)' : ''}</Text>
          <Money amount={account.balance} size={28} />
          <Text style={styles.small}>Calculé : solde initial + entrées − dépenses + transferts reçus − transferts envoyés.</Text>
        </Card>
      ) : null}

      {account?.archived ? <Banner tone="info" text="Compte archivé : il ne peut plus recevoir d'opérations. Désarchivez-le pour le modifier." /> : null}
      {error ? <Banner tone="error" text={error} /> : null}

      <Field label="Nom du compte" value={name} onChangeText={setName} placeholder="Ex. : Mobile Money" maxLength={40} editable={!account?.archived} />
      <View style={{ gap: 6 }}>
        <Text style={styles.small}>Type de compte</Text>
        <ChipRow>
          {ACCOUNT_TYPES.map((t) => (
            <Chip key={t} label={ACCOUNT_TYPE_LABELS[t]} selected={type === t} onPress={() => !account?.archived && setType(t)} />
          ))}
        </ChipRow>
      </View>
      <Field
        label="Solde initial"
        value={balanceText}
        onChangeText={(t) => setBalanceText(t.replace(/[^\d\s-]/g, ''))}
        keyboardType="numbers-and-punctuation"
        placeholder="0"
        suffix="FCFA"
        hint="Le solde du compte à la date de référence. Négatif autorisé (compte à découvert)."
        editable={!account?.archived}
      />
      <DateField label="Date de référence du solde" value={refDate} onChange={setRefDate} shortcuts={!account?.archived} />

      {!account?.archived ? <Button label={isNew ? 'Créer le compte' : 'Enregistrer'} icon="checkmark" onPress={save} /> : null}
      {account ? <Button label={account.archived ? 'Désarchiver le compte' : 'Archiver le compte'} variant={account.archived ? 'secondary' : 'danger'} icon={account.archived ? 'arrow-undo-outline' : 'archive-outline'} onPress={toggleArchive} /> : null}

      {account ? (
        <>
          <SectionTitle title="Dernières opérations du compte" />
          <Card style={{ paddingVertical: 4 }}>
            {(data?.recent ?? []).length === 0 ? (
              <EmptyState icon="receipt-outline" title="Aucune opération" />
            ) : (
              data!.recent.map((t, i) => (
                <View key={t.id}>
                  {i > 0 && <RowDivider />}
                  <TransactionRow t={t} onPress={() => router.push(`/transactions/${t.id}`)} />
                </View>
              ))
            )}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ small: { fontSize: 13, color: colors.muted } });
