import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Banner, Button, Card, RowDivider, Screen, SectionTitle } from '../../src/components/ui';
import { useApp } from '../../src/context/AppContext';
import { useBackupActions } from '../../src/hooks/useBackupActions';
import { CloudSection } from '../../src/components/CloudSection';
import { useCloud } from '../../src/context/CloudContext';
import { useQuery } from '../../src/hooks/useQuery';
import { colors } from '../../src/theme';
import { getBackupInfo } from '../../src/services/backup.service';
import { setAnalyticsConsent } from '../../src/services/privacy.service';
import { APP_VERSION } from '../../src/constants/defaults';
import { PRIVACY_POLICY_VERSION } from '../../src/constants/privacy';
import { formatDateFR } from '../../src/utils/dates';
import { formatNumber } from '../../src/utils/money';
import { showError } from '../../src/utils/ui';

function LinkRow({ icon, label, sub, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; sub?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.link}>
      <Ionicons name={icon} size={22} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.linkLabel}>{label}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.faint} />
    </Pressable>
  );
}

export default function Settings() {
  const router = useRouter();
  const { db, settings, refresh } = useApp();
  const { data: info } = useQuery((db) => getBackupInfo(db));
  const { busy, runExport, runRestore } = useBackupActions();
  const hasData = !!info && (info.transactions > 0 || info.accounts > 0);
  const version = Constants.expoConfig?.version ?? APP_VERSION;
  const cloud = useCloud();

  const toggleAnalytics = async (enabled: boolean) => {
    try {
      await setAnalyticsConsent(db, enabled);
      await refresh();
    } catch (e) {
      showError(e);
    }
  };

  return (
    <Screen>
      <SectionTitle title="Général" />
      <Card style={{ paddingVertical: 4 }}>
        <View style={styles.link}>
          <Ionicons name="cash-outline" size={22} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.linkLabel}>Devise</Text>
            <Text style={styles.sub}>Devise de référence : {settings.referenceCurrency} — totaux, budgets et statistiques</Text>
          </View>
        </View>
        <RowDivider />
        <LinkRow icon="wallet-outline" label="Comptes" sub="Créer, modifier, archiver" onPress={() => router.push('/accounts')} />
        <RowDivider />
        <LinkRow icon="swap-horizontal-outline" label="Taux de change" sub="Taux saisis à la main pour les comptes en devises étrangères" onPress={() => router.push('/exchange-rates')} />
        <RowDivider />
        <LinkRow icon="pricetags-outline" label="Catégories" sub="Ajouter, renommer, désactiver" onPress={() => router.push('/categories')} />
      </Card>

      <SectionTitle title="Sauvegarde en ligne" />
      <CloudSection />

      <SectionTitle title="Sauvegarde sur fichier" />
      <Card style={{ gap: 12 }}>
        <Text style={styles.sub}>
          {info
            ? `${formatNumber(info.accounts)} compte(s) · ${formatNumber(info.transactions)} opération(s) · ${formatNumber(info.budgets)} budget(s) · ${formatNumber(info.exchangeRates)} taux`
            : 'Chargement…'}
        </Text>
        <Text style={styles.sub}>
          Dernière sauvegarde : {info?.lastBackupAt ? formatDateFR(info.lastBackupAt.slice(0, 10)) : 'jamais'}
        </Text>
        <Banner tone="warning" text="Le fichier de sauvegarde (JSON) n'est pas chiffré : ne le partagez qu'avec des personnes de confiance. Sans sauvegarde en ligne, exportez-le régulièrement et gardez-le ailleurs (Drive, e-mail…)." />
        <Button label="Enregistrer dans un dossier" icon="download-outline" onPress={() => runExport('save')} loading={busy} />
        <Button label="Partager la sauvegarde" icon="share-outline" variant="secondary" onPress={() => runExport('share')} disabled={busy} />
        <Button label="Restaurer une sauvegarde" icon="cloud-upload-outline" variant="danger" onPress={() => runRestore(hasData)} disabled={busy} />
        <Text style={styles.sub}>La restauration remplace toutes les données actuelles ; le fichier est vérifié avant tout remplacement.</Text>
      </Card>

      <SectionTitle title="Confidentialité" />
      <Card style={{ paddingVertical: 4 }}>
        <View style={styles.link}>
          <Ionicons name="stats-chart-outline" size={22} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.linkLabel}>Statistiques d'utilisation</Text>
            <Text style={styles.sub}>Aident à améliorer MobiBudget (Google Analytics pour Firebase). Jamais de montants ni de noms.</Text>
          </View>
          <Switch
            value={settings.analyticsConsent}
            onValueChange={toggleAnalytics}
            accessibilityLabel="Statistiques d'utilisation"
            trackColor={{ false: colors.border, true: colors.income }}
            thumbColor={colors.card}
          />
        </View>
        <RowDivider />
        <LinkRow icon="shield-checkmark-outline" label="Politique de confidentialité" sub={`Version ${PRIVACY_POLICY_VERSION} — ce qui est collecté et pourquoi`} onPress={() => router.push('/privacy-policy')} />
      </Card>

      <SectionTitle title="À propos" />
      <Card style={{ gap: 8 }}>
        <View style={styles.between}><Text style={styles.linkLabel}>MobiBudget</Text><Text style={styles.sub}>Version {version}</Text></View>
        <Text style={styles.sub}>
          {cloud.user
            ? 'Sauvegarde en ligne activée : une copie de vos données est envoyée sur les serveurs de Google (Firebase), associée à votre compte. L\'application fonctionne aussi sans internet.'
            : 'Vos données financières restent sur ce téléphone : rien n\'en est envoyé tant que la sauvegarde en ligne n\'est pas activée.'}
        </Text>
        <RowDivider />
        <Text style={styles.linkLabel}>Convention pour les remboursements</Text>
        <Text style={styles.sub}>
          Un remboursement reçu s'enregistre comme une entrée de la catégorie « Remboursement reçu ». L'argent que vous avancez pour quelqu'un reste une dépense : ne déduisez pas le remboursement de la dépense, pour ne pas le compter deux fois.
        </Text>
        <Text style={styles.sub}>Les transferts entre vos comptes ne sont ni des revenus ni des dépenses.</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, minHeight: 60 },
  linkLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
