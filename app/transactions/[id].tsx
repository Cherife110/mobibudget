import React from 'react';
import { Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { EmptyState, Screen } from '../../src/components/ui';
import { TransactionForm } from '../../src/components/TransactionForm';
import { useQuery } from '../../src/hooks/useQuery';
import { getTransaction } from '../../src/services/transaction.service';

export default function EditTransaction() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const numeric = Number(id);
  const { data, loading } = useQuery((db) => getTransaction(db, numeric), [numeric]);
  if (loading) return <Screen><Text>Chargement…</Text></Screen>;
  if (!data) return <Screen><EmptyState icon="alert-circle-outline" title="Opération introuvable" text="Elle a peut-être été supprimée." /></Screen>;
  return (
    <Screen>
      <TransactionForm key={data.id} initial={data} />
    </Screen>
  );
}
