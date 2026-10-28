import React, { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Button, Card, RowDivider } from './ui';
import { PasswordModal } from './PasswordModal';
import { useCloud } from '../context/CloudContext';
import { colors } from '../theme';
import type { BackupOutcome } from '../services/cloudBackup.service';
import { formatRelativeFR } from '../utils/dates';
import { confirmAsync, notify } from '../utils/ui';

/** Message lisible pour une erreur de connexion Google / Firebase. */
export function cloudErrorMessage(e: unknown): string {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  if (code === '10' || /DEVELOPER_ERROR/.test(code)) return 'Configuration Google incomplète (empreinte SHA-1 ou identifiant client). Voir docs/FIREBASE.md.';
  if (code === '7' || /NETWORK/i.test(code)) return 'Pas de connexion internet. Réessayez une fois connecté.';
  if (/PLAY_SERVICES/.test(code)) return 'Les services Google Play sont absents ou à mettre à jour sur ce téléphone.';
  if (e instanceof Error && e.name === 'BackupError') return e.message;
  return 'La connexion a échoué. Vérifiez votre connexion internet puis réessayez.';
}

export function outcomeMessage(o: BackupOutcome): string {
  switch (o.status) {
    case 'uploaded': return 'Sauvegarde envoyée.';
    case 'unchanged': return 'Déjà à jour : rien n\'a changé depuis la dernière sauvegarde.';
    case 'failed': return o.error;
    case 'skipped':
      return {
        offline: 'Pas de connexion internet : la sauvegarde partira automatiquement dès que possible.',
        'wifi-only': 'En attente du Wi-Fi (option « Wi-Fi seulement »).',
        'signed-out': 'Connectez-vous pour sauvegarder en ligne.',
        'not-configured': 'Sauvegarde en ligne non disponible dans cette version.',
        'auto-disabled': 'Sauvegarde automatique désactivée.',
        backoff: 'Nouvel essai automatique dans quelques minutes.',
        empty: 'Rien à sauvegarder pour l\'instant.',
      }[o.reason];
  }
}

export function CloudSection() {
  const cloud = useCloud();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  if (!cloud.available) {
    return (
      <Card>
        <Text style={styles.sub}>Sauvegarde en ligne indisponible dans cette version (configuration Firebase absente, ou version navigateur).</Text>
      </Card>
    );
  }

  if (!cloud.user) {
    return (
      <Card style={{ gap: 12 }}>
        <Text style={styles.label}>Sauvegarde en ligne désactivée</Text>
        <Text style={styles.sub}>Connectez-vous avec Google pour envoyer automatiquement une copie de vos données en ligne et les retrouver sur un nouveau téléphone. L'application continue de fonctionner sans internet.</Text>
        <Button
          label="Se connecter avec Google"
          icon="logo-google"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              const u = await cloud.signIn();
              if (u) {
                const list = await cloud.listBackups();
                if (list.length > 0) notify('Sauvegardes trouvées', `${list.length} sauvegarde(s) en ligne existent déjà pour ce compte. Vous pouvez les consulter dans « Sauvegardes en ligne ».`);
                const r = await cloud.backupNow();
                if (r.status !== 'uploaded') notify('Sauvegarde en ligne', outcomeMessage(r));
              }
            } catch (e) {
              notify('Connexion impossible', cloudErrorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Card>
    );
  }

  const s = cloud.settings;
  return (
    <Card style={{ gap: 12 }}>
      <Text style={styles.label}>Connecté : {cloud.user.email ?? cloud.user.displayName ?? 'compte Google'}</Text>
      <Text style={styles.sub}>
        {s?.lastSuccessAt ? `Dernière sauvegarde en ligne : ${formatRelativeFR(s.lastSuccessAt)}.` : 'Aucune sauvegarde en ligne pour l\'instant.'}
        {s?.lastCheckAt && s.lastCheckAt !== s.lastSuccessAt ? ` Vérifiée ${formatRelativeFR(s.lastCheckAt)} : à jour.` : ''}
      </Text>
      {s?.lastError ? <Banner tone="error" text={`Dernier essai : ${s.lastError}`} /> : null}

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.option}>Sauvegarde automatique</Text>
          <Text style={styles.sub}>Après vos modifications, à l'ouverture, et environ toutes les 12 h.</Text>
        </View>
        <Switch value={!!s?.autoEnabled} onValueChange={(v) => cloud.setOption('autoEnabled', v)} trackColor={{ true: colors.income, false: colors.border }} />
      </View>
      <RowDivider />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.option}>Wi-Fi seulement</Text>
          <Text style={styles.sub}>Les sauvegardes automatiques attendent le Wi-Fi.</Text>
        </View>
        <Switch value={!!s?.wifiOnly} onValueChange={(v) => cloud.setOption('wifiOnly', v)} trackColor={{ true: colors.income, false: colors.border }} />
      </View>
      <RowDivider />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.option}>Protéger par un mot de passe</Text>
          <Text style={styles.sub}>Chiffre la sauvegarde en ligne. Mot de passe oublié = sauvegarde irrécupérable.</Text>
        </View>
        <Switch
          value={!!s?.encrypted}
          trackColor={{ true: colors.income, false: colors.border }}
          onValueChange={async (v) => {
            if (v) setPasswordOpen(true);
            else if (await confirmAsync('Retirer le mot de passe ?', 'Les prochaines sauvegardes en ligne ne seront plus chiffrées.', 'Retirer')) await cloud.removePassword();
          }}
        />
      </View>

      <Button
        label="Sauvegarder maintenant"
        icon="cloud-upload-outline"
        loading={busy}
        onPress={async () => {
          setBusy(true);
          try {
            notify('Sauvegarde en ligne', outcomeMessage(await cloud.backupNow()));
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button label="Voir et restaurer mes sauvegardes" icon="time-outline" variant="secondary" onPress={() => router.push('/cloud-backups')} />
      <Button
        label="Se déconnecter"
        variant="ghost"
        onPress={async () => {
          if (await confirmAsync('Se déconnecter ?', 'Vos données restent sur ce téléphone, mais ne seront plus sauvegardées en ligne. Vos sauvegardes en ligne existantes sont conservées.', 'Se déconnecter')) {
            await cloud.signOut();
          }
        }}
      />
      <Button
        label="Supprimer mon compte en ligne"
        icon="trash-outline"
        variant="danger"
        disabled={busy}
        onPress={async () => {
          const ok = await confirmAsync(
            'Supprimer votre compte en ligne ?',
            'Toutes vos sauvegardes en ligne seront effacées, puis votre compte MobiBudget. Votre compte Google lui-même n\'est pas touché, et les données de ce téléphone sont conservées : exportez-les d\'abord si vous voulez en garder une copie.\n\nCette action est définitive.',
            'Supprimer',
          );
          if (!ok) return;
          setBusy(true);
          try {
            const deleted = await cloud.deleteAccount();
            if (deleted !== null) notify('Compte supprimé', `${deleted} sauvegarde(s) en ligne et votre compte ont été supprimés. Vos données restent sur ce téléphone.`);
          } catch (e) {
            notify('Suppression impossible', `${cloudErrorMessage(e)} Vos données sur ce téléphone sont intactes ; vous pouvez réessayer.`);
          } finally {
            setBusy(false);
          }
        }}
      />

      <PasswordModal
        visible={passwordOpen}
        confirm
        title="Mot de passe de sauvegarde"
        message="Il sera demandé pour restaurer vos données sur un autre téléphone. Il n'est envoyé nulle part et ne peut pas être récupéré : notez-le en lieu sûr."
        onClose={() => setPasswordOpen(false)}
        onSubmit={async (p) => {
          await cloud.setPassword(p);
          setPasswordOpen(false);
          notify('Mot de passe enregistré', 'Les prochaines sauvegardes en ligne seront chiffrées.');
        }}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: '700', color: colors.text },
  option: { fontSize: 15, fontWeight: '600', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
