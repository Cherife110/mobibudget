import type { Db } from '../db/types';

export const SETTING_KEYS = {
  referenceCurrency: 'reference_currency',
  onboardingCompleted: 'onboarding_completed',
  lastBackupAt: 'last_backup_at',
  privacyPolicyVersion: 'privacy_policy_version',
  privacyAcceptedAt: 'privacy_accepted_at',
  analyticsConsent: 'analytics_consent',
} as const;

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const row = await db.first<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}

export async function getAllSettings(db: Db): Promise<Record<string, string>> {
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}
