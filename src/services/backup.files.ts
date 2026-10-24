import { Directory, File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import type { Db } from '../db/types';
import {
  BACKUP_MAX_BYTES, BackupError, backupFileName, createBackup, markBackupExported, parseBackup, serializeBackup,
  type BackupFile,
} from './backup.service';

export type ExportResult = 'saved' | 'shared' | 'cancelled';

const isCancel = (e: unknown) => e instanceof Error && /cancel|annul|dismiss/i.test(e.message);

/**
 * Exporte une sauvegarde JSON (en clair, non chiffrée).
 * - 'save'  : l'utilisateur choisit le dossier d'enregistrement (sélecteur système).
 * - 'share' : feuille de partage (Drive, WhatsApp, e-mail…).
 */
export async function exportBackup(db: Db, mode: 'save' | 'share'): Promise<ExportResult> {
  const text = serializeBackup(await createBackup(db));
  const name = backupFileName();

  if (mode === 'save') {
    let dir: Directory;
    try {
      dir = await Directory.pickDirectoryAsync();
    } catch (e) {
      if (isCancel(e)) return 'cancelled';
      throw e;
    }
    const file = dir.createFile(name, 'application/json');
    await file.write(text);
    await markBackupExported(db);
    return 'saved';
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new BackupError("Le partage n'est pas disponible sur cet appareil. Utilisez « Enregistrer dans un dossier ».");
  }
  const cacheFile = new File(Paths.cache, name);
  cacheFile.create({ overwrite: true });
  await cacheFile.write(text);
  await Sharing.shareAsync(cacheFile.uri, { mimeType: 'application/json', dialogTitle: 'Sauvegarde MobiBudget', UTI: 'public.json' });
  await markBackupExported(db);
  return 'shared';
}

/** Fait choisir un fichier puis l'analyse et le valide SANS rien modifier. null = annulé. */
export async function pickAndValidateBackup(): Promise<BackupFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets || res.assets.length === 0) return null;
  const asset = res.assets[0];
  if (typeof asset.size === 'number' && asset.size > BACKUP_MAX_BYTES) {
    throw new BackupError('Le fichier est trop volumineux pour être une sauvegarde MobiBudget.');
  }
  const text = await new File(asset.uri).text();
  return parseBackup(text);
}
