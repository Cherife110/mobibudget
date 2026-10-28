import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { openDatabase } from '../db/database';
import { isPeriodicCheckDue, loadCloudSettings, runCloudBackup } from '../services/cloudBackup.service';
import { buildCloudDeps } from './platform';

/**
 * Sauvegarde en arrière-plan, environ toutes les 12 h. Android choisit le moment exact
 * (batterie, réseau, mode économie) : ce n'est qu'un filet de sécurité, la sauvegarde
 * principale a lieu pendant l'utilisation de l'application.
 */
export const CLOUD_TASK = 'mobibudget-cloud-backup';

if (Platform.OS !== 'web' && !TaskManager.isTaskDefined(CLOUD_TASK)) {
  TaskManager.defineTask(CLOUD_TASK, async () => {
    try {
      const db = await openDatabase();
      const deps = buildCloudDeps(db);
      await deps.auth.ready?.();
      if (!isPeriodicCheckDue(await loadCloudSettings(db), new Date())) return BackgroundTask.BackgroundTaskResult.Success;
      const r = await runCloudBackup(deps, { trigger: 'auto' });
      return r.status === 'failed' ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function enableBackgroundBackup(): Promise<void> {
  if (Platform.OS === 'web') return;
  if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
  if (!(await TaskManager.isTaskRegisteredAsync(CLOUD_TASK))) {
    await BackgroundTask.registerTaskAsync(CLOUD_TASK, { minimumInterval: 12 * 60 });
  }
}

export async function disableBackgroundBackup(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (await TaskManager.isTaskRegisteredAsync(CLOUD_TASK)) await BackgroundTask.unregisterTaskAsync(CLOUD_TASK);
}
