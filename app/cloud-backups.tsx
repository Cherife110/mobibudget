import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Banner, Card, EmptyState, RowDivider, Screen } from '../src/components/ui';
import { PasswordModal } from '../src/components/PasswordModal';
import { cloudErrorMessage } from '../src/components/CloudSection';
import { useCloud } from '../src/context/CloudContext';
import { colors } from '../src/theme';
import type { RemoteBackupMeta } from '../src/cloud/types';
import { PasswordRequiredError, KEEP_BACKUPS } from '../src/services/cloudBackup.service';
import { formatDateFR, formatRelativeFR } from '../src/utils/dates';
import { confirmAsync, notify } from '../src/utils/ui';

export default function CloudBackups() {
  const cloud = useCloud();
  const router = useRouter();
  const [list, setList] = useState<RemoteBackupMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<RemoteBackupMeta | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setList(await cloud.listBackups());
    } catch (e) {
      setError(cloudErrorMessage(e));
      setList([]);
    }
  }, [cloud]);
  useEffect(() => { void load(); }, [load]);

  const doRestore = async (meta: RemoteBackupMeta, password?: string) => {
    await cloud.restore(meta, password);
    notify('Restauration terminée', 'Vos données ont été restaurées. Une copie de sécurité de vos données précédentes a été gardée sur ce téléphone (dossier « securite »).');
    router.replace('/');
  };

  const choose = async (meta: RemoteBackupMeta) => {
    const ok = await confirmAsync(
      'Restaurer cette sauvegarde ?',
      `Sauvegarde du ${formatDateFR(meta.createdAt.slice(0, 10))} : ${meta.summary.accounts} compte(s), ${meta.summary.transactions} opération(s).\n\nToutes les données actuelles de ce téléphone seront REMPLACÉES. Une copie de sécurité en est gardée sur le téléphone avant le remplacement.`,
      'Restaurer',
    );
    if (!ok) return;
    try {
      await doRestore(meta);
    } catch (e) {
      if (e instanceof PasswordRequiredError) setPending(meta);
      else notify('Restauration impossible — vos données actuelles sont intactes', cloudErrorMessage(e));
    }
  };

  if (!cloud.user) return <Screen><EmptyState icon="cloud-offline-outline" title="Non connecté" text="Connectez-vous avec Google dans Paramètres pour voir vos sauvegardes en ligne." /></Screen>;

  return (
    <Screen>
      <Banner tone="info" text={`Les ${KEEP_BACKUPS} sauvegardes les plus récentes sont conservées. Touchez-en une pour la restaurer.`} />
      {error ? <Banner tone="error" text={error} /> : null}
      <Card style={{ paddingVertical: 4 }}>
        {list === null ? (
          <Text style={styles.sub}>Chargement…</Text>
        ) : list.length === 0 ? (
          <EmptyState icon="cloud-outline" title="Aucune sauvegarde en ligne" text="La première partira automatiquement, ou depuis « Sauvegarder maintenant »." />
        ) : (
          list.map((b, i) => (
            <View key={b.id}>
              {i > 0 && <RowDivider />}
              <Pressable style={styles.row} onPress={() => choose(b)} accessibilityRole="button" accessibilityLabel={`Restaurer la sauvegarde du ${formatDateFR(b.createdAt.slice(0, 10))}`}>
                <Ionicons name={b.encrypted ? 'lock-closed-outline' : 'cloud-done-outline'} size={22} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{formatDateFR(b.createdAt.slice(0, 10))} · {formatRelativeFR(b.createdAt)}</Text>
                  <Text style={styles.sub}>{b.summary.accounts} compte(s) · {b.summary.transactions} opération(s) · {b.summary.budgets} budget(s){b.encrypted ? ' · chiffrée' : ''}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.faint} />
              </Pressable>
            </View>
          ))
        )}
      </Card>
      <PasswordModal
        visible={!!pending}
        title="Mot de passe de la sauvegarde"
        message="Cette sauvegarde est chiffrée. Saisissez le mot de passe choisi lors de son activation."
        onClose={() => setPending(null)}
        onSubmit={async (p) => {
          const meta = pending!;
          setPending(null);
          await doRestore(meta, p);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, minHeight: 64 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
