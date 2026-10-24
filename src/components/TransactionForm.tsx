import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Button, Chip, ChipRow, Field, Segmented } from './ui';
import { DateField } from './DateField';
import { useApp } from '../context/AppContext';
import { useQuery } from '../hooks/useQuery';
import { colors } from '../theme';
import type { CategoryKind, TransactionDetail, TransactionType } from '../types';
import { listAccounts } from '../repositories/accounts.repository';
import { listCategories } from '../repositories/categories.repository';
import { createTransaction, deleteTransaction, updateTransaction } from '../services/transaction.service';
import { errorMessage } from '../utils/errors';
import { formatNumber, parseAmount } from '../utils/money';
import { todayISO } from '../utils/dates';
import { confirmAsync } from '../utils/ui';

export function TransactionForm({ initial, defaultType = 'expense', defaultAccountId }: {
  initial?: TransactionDetail; defaultType?: TransactionType; defaultAccountId?: number;
}) {
  const { db, refresh } = useApp();
  const router = useRouter();
  const editing = !!initial;

  const { data } = useQuery(async (d) => ({
    accounts: await listAccounts(d, true),
    categories: await listCategories(d),
  }));

  const [type, setType] = useState<TransactionType>(initial?.type ?? defaultType);
  const [digits, setDigits] = useState(initial ? String(initial.amount) : '');
  const [accountId, setAccountId] = useState<number | null>(initial?.accountId ?? defaultAccountId ?? null);
  const [toAccountId, setToAccountId] = useState<number | null>(initial?.toAccountId ?? null);
  const [categoryId, setCategoryId] = useState<number | null>(initial?.categoryId ?? null);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activeAccounts = useMemo(() => (data?.accounts ?? []).filter((a) => !a.archived), [data]);

  // Compte source par défaut : le premier compte actif.
  useEffect(() => {
    if (accountId === null && activeAccounts.length > 0) setAccountId(activeAccounts[0].id);
  }, [accountId, activeAccounts]);

  const kind: CategoryKind | null = type === 'transfer' ? null : type;
  const categories = useMemo(
    () => (data?.categories ?? []).filter((c) => c.kind === kind && (c.active || c.id === initial?.categoryId)),
    [data, kind, initial],
  );

  const changeType = (next: TransactionType) => {
    setType(next);
    setError(null);
    if (next === 'transfer') setCategoryId(null);
    else if (!(data?.categories ?? []).some((c) => c.id === categoryId && c.kind === next)) setCategoryId(null);
    if (next !== 'transfer') setToAccountId(null);
  };

  const submit = async () => {
    setError(null);
    const amount = parseAmount(digits);
    if (amount === null || amount === 0) {
      setError('Saisissez un montant entier supérieur à 0, en FCFA.');
      return;
    }
    setSaving(true);
    try {
      const input = { type, amount, accountId: accountId as number, toAccountId, categoryId, description, date };
      if (editing) await updateTransaction(db, initial!.id, input);
      else await createTransaction(db, input);
      await refresh();
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirmAsync('Supprimer cette opération ?', 'Les soldes, budgets et statistiques seront recalculés. Cette action est définitive.', 'Supprimer');
    if (!ok) return;
    try {
      await deleteTransaction(db, initial!.id);
      await refresh();
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const noAccount = data && activeAccounts.length === 0;
  const accent = type === 'income' ? colors.income : type === 'expense' ? colors.expense : colors.primary;

  return (
    <View style={{ gap: 14 }}>
      <Segmented<TransactionType>
        value={type}
        onChange={changeType}
        options={[
          { value: 'income', label: 'Entrée', color: colors.income },
          { value: 'expense', label: 'Dépense', color: colors.expense },
          { value: 'transfer', label: 'Transfert', color: colors.primary },
        ]}
      />

      {noAccount ? <Banner tone="warning" text="Aucun compte actif. Créez ou réactivez un compte avant d'enregistrer une opération." /> : null}
      {error ? <Banner tone="error" text={error} /> : null}

      <Field
        label="Montant"
        value={digits ? formatNumber(Number(digits)) : ''}
        onChangeText={(t) => setDigits(t.replace(/\D/g, '').slice(0, 13))}
        keyboardType="number-pad"
        placeholder="0"
        suffix="FCFA"
        autoFocus={!editing}
        style={{ fontSize: 24, fontWeight: '700', color: accent }}
      />

      <View style={{ gap: 6 }}>
        <Text style={styles.label}>{type === 'transfer' ? 'Compte source' : 'Compte'}</Text>
        <ChipRow>
          {activeAccounts.map((a) => (
            <Chip key={a.id} label={a.name} selected={accountId === a.id} onPress={() => setAccountId(a.id)} />
          ))}
        </ChipRow>
      </View>

      {type === 'transfer' ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Compte destinataire</Text>
          <ChipRow>
            {activeAccounts.filter((a) => a.id !== accountId).map((a) => (
              <Chip key={a.id} label={a.name} selected={toAccountId === a.id} onPress={() => setToAccountId(a.id)} />
            ))}
          </ChipRow>
          {activeAccounts.length < 2 ? <Text style={styles.hint}>Il faut au moins deux comptes actifs pour faire un transfert.</Text> : null}
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Catégorie</Text>
          <ChipRow>
            {categories.map((c) => (
              <Chip key={c.id} label={c.active ? c.name : `${c.name} (désactivée)`} tone={type === 'income' ? 'income' : 'expense'} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
            ))}
          </ChipRow>
          {data && categories.length === 0 ? <Text style={styles.hint}>Aucune catégorie active. Créez-en une dans Paramètres › Catégories.</Text> : null}
          {type === 'income' ? <Text style={styles.hint}>Un remboursement reçu s'enregistre ici (catégorie « Remboursement reçu ») : ne l'enregistrez pas en plus comme une dépense négative.</Text> : null}
        </View>
      )}

      <DateField label="Date de l'opération" value={date} onChange={setDate} />

      <Field label="Description (facultative)" value={description} onChangeText={setDescription} placeholder="Ex. : courses au marché" maxLength={200} />

      <Button label={editing ? 'Enregistrer les modifications' : 'Enregistrer'} onPress={submit} loading={saving} disabled={!!noAccount} variant={type === 'income' ? 'income' : type === 'expense' ? 'expense' : 'primary'} icon="checkmark" />
      {editing ? <Button label="Supprimer l'opération" onPress={remove} variant="danger" icon="trash-outline" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: colors.muted },
  hint: { fontSize: 12, color: colors.muted },
});
