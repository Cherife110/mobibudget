import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Banner, Button, Card, RowDivider, Screen, SectionTitle } from '../../src/components/ui';
import { useApp } from '../../src/context/AppContext';
import { useBackupActions } from '../../src/hooks/useBackupActions';
import { useQuery } from '../../src/hooks/useQuery';
import { colors } from '../../src/theme';
import { getBackupInfo } from '../../src/services/backup.service';
import { APP_VERSION } from '../../src/constants/defaults';
import { formatDateFR } from '../../src/utils/dates';
import { formatNumber } from '../../src/utils/money';

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
  const { settings } = useApp();
  const { data: info } = useQuery((db) => getBackupInfo(db));
  const { busy, runExport, runRestore } = useBackupActions();
  const hasData = !!info && (info.transactions > 0 || info.accounts > 0);
  const version = Constants.expoConfig?.version ?? APP_VERSION;

  return (
    <Screen>
      <SectionTitle title="Général" />
      <Card style={{ paddingVertical: 4 }}>
        <View style={styles.link}>
          <Ionicons name="cash-outline" size={22} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.linkLabel}>Devise</Text>
            <Text style={styles.sub}>Franc CFA ({settings.currency}) — affichage « 25 000 FCFA »</Text>
          </View>
        </View>
        <RowDivider />
        <LinkRow icon="wallet-outline" label="Comptes" sub="Créer, modifier, archiver" onPress={() => router.push('/accounts')} />
        <RowDivider />
        <LinkRow icon="pricetags-outline" label="Catégories" sub="Ajouter, renommer, désactiver" onPress={() => router.push('/categories')} />
      </Card>

      <SectionTitle title="Sauvegarde et restauration" />
      <Card style={{ gap: 12 }}>
        <Text style={styles.sub}>
          {info
            ? `${formatNumber(info.accounts)} compte(s) · ${formatNumber(info.transactions)} opération(s) · ${formatNumber(info.budgets)} budget(s)`
            : 'Chargement…'}
        </Text>
        <Text style={styles.sub}>
          Dernière sauvegarde : {info?.lastBackupAt ? formatDateFR(info.lastBackupAt.slice(0, 10)) : 'jamais'}
        </Text>
        <Banner tone="warning" text="Vos données ne sont stockées que sur ce téléphone. Exportez régulièrement une sauvegarde et gardez-la ailleurs (Drive, e-mail…). Le fichier JSON n'est pas chiffré : ne le partagez qu'avec des personnes de confiance." />
        <Button label="Enregistrer dans un dossier" icon="download-outline" onPress={() => runExport('save')} loading={busy} />
        <Button label="Partager la sauvegarde" icon="share-outline" variant="secondary" onPress={() => runExport('share')} disabled={busy} />
        <Button label="Restaurer une sauvegarde" icon="cloud-upload-outline" variant="danger" onPress={() => runRestore(hasData)} disabled={busy} />
        <Text style={styles.sub}>La restauration remplace toutes les données actuelles ; le fichier est vérifié avant tout remplacement.</Text>
      </Card>

      <SectionTitle title="À propos" />
      <Card style={{ gap: 8 }}>
        <View style={styles.between}><Text style={styles.linkLabel}>MobiBudget</Text><Text style={styles.sub}>Version {version}</Text></View>
        <Text style={styles.sub}>Application 100 % hors connexion : aucune donnée n'est envoyée à un serveur.</Text>
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
