import { setup, clock } from './helpers/fixtures';
import { openTestDb, type TestDb } from './helpers/testDb';
import { loadAppSettings } from '../src/services/onboarding.service';
import { acceptPrivacyPolicy, setAnalyticsConsent } from '../src/services/privacy.service';
import { createBackup, parseBackup, restoreBackup, serializeBackup } from '../src/services/backup.service';
import { SETTING_KEYS, getSetting, setSetting } from '../src/repositories/settings.repository';
import { PRIVACY_POLICY_VERSION } from '../src/constants/privacy';

describe('confidentialité', () => {
  let t: TestDb;
  beforeEach(async () => { t = await openTestDb(); });
  afterEach(() => t.close());

  test('première ouverture : politique non acceptée, aucune statistique', async () => {
    expect(await loadAppSettings(t.db)).toMatchObject({ privacyAccepted: false, analyticsConsent: false });
  });

  test('acceptation sans statistiques : version et date enregistrées', async () => {
    await acceptPrivacyPolicy(t.db, { analyticsConsent: false }, clock);
    expect(await loadAppSettings(t.db)).toMatchObject({ privacyAccepted: true, analyticsConsent: false });
    expect(await getSetting(t.db, SETTING_KEYS.privacyPolicyVersion)).toBe(PRIVACY_POLICY_VERSION);
    expect(await getSetting(t.db, SETTING_KEYS.privacyAcceptedAt)).toBe(clock.now.toISOString());
  });

  test('les statistiques sont facultatives et révocables à tout moment', async () => {
    await acceptPrivacyPolicy(t.db, { analyticsConsent: true }, clock);
    expect((await loadAppSettings(t.db)).analyticsConsent).toBe(true);
    await setAnalyticsConsent(t.db, false);
    expect(await loadAppSettings(t.db)).toMatchObject({ privacyAccepted: true, analyticsConsent: false });
    await setAnalyticsConsent(t.db, true);
    expect((await loadAppSettings(t.db)).analyticsConsent).toBe(true);
  });

  test("une nouvelle version de la politique redemande l'accord, statistiques comprises", async () => {
    await setSetting(t.db, SETTING_KEYS.privacyPolicyVersion, '0.9');
    await setSetting(t.db, SETTING_KEYS.analyticsConsent, '1');
    expect(await loadAppSettings(t.db)).toMatchObject({ privacyAccepted: false, analyticsConsent: false });
  });

  test("l'accord reste propre au téléphone : absent des sauvegardes, conservé par une restauration", async () => {
    const source = await setup();
    await acceptPrivacyPolicy(source.db, { analyticsConsent: true }, clock);
    const text = serializeBackup(await createBackup(source.db, clock));
    source.close();
    expect(text).not.toMatch(/privacy|analytics/);

    await acceptPrivacyPolicy(t.db, { analyticsConsent: false }, clock);
    await restoreBackup(t.db, parseBackup(text));
    expect(await loadAppSettings(t.db)).toMatchObject({ onboardingCompleted: true, privacyAccepted: true, analyticsConsent: false });
  });
});
