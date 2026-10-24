import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Banner, Button, Card, Chip, ChipRow, Field, Screen } from '../src/components/ui';
import { DateField } from '../src/components/DateField';
import { useApp } from '../src/context/AppContext';
import { useBackupActions } from '../src/hooks/useBackupActions';
import { colors } from '../src/theme';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from '../src/constants/defaults';
import { completeOnboarding } from '../src/services/onboarding.service';
import { ACCOUNT_TYPES } from '../src/services/account.service';
import { ACCOUNT_TYPE_LABELS, type AccountType } from '../src/types';
import { todayISO } from '../src/utils/dates';
import { errorMessage } from '../src/utils/errors';
import { parseSignedAmount } from '../src/utils/money';

export default function Onboarding() {
  const router = useRouter();
  const { db, refresh } = useApp();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('Espèces');
  const [type, setType] = useState<AccountType>('cash');
  const [balanceText, setBalanceText] = useState('');
  const [refDate, setRefDate] = useState(todayISO());
  const [income, setIncome] = useState<string[]>(DEFAULT_INCOME_CATEGORIES);
  const [expense, setExpense] = useState<string[]>(DEFAULT_EXPENSE_CATEGORIES);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { busy, runRestore } = useBackupActions({ onRestored: () => router.replace('/') });

  const toggle = (list: string[], set: (v: string[]) => void, n: string) => set(list.includes(n) ? list.filter((x) => x !== n) : [...list, n]);

  const next = () => {
    setError(null);
    if (parseSignedAmount(balanceText === '' ? '0' : balanceText) === null) {
      return setError('Le solde initial doit être un nombre entier de FCFA (négatif autorisé).');
    }
    if (name.trim().length === 0) return setError('Donnez un nom à votre premier compte.');
    setStep(2);
  };

  const finish = async () => {
    setError(null);
    setSaving(true);
    try {
      await completeOnboarding(db, {
        account: { name, type, initialBalance: parseSignedAmount(balanceText === '' ? '0' : balanceText) ?? 0, referenceDate: refDate },
        incomeCategories: income,
        expenseCategories: expense,
      });
      await refresh();
      router.replace('/');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen style={{ paddingTop: 56 }}>
      {step === 0 ? (
        <>
          <View style={styles.logo}><Ionicons name="wallet" size={44} color="#fff" /></View>
          <Text style={styles.title}>Bienvenue sur MobiBudget</Text>
          <Text style={styles.lead}>
            Suivez vos entrées et vos dépenses, gardez un œil sur vos comptes et vos budgets. Tout reste sur votre téléphone : pas de compte en ligne, pas de connexion nécessaire.
          </Text>
          <Card style={{ gap: 8 }}>
            <Text style={styles.point}>• Plusieurs comptes : espèces, Mobile Money, banque</Text>
            <Text style={styles.point}>• Statistiques et graphiques clairs</Text>
            <Text style={styles.point}>• Sauvegarde et restauration de vos données</Text>
          </Card>
          <Button label="Commencer" icon="arrow-forward" onPress={() => setStep(1)} />
          <Button label="Restaurer une sauvegarde" icon="cloud-upload-outline" variant="secondary" onPress={() => runRestore(false)} disabled={busy} />
        </>
      ) : null}

      {step === 1 ? (
        <>
          <Text style={styles.title}>Votre premier compte</Text>
          <Card style={{ gap: 4 }}>
            <Text style={styles.label}>Devise</Text>
            <Text style={styles.currency}>Franc CFA (FCFA)</Text>
            <Text style={styles.hint}>Les montants s'affichent sous la forme « 25 000 FCFA ».</Text>
          </Card>
          {error ? <Banner tone="error" text={error} /> : null}
          <Field label="Nom du compte" value={name} onChangeText={setName} maxLength={40} />
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Type</Text>
            <ChipRow>
              {ACCOUNT_TYPES.map((t) => (
                <Chip key={t} label={ACCOUNT_TYPE_LABELS[t]} selected={type === t} onPress={() => setType(t)} />
              ))}
            </ChipRow>
          </View>
          <Field
            label="Solde actuel de ce compte"
            value={balanceText}
            onChangeText={(t) => setBalanceText(t.replace(/[^\d\s-]/g, ''))}
            keyboardType="numbers-and-punctuation"
            placeholder="0"
            suffix="FCFA"
            hint="Le montant que vous avez dans ce compte à la date ci-dessous."
          />
          <DateField label="Date correspondant à ce solde" value={refDate} onChange={setRefDate} />
          <Text style={styles.hint}>Vous ne pourrez pas enregistrer d'opération antérieure à cette date : choisissez une date de départ assez ancienne si vous voulez saisir des opérations passées.</Text>
          <Button label="Continuer" icon="arrow-forward" onPress={next} />
          <Button label="Retour" variant="ghost" onPress={() => setStep(0)} />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Text style={styles.title}>Catégories</Text>
          <Text style={styles.lead}>Gardez celles qui vous servent ; vous pourrez en ajouter, renommer ou désactiver plus tard.</Text>
          {error ? <Banner tone="error" text={error} /> : null}
          <Text style={styles.label}>Revenus</Text>
          <ChipRow>
            {DEFAULT_INCOME_CATEGORIES.map((c) => <Chip key={c} label={c} tone="income" selected={income.includes(c)} onPress={() => toggle(income, setIncome, c)} />)}
          </ChipRow>
          <Text style={styles.label}>Dépenses</Text>
          <ChipRow>
            {DEFAULT_EXPENSE_CATEGORIES.map((c) => <Chip key={c} label={c} tone="expense" selected={expense.includes(c)} onPress={() => toggle(expense, setExpense, c)} />)}
          </ChipRow>
          <Button label="Terminer" icon="checkmark" onPress={finish} loading={saving} />
          <Button label="Retour" variant="ghost" onPress={() => setStep(1)} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  logo: { width: 84, height: 84, borderRadius: 24, backgroundColor: colors.income, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, textAlign: 'center' },
  lead: { fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 22 },
  point: { fontSize: 14, color: colors.text },
  label: { fontSize: 13, fontWeight: '700', color: colors.muted },
  currency: { fontSize: 17, fontWeight: '700', color: colors.text },
  hint: { fontSize: 12, color: colors.muted, lineHeight: 17 },
});
