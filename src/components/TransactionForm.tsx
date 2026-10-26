import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Button, Chip, ChipRow, Field, Segmented } from './ui';
import { DateField } from './DateField';
import { useApp } from '../context/AppContext';
import { useQuery } from '../hooks/useQuery';
import { colors } from '../theme';
import { getCurrency } from '../constants/currencies';
import type { CategoryKind, TransactionDetail, TransactionType } from '../types';
import { listAccounts } from '../repositories/accounts.repository';
import { listCategories } from '../repositories/categories.repository';
import { createTransaction, deleteTransaction, updateTransaction } from '../services/transaction.service';
import { errorMessage } from '../utils/errors';
import { currencySymbol, formatPlainAmount, parseMoneyInput } from '../utils/money';
import { todayISO } from '../utils/dates';
import { confirmAsync } from '../utils/ui';

/** Garde uniquement chiffres et un séparateur décimal, limité aux décimales de la devise (« 12,5 », jamais « 12,555 € »). */
function sanitizeAmount(text: string, currency: string): string {
  const { exponent } = getCurrency(currency);
  let t = text.replace(/\./g, ',').replace(/[^\d,]/g, '');
  if (exponent === 0) return t.replace(/,/g, '').slice(0, 15);
  const first = t.indexOf(',');
  if (first >= 0) t = t.slice(0, first + 1) + t.slice(first + 1).replace(/,/g, '').slice(0, exponent);
  return t.slice(0, 16);
}

export function TransactionForm({ initial, defaultType = 'expense', defaultAccountId }: {
  initial?: TransactionDetail; defaultType?: TransactionType; defaultAccountId?: number;
}) {
  const { db, refresh, settings } = useApp();
  const router = useRouter();
  const editing = !!initial;

  const { data } = useQuery(async (d) => ({
    accounts: await listAccounts(d, true),
    categories: await listCategories(d),
  }));

  const [type, setType] = useState<TransactionType>(initial?.type ?? defaultType);
  const [amountText, setAmountText] = useState(initial ? formatPlainAmount(initial.amount, initial.currency) : '');
  const [accountId, setAccountId] = useState<number | null>(initial?.accountId ?? defaultAccountId ?? null);
  const [toAccountId, setToAccountId] = useState<number | null>(initial?.toAccountId ?? null);
  const [categoryId, setCategoryId] = useState<number | null>(initial?.categoryId ?? null);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activeAccounts = useMemo(() => (data?.accounts ?? []).filter((a) => !a.archived), [data]);
  const source = (data?.accounts ?? []).find((a) => a.id === accountId);
  const currency = source?.currency ?? initial?.currency ?? settings.referenceCurrency;
  const multiCurrency = new Set((data?.accounts ?? []).map((a) => a.currency)).size > 1;
  const accountLabel = (a: { name: string; currency: string }) => (multiCurrency ? `${a.name} · ${a.currency}` : a.name);

  // Compte source par défaut : le premier compte actif.
  useEffect(() => {
    if (accountId === null && activeAccounts.length > 0) setAccountId(activeAccounts[0].id);
  }, [accountId, activeAccounts]);

  // Changement de devise (autre compte source) : on retire les décimales en trop ; le destinataire doit avoir la même devise.
  useEffect(() => {
    setAmountText((t) => sanitizeAmount(t, currency));
    const to = activeAccounts.find((a) => a.id === toAccountId);
    if (to && to.currency !== currency) setToAccountId(null);
  }, [currency]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const amount = parseMoneyInput(amountText, currency);
    if (amount === null || amount === 0) {
      setError(
        getCurrency(currency).exponent === 0
          ? `Saisissez un montant entier supérieur à 0, en ${currencySymbol(currency)}.`
          : `Saisissez un montant supérieur à 0 (${getCurrency(currency).exponent} décimales au plus), en ${currencySymbol(currency)}.`,
      );
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
  const destinations = activeAccounts.filter((a) => a.id !== accountId && a.currency === currency);

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
        label={`Montant (${currency})`}
        value={amountText}
        onChangeText={(t) => setAmountText(sanitizeAmount(t, currency))}
        keyboardType={getCurrency(currency).exponent === 0 ? 'number-pad' : 'decimal-pad'}
        placeholder={getCurrency(currency).exponent === 0 ? '0' : '0,00'}
        suffix={currencySymbol(currency)}
        autoFocus={!editing}
        style={{ fontSize: 24, fontWeight: '700', color: accent }}
      />

      <View style={{ gap: 6 }}>
        <Text style={styles.label}>{type === 'transfer' ? 'Compte source' : 'Compte'}</Text>
        <ChipRow>
          {activeAccounts.filter((a) => !editing || a.currency === initial!.currency).map((a) => (
            <Chip key={a.id} label={accountLabel(a)} selected={accountId === a.id} onPress={() => setAccountId(a.id)} />
          ))}
        </ChipRow>
        {editing && multiCurrency ? <Text style={styles.hint}>Seuls les comptes en {initial!.currency} sont proposés : le montant d'une opération ne peut pas changer de devise.</Text> : null}
      </View>

      {type === 'transfer' ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Compte destinataire</Text>
          <ChipRow>
            {destinations.map((a) => (
              <Chip key={a.id} label={accountLabel(a)} selected={toAccountId === a.id} onPress={() => setToAccountId(a.id)} />
            ))}
          </ChipRow>
          {destinations.length === 0 ? (
            <Text style={styles.hint}>Aucun autre compte actif en {currency}. Les transferts se font entre comptes de même devise (les opérations de change ne sont pas encore disponibles).</Text>
          ) : multiCurrency ? (
            <Text style={styles.hint}>Seuls les comptes en {currency} sont proposés : un transfert ne change pas de devise.</Text>
          ) : null}
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
