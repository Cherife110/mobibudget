import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useApp } from '../context/AppContext';
import { exportBackup, pickAndValidateBackup } from '../services/backup.files';
import { restoreBackup, summarizeBackup, type BackupFile } from '../services/backup.service';
import { formatNumber } from '../utils/money';
import { formatDateFR } from '../utils/dates';
import { confirmAsync, showError } from '../utils/ui';

/** Export et restauration avec toutes les confirmations (utilisé dans Paramètres et à la première utilisation). */
export function useBackupActions(options: { onRestored?: () => void } = {}) {
  const { db, refresh } = useApp();
  const [busy, setBusy] = useState(false);

  const runExport = useCallback(
    async (mode: 'save' | 'share'): Promise<boolean> => {
      setBusy(true);
      try {
        const r = await exportBackup(db, mode);
        if (r === 'saved') Alert.alert('Sauvegarde enregistrée', 'Le fichier a été enregistré dans le dossier choisi. Conservez-le en lieu sûr : il n\'est pas chiffré.');
        if (r === 'shared') Alert.alert('Sauvegarde exportée', 'Pensez à conserver ce fichier en lieu sûr : il n\'est pas chiffré.');
        await refresh();
        return r !== 'cancelled';
      } catch (e) {
        showError(e, 'Export impossible');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [db, refresh],
  );

  const confirmAndRestore = useCallback(
    async (backup: BackupFile, hasExistingData: boolean): Promise<void> => {
      const s = summarizeBackup(backup);
      const when = backup.exportedAt ? ` exportée le ${formatDateFR(backup.exportedAt.slice(0, 10))}` : '';
      const detail = `Sauvegarde${when} : ${formatNumber(s.accounts)} compte(s), ${formatNumber(s.transactions)} opération(s), ${formatNumber(s.budgets)} budget(s).`;
      if (!hasExistingData) {
        const ok = await confirmAsync('Restaurer cette sauvegarde ?', detail, 'Restaurer', false);
        if (!ok) return;
      } else {
        // 3 choix : annuler / sauvegarder d'abord / remplacer
        const choice = await new Promise<'cancel' | 'backup' | 'replace'>((resolve) => {
          Alert.alert(
            'Remplacer toutes vos données ?',
            `${detail}\n\nLa restauration EFFACE ET REMPLACE toutes les données actuelles de l'application. Il est recommandé de créer d'abord une sauvegarde des données actuelles.`,
            [
              { text: 'Annuler', style: 'cancel', onPress: () => resolve('cancel') },
              { text: 'Sauvegarder d\'abord', onPress: () => resolve('backup') },
              { text: 'Remplacer', style: 'destructive', onPress: () => resolve('replace') },
            ],
            { cancelable: true, onDismiss: () => resolve('cancel') },
          );
        });
        if (choice === 'cancel') return;
        if (choice === 'backup') {
          const done = await runExport('share');
          if (done) return confirmAndRestore(backup, hasExistingData);
          return;
        }
      }
      setBusy(true);
      try {
        await restoreBackup(db, backup);
        await refresh();
        Alert.alert('Restauration terminée', 'Vos données ont été restaurées.');
        options.onRestored?.();
      } catch (e) {
        showError(e, 'Restauration impossible — vos données actuelles sont intactes');
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, refresh, runExport, options.onRestored],
  );

  const runRestore = useCallback(
    async (hasExistingData: boolean): Promise<void> => {
      let backup: BackupFile | null;
      setBusy(true);
      try {
        backup = await pickAndValidateBackup();
      } catch (e) {
        showError(e, 'Fichier refusé');
        return;
      } finally {
        setBusy(false);
      }
      if (!backup) return;
      await confirmAndRestore(backup, hasExistingData);
    },
    [confirmAndRestore],
  );

  return { busy, runExport, runRestore };
}
