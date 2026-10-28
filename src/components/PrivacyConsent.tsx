import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Banner, Button, Card, Checkbox } from './ui';
import { useApp } from '../context/AppContext';
import { colors } from '../theme';
import { acceptPrivacyPolicy } from '../services/privacy.service';
import { errorMessage } from '../utils/errors';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function Point({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.point}>
      <Ionicons name={icon} size={20} color={colors.income} />
      <Text style={styles.pointText}>{text}</Text>
    </View>
  );
}

/**
 * Politique de confidentialité : acceptation obligatoire pour utiliser l'application,
 * statistiques facultatives (case décochée par défaut).
 */
export function PrivacyConsent({ onAccepted, onBack }: { onAccepted: () => void; onBack?: () => void }) {
  const router = useRouter();
  const { db, refresh } = useApp();
  const [accepted, setAccepted] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      await acceptPrivacyPolicy(db, { analyticsConsent: analytics });
      await refresh();
      onAccepted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <View style={styles.logo}><Ionicons name="shield-checkmark" size={40} color="#fff" /></View>
      <Text style={styles.title}>Vos données, vos choix</Text>
      <Text style={styles.lead}>Avant de continuer, voici ce que MobiBudget fait de vos informations.</Text>
      <Card style={{ gap: 14 }}>
        <Point
          icon="phone-portrait-outline"
          text="Vos comptes, opérations et budgets restent sur ce téléphone. Ils ne sont envoyés en ligne que si vous activez la sauvegarde avec votre compte Google."
        />
        <Point
          icon="stats-chart-outline"
          text="Si vous l'acceptez, des statistiques d'utilisation (appareil, pays, version, fréquence d'utilisation) sont envoyées à Google Analytics pour Firebase. Jamais de montants ni de noms."
        />
        <Point icon="eye-off-outline" text="Aucune publicité, aucun identifiant publicitaire." />
      </Card>
      <Button label="Lire la politique de confidentialité" icon="document-text-outline" variant="ghost" onPress={() => router.push('/privacy-policy')} />
      {error ? <Banner tone="error" text={error} /> : null}
      <Checkbox label="J'ai lu et j'accepte la politique de confidentialité" checked={accepted} onChange={setAccepted} />
      <Checkbox
        label="Partager des statistiques d'utilisation"
        hint="Facultatif. Vous pourrez changer d'avis dans Paramètres."
        checked={analytics}
        onChange={setAnalytics}
      />
      <Button label="Continuer" icon="arrow-forward" onPress={submit} disabled={!accepted} loading={saving} />
      {onBack ? <Button label="Retour" variant="ghost" onPress={onBack} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  logo: { width: 84, height: 84, borderRadius: 24, backgroundColor: colors.income, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, textAlign: 'center' },
  lead: { fontSize: 15, color: colors.muted, textAlign: 'center', lineHeight: 22 },
  point: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  pointText: { flex: 1, fontSize: 14, color: colors.text, lineHeight: 20 },
});
