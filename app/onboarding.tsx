import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Banner, Button, Card, Chip, ChipRow, Field, Screen } from '../src/components/ui';
import { DateField } from '../src/components/DateField';
import { IntroSlides } from '../src/components/IntroSlides';
import { useApp } from '../src/context/AppContext';
import { useCloud } from '../src/context/CloudContext';
import { PasswordRequiredError } from '../src/services/cloudBackup.service';
import type { RemoteBackupMeta } from '../src/cloud/types';
import { cloudErrorMessage } from '../src/components/CloudSection';
import { useBackupActions } from '../src/hooks/useBackupActions';
import { colors } from '../src/theme';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from '../src/constants/defaults';
import { completeOnboarding } from '../src/services/onboarding.service';
import { ACCOUNT_TYPES } from '../src/services/account.service';
import { ACCOUNT_TYPE_LABELS, type AccountType } from '../src/types';
import { formatDateFR, todayISO } from '../src/utils/dates';
import { errorMessage } from '../src/utils/errors';
import { currencySymbol, parseSignedMoneyInput } from '../src/utils/money';
import { CurrencyPicker } from '../src/components/CurrencyPicker';
import { PrivacyConsent } from '../src/components/PrivacyConsent';
import { getCurrency } from '../src/constants/currencies';
import { trackEvent } from '../src/lib/analytics';

/**
 * Premier lancement, dans l'ordre : présentation, politique de confidentialité, choix Google / hors ligne,
 * (restauration si une sauvegarde en ligne existe), premier compte, catégories.
 */
type Step = 'intro' | 'privacy' | 'protect' | 'restore' | 'account' | 'categories';

export default function Onboarding() {
  const router = useRouter();
  const { db, refresh } = useApp();
  const [step, setStep] = useState<Step>('intro');
  const [name, setName] = useState('Espèces');
  const [type, setType] = useState<AccountType>('cash');
  const [currency, setCurrency] = useState('XOF');
  const [balanceText, setBalanceText] = useState('');
  const [refDate, setRefDate] = useState(todayISO());
  const [income, setIncome] = useState<string[]>(DEFAULT_INCOME_CATEGORIES);
  const [expense, setExpense] = useState<string[]>(DEFAULT_EXPENSE_CATEGORIES);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { busy, runRestore } = useBackupActions({ onRestored: () => router.replace('/') });
  const cloud = useCloud();
  const [connecting, setConnecting] = useState(false);
  const [offer, setOffer] = useState<RemoteBackupMeta | null>(null);
  const [needPassword, setNeedPassword] = useState(false);
  const [password, setPassword] = useState('');

  const connect = async () => {
    setError(null);
    setConnecting(true);
    try {
      const u = await cloud.signIn();
      if (!u) return; // annulé
      const list = await cloud.listBackups();
      if (list.length > 0) {
        setOffer(list[0]);
        setNeedPassword(list[0].encrypted);
        setStep('restore');
      } else setStep('account');
    } catch (e) {
      setError(cloudErrorMessage(e));
    } finally {
      setConnecting(false);
    }
  };

  const restoreOffer = async () => {
    if (!offer) return;
    setError(null);
    setSaving(true);
    try {
      await cloud.restore(offer, needPassword ? password : undefined);
      router.replace('/');
    } catch (e) {
      if (e instanceof PasswordRequiredError) setNeedPassword(true);
      setError(cloudErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (list: string[], set: (v: string[]) => void, n: string) => set(list.includes(n) ? list.filter((x) => x !== n) : [...list, n]);

  const next = () => {
    setError(null);
    if (parseSignedMoneyInput(balanceText === '' ? '0' : balanceText, currency) === null) {
      return setError('Le solde initial n\'est pas valide (négatif autorisé ; décimales seulement pour les devises qui en ont).');
    }
    if (name.trim().length === 0) return setError('Donnez un nom à votre premier compte.');
    setStep('categories');
  };

  const finish = async () => {
    setError(null);
    setSaving(true);
    try {
      await completeOnboarding(db, {
        account: { name, type, currency, initialBalance: parseSignedMoneyInput(balanceText === '' ? '0' : balanceText, currency) ?? 0, referenceDate: refDate },
        incomeCategories: income,
        expenseCategories: expense,
      });
      await refresh();
      trackEvent('onboarding_complete');
      router.replace('/');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen style={{ paddingTop: 56 }}>
      {step === 'intro' ? <IntroSlides onDone={() => setStep('privacy')} onRestore={() => runRestore(false)} busy={busy} /> : null}

      {step === 'privacy' ? <PrivacyConsent onAccepted={() => setStep('protect')} onBack={() => setStep('intro')} /> : null}

      {step === 'protect' ? (
        <>
          <Text style={styles.title}>Comment protéger vos données ?</Text>
          {error ? <Banner tone="error" text={error} /> : null}
          <Card style={{ gap: 10 }}>
            <View style={styles.optionHead}>
              <Ionicons name="cloud-done-outline" size={24} color={colors.income} />
              <Text style={styles.optionTitle}>Avec mon compte Google</Text>
              <Text style={styles.badge}>Recommandé</Text>
            </View>
            <Text style={styles.point}>• Sauvegarde automatique en ligne dès qu'il y a internet</Text>
            <Text style={styles.point}>• Nouveau téléphone : connectez-vous et retrouvez tout</Text>
            <Text style={styles.point}>• L'application fonctionne aussi sans internet</Text>
            <Text style={styles.hint}>Une copie de vos données est envoyée sur les serveurs de Google (Firebase), accessible uniquement avec votre compte. Vous pourrez la protéger par un mot de passe dans Paramètres.</Text>
            {cloud.available ? (
              <Button label="Se connecter avec Google" icon="logo-google" onPress={connect} loading={connecting} />
            ) : (
              <Banner tone="info" text="La sauvegarde en ligne n'est pas disponible dans cette version (configuration Firebase absente ou version navigateur)." />
            )}
          </Card>
          <Card style={{ gap: 10 }}>
            <View style={styles.optionHead}>
              <Ionicons name="phone-portrait-outline" size={24} color={colors.text} />
              <Text style={styles.optionTitle}>Hors ligne uniquement</Text>
            </View>
            <Banner tone="warning" text="Si le téléphone est perdu, volé ou réinitialisé, vos données sont perdues, sauf si vous exportez régulièrement une sauvegarde (Paramètres)." />
            <Button label="Continuer hors ligne" variant="secondary" onPress={() => { setError(null); setStep('account'); }} disabled={connecting} />
          </Card>
          <Text style={[styles.hint, { textAlign: 'center' }]}>Vous pourrez changer d'avis à tout moment dans Paramètres.</Text>
          <Button label="Retour" variant="ghost" onPress={() => setStep('privacy')} />
        </>
      ) : null}

      {step === 'restore' && offer ? (
        <>
          <Text style={styles.title}>Une sauvegarde a été trouvée</Text>
          <Card style={{ gap: 6 }}>
            <Text style={styles.optionTitle}>Sauvegarde du {formatDateFR(offer.createdAt.slice(0, 10))} à {offer.createdAt.slice(11, 16)} (UTC)</Text>
            <Text style={styles.point}>{offer.summary.accounts} compte(s) · {offer.summary.transactions} opération(s) · {offer.summary.budgets} budget(s)</Text>
            {offer.encrypted ? <Text style={styles.hint}>Cette sauvegarde est protégée par un mot de passe.</Text> : null}
          </Card>
          {error ? <Banner tone="error" text={error} /> : null}
          {needPassword ? (
            <Field label="Mot de passe de la sauvegarde" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
          ) : null}
          <Button label="Restaurer mes données" icon="cloud-download-outline" onPress={restoreOffer} loading={saving} disabled={needPassword && password.length === 0} />
          <Button label="Commencer sans restaurer" variant="secondary" onPress={() => { setError(null); setStep('account'); }} disabled={saving} />
          <Text style={[styles.hint, { textAlign: 'center' }]}>Vos sauvegardes en ligne restent disponibles dans Paramètres › Sauvegardes en ligne.</Text>
        </>
      ) : null}

      {step === 'account' ? (
        <>
          <Text style={styles.title}>Votre premier compte</Text>
          <Card style={{ gap: 4 }}>
            <Text style={styles.label}>Devise de référence</Text>
            <Text style={styles.currency}>Franc CFA (FCFA)</Text>
            <Text style={styles.hint}>Les totaux, budgets et statistiques sont exprimés en FCFA. Vos comptes peuvent avoir une autre devise (EUR, USD…) : vous saisirez alors vos taux de change à la main.</Text>
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
          <CurrencyPicker label="Devise de ce compte" value={currency} onChange={setCurrency} />
          <Field
            label="Solde actuel de ce compte"
            value={balanceText}
            onChangeText={(t) => setBalanceText(t.replace(/[^\d\s,.\-]/g, ''))}
            keyboardType="numbers-and-punctuation"
            placeholder={getCurrency(currency).exponent === 0 ? '0' : '0,00'}
            suffix={currencySymbol(currency)}
            hint="Le montant que vous avez dans ce compte à la date ci-dessous."
          />
          <DateField label="Date correspondant à ce solde" value={refDate} onChange={setRefDate} />
          <Text style={styles.hint}>Vous ne pourrez pas enregistrer d'opération antérieure à cette date : choisissez une date de départ assez ancienne si vous voulez saisir des opérations passées.</Text>
          <Button label="Continuer" icon="arrow-forward" onPress={next} />
          <Button label="Retour" variant="ghost" onPress={() => setStep('protect')} />
        </>
      ) : null}

      {step === 'categories' ? (
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
          <Button label="Retour" variant="ghost" onPress={() => setStep('account')} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  optionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  optionTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.text },
  badge: { fontSize: 11, fontWeight: '700', color: colors.income, backgroundColor: colors.incomeBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  point: { fontSize: 14, color: colors.text, lineHeight: 20 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, textAlign: 'center' },
  lead: { fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 22 },
  label: { fontSize: 13, fontWeight: '700', color: colors.muted },
  currency: { fontSize: 17, fontWeight: '700', color: colors.text },
  hint: { fontSize: 12, color: colors.muted, lineHeight: 17 },
});
