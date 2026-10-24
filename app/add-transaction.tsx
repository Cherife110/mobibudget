import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../src/components/ui';
import { TransactionForm } from '../src/components/TransactionForm';
import type { TransactionType } from '../src/types';

export default function AddTransaction() {
  const params = useLocalSearchParams<{ type?: string; accountId?: string }>();
  const type: TransactionType = params.type === 'income' || params.type === 'transfer' ? params.type : 'expense';
  const accountId = params.accountId ? Number(params.accountId) : undefined;
  return (
    <Screen>
      <TransactionForm defaultType={type} defaultAccountId={accountId} />
    </Screen>
  );
}
