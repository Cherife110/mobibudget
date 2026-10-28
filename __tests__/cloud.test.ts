import { setup, clock, count, type Fixture } from './helpers/fixtures';
import { openTestDb, type TestDb } from './helpers/testDb';
import { FakeAuth, FakeCloudStore, MemorySecrets, network, nodeRandom } from './helpers/fakeCloud';
import { utf8Decode, utf8Encode, toBase64, fromBase64 } from '../src/cloud/encoding';
import { createKey, decryptEnvelope, encryptText, readEnvelope, sha256Hex, deriveKey } from '../src/cloud/crypto';
import {
  runCloudBackup, listCloudBackups, restoreFromCloud, downloadCloudBackup, enableEncryption, disableEncryption, signOutCloud, deleteCloudAccount,
  loadCloudSettings, setCloudOption, backoffMs, describeCloudError, isPeriodicCheckDue, pruneBackups, PasswordRequiredError,
  CHUNK_SIZE, KEEP_BACKUPS, type CloudDeps,
} from '../src/services/cloudBackup.service';
import { createBackup, BackupError } from '../src/services/backup.service';
import { createTransaction } from '../src/services/transaction.service';
import { getGlobalBalance } from '../src/services/balance.service';
import { loadAppSettings, completeOnboarding } from '../src/services/onboarding.service';

describe('encodages et chiffrement', () => {
  test('UTF-8 et Base64 : aller-retour exact (accents, emoji, binaire)', () => {
    for (const s of ['', 'abc', 'Épargne « mars » – 25 000 FCFA', '😀 € ¥', 'x'.repeat(1000)]) expect(utf8Decode(utf8Encode(s))).toBe(s);
    expect(utf8Encode('é')).toEqual(Uint8Array.from([0xc3, 0xa9]));
    for (let n = 0; n < 40; n++) {
      const bytes = nodeRandom(n);
      expect(fromBase64(toBase64(bytes))).toEqual(bytes);
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));   // conforme au Base64 standard
    }
    expect(() => fromBase64('@@@@')).toThrow();
  });

  test('AES-256-GCM : bon mot de passe → texte d\'origine ; mauvais mot de passe ou fichier modifié → refus', () => {
    const key = createKey('mon mot de passe', nodeRandom);
    const text = JSON.stringify({ app: 'MobiBudget', comptes: ['Espèces', 'Épargne'] });
    const sealed = encryptText(text, key, nodeRandom);
    expect(sealed).not.toContain('Espèces');
    const env = readEnvelope(sealed)!;
    expect(env).toMatchObject({ kind: 'encrypted-backup', kdf: { name: 'PBKDF2-SHA256', iterations: 310_000 }, cipher: { name: 'AES-256-GCM' } });
    expect(decryptEnvelope(env, { password: 'mon mot de passe' })).toBe(text);
    expect(decryptEnvelope(env, { key })).toBe(text);
    expect(() => decryptEnvelope(env, { password: 'mauvais mot de passe' })).toThrow(/Mot de passe incorrect/);
    const tampered = { ...env, data: env.data.slice(0, -6) + (env.data.slice(-6, -5) === 'A' ? 'B' : 'A') + env.data.slice(-5) };
    expect(() => decryptEnvelope(tampered, { key })).toThrow(BackupError);
    expect(() => decryptEnvelope(env, { key: createKey('autre clé 123', nodeRandom) })).toThrow(/autre mot de passe/);
    expect(readEnvelope('{"app":"MobiBudget","formatVersion":2}')).toBeNull();      // sauvegarde en clair
    expect(readEnvelope('pas du json')).toBeNull();
    expect(() => deriveKey('court', nodeRandom(16))).toThrow(/au moins 8/);
    // deux chiffrements du même texte diffèrent (nonce aléatoire)
    expect(encryptText(text, key, nodeRandom)).not.toBe(sealed);
  });
});

describe('sauvegarde en ligne', () => {
  let f: Fixture;
  let store: FakeCloudStore;
  let auth: FakeAuth;
  let secrets: MemorySecrets;
  let net: ReturnType<typeof network>;
  let now: Date;
  let snapshots: { name: string; text: string }[];
  const deps = (over: Partial<CloudDeps> = {}): CloudDeps => ({
    db: f.db, store, auth, secrets, network: net.fn, random: nodeRandom, now: () => now,
    saveSafetySnapshot: async (name, text) => { snapshots.push({ name, text }); }, ...over,
  });
  const later = (minutes: number) => { now = new Date(now.getTime() + minutes * 60_000); };

  beforeEach(async () => {
    f = await setup();
    store = new FakeCloudStore();
    auth = new FakeAuth();
    secrets = new MemorySecrets();
    net = network();
    now = new Date('2026-10-24T10:00:00Z');
    snapshots = [];
    await createTransaction(f.db, { type: 'expense', amount: 12_500, accountId: f.cash.id, categoryId: f.cat('Nourriture'), date: '2026-10-10', description: 'Marché' }, clock);
  });
  afterEach(() => f.close());

  test('sans configuration, sans connexion au compte ou sans internet : rien n\'est envoyé', async () => {
    auth.configured = false;
    expect(await runCloudBackup(deps(), { trigger: 'manual' })).toEqual({ status: 'skipped', reason: 'not-configured' });
    auth.configured = true;
    expect(await runCloudBackup(deps(), { trigger: 'manual' })).toEqual({ status: 'skipped', reason: 'signed-out' });
    await auth.signIn();
    net.state.online = false;
    expect(await runCloudBackup(deps(), { trigger: 'auto' })).toEqual({ status: 'skipped', reason: 'offline' });
    expect(await runCloudBackup(deps(), { trigger: 'manual' })).toEqual({ status: 'skipped', reason: 'offline' });
    expect(store.count('utilisateur-1')).toBe(0);
  });

  test('première sauvegarde : copie complète, données locales inchangées, état enregistré', async () => {
    await auth.signIn();
    const before = await createBackup(f.db, clock);
    const r = await runCloudBackup(deps(), { trigger: 'auto' });
    expect(r.status).toBe('uploaded');
    const list = await listCloudBackups(deps());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'complete', encrypted: false, chunkCount: 1, summary: { accounts: 3, transactions: 1, categories: 14 } });
    expect((await createBackup(f.db, clock)).data).toEqual(before.data);
    const s = await loadCloudSettings(f.db);
    expect(s).toMatchObject({ lastSuccessAt: now.toISOString(), failures: 0, lastError: null, autoEnabled: true, wifiOnly: false, encrypted: false });
  });

  test('données inchangées : pas de nouvel envoi ; après une modification : nouvel envoi ; « force » envoie toujours', async () => {
    await auth.signIn();
    await runCloudBackup(deps(), { trigger: 'auto' });
    later(5);
    expect(await runCloudBackup(deps(), { trigger: 'auto' })).toEqual({ status: 'unchanged' });
    await createTransaction(f.db, { type: 'income', amount: 5_000, accountId: f.cash.id, categoryId: f.cat('Vente'), date: '2026-10-11' }, clock);
    later(5);
    expect((await runCloudBackup(deps(), { trigger: 'auto' })).status).toBe('uploaded');
    later(5);
    expect((await runCloudBackup(deps(), { trigger: 'manual', force: true })).status).toBe('uploaded');
    expect(await listCloudBackups(deps())).toHaveLength(3);
  });

  test('Wi-Fi seulement : l\'automatique attend le Wi-Fi, le bouton manuel envoie quand même ; automatique désactivable', async () => {
    await auth.signIn();
    await setCloudOption(f.db, 'wifiOnly', true);
    net.state.wifi = false;
    expect(await runCloudBackup(deps(), { trigger: 'auto' })).toEqual({ status: 'skipped', reason: 'wifi-only' });
    expect((await runCloudBackup(deps(), { trigger: 'manual' })).status).toBe('uploaded');
    await setCloudOption(f.db, 'autoEnabled', false);
    net.state.wifi = true;
    expect(await runCloudBackup(deps(), { trigger: 'auto' })).toEqual({ status: 'skipped', reason: 'auto-disabled' });
  });

  test('panne réseau au milieu de l\'envoi : rien de local n\'est perdu, la sauvegarde partielle est invisible, reprise ensuite', async () => {
    await auth.signIn();
    // Assez de données pour 2 morceaux
    await f.db.transaction(async (tx) => {
      for (let i = 0; i < 900; i++) {
        await tx.run(
          "INSERT INTO transactions (type, amount, account_id, category_id, description, date, created_at, updated_at) VALUES ('expense', ?, ?, ?, ?, '2026-10-12', '2026-10-12T08:00:00.000Z', '2026-10-12T08:00:00.000Z')",
          [100 + i, f.cash.id, f.cat('Transport'), `Taxi n°${i} – trajet aller-retour au marché de Bè ${'·'.repeat(150)}`],
        );
      }
    });
    const before = await createBackup(f.db, clock);
    store.failNext('putChunk', { index: 1 });
    const r = await runCloudBackup(deps(), { trigger: 'auto' });
    expect(r).toMatchObject({ status: 'failed', error: expect.stringMatching(/Connexion au serveur/) });
    expect((await createBackup(f.db, clock)).data).toEqual(before.data);        // données locales intactes
    expect(await listCloudBackups(deps())).toEqual([]);                        // l'envoi partiel n'est pas proposé
    expect(store.count('utilisateur-1')).toBe(1);                              // …mais existe encore, en « uploading »
    expect(await loadCloudSettings(f.db)).toMatchObject({ failures: 1, lastError: expect.stringMatching(/Connexion/) });

    expect(await runCloudBackup(deps(), { trigger: 'auto' })).toEqual({ status: 'skipped', reason: 'backoff' });   // attente 1 min
    later(2);
    const ok = await runCloudBackup(deps(), { trigger: 'auto' });
    expect(ok.status).toBe('uploaded');
    if (ok.status === 'uploaded') expect(ok.meta.chunkCount).toBeGreaterThan(1);
    expect(await loadCloudSettings(f.db)).toMatchObject({ failures: 0, lastError: null });

    later(25 * 60);                                                          // > 24 h : l'envoi abandonné est nettoyé
    await pruneBackups(store, 'utilisateur-1', now);
    expect(store.count('utilisateur-1')).toBe(1);

    // le gros fichier se relit à l'identique, morceaux réassemblés et vérifiés
    const [meta] = await listCloudBackups(deps());
    const { file } = await downloadCloudBackup(deps(), meta);
    expect(file.data.transactions).toHaveLength(901);
    expect(file.data).toEqual((await createBackup(f.db, clock)).data);
  });

  test('attente progressive après des échecs successifs (1, 2, 4… min, max 60 min)', () => {
    expect([0, 1, 2, 3, 7, 20].map(backoffMs)).toEqual([0, 60_000, 120_000, 240_000, 3_600_000, 3_600_000]);
  });

  test('seules les 5 dernières sauvegardes sont conservées', async () => {
    await auth.signIn();
    for (let i = 0; i < 7; i++) {
      later(60);
      await runCloudBackup(deps(), { trigger: 'manual', force: true });
    }
    const list = await listCloudBackups(deps());
    expect(list).toHaveLength(KEEP_BACKUPS);
    expect(list[0].createdAt > list[4].createdAt).toBe(true);                   // la plus récente d'abord
    expect(list[0].createdAt).toBe(now.toISOString());
  });

  test('chaque utilisateur ne voit que ses propres sauvegardes', async () => {
    await auth.signIn();
    await runCloudBackup(deps(), { trigger: 'manual' });
    const other = new FakeAuth('utilisateur-2');
    await other.signIn();
    expect(await listCloudBackups(deps({ auth: other }))).toEqual([]);
  });

  test('jamais d\'envoi d\'une base vide ou non configurée (téléphone neuf) : les vraies sauvegardes restent les dernières', async () => {
    await auth.signIn();
    await runCloudBackup(deps(), { trigger: 'manual' });
    const fresh = await openTestDb();
    const d2 = deps({ db: fresh.db, secrets: new MemorySecrets() });
    expect(await runCloudBackup(d2, { trigger: 'auto' })).toEqual({ status: 'skipped', reason: 'empty' });
    expect(await runCloudBackup(d2, { trigger: 'manual', force: true })).toEqual({ status: 'skipped', reason: 'empty' });
    expect(await listCloudBackups(d2)).toHaveLength(1);
    await completeOnboarding(fresh.db, { account: { name: 'Espèces', type: 'cash', initialBalance: 0, referenceDate: '2026-10-20' } }, clock);
    expect((await runCloudBackup(d2, { trigger: 'manual' })).status).toBe('uploaded');          // une fois configuré : normal
    fresh.close();
  });

  test('nouveau téléphone : connexion au même compte → restauration complète, sans renvoi immédiat', async () => {
    await auth.signIn();
    await runCloudBackup(deps(), { trigger: 'manual' });
    const phone2: TestDb = await openTestDb();                                  // base vide
    const d2 = deps({ db: phone2.db, secrets: new MemorySecrets() });
    const [meta] = await listCloudBackups(d2);
    const summary = await restoreFromCloud(d2, meta);
    expect(summary).toMatchObject({ accounts: 3, transactions: 1 });
    expect((await getGlobalBalance(phone2.db, '2026-10-24')).total).toBe((await getGlobalBalance(f.db, '2026-10-24')).total);
    expect((await loadAppSettings(phone2.db)).onboardingCompleted).toBe(true);
    expect(snapshots).toEqual([]);                                             // téléphone vide : rien à protéger
    expect(await runCloudBackup(d2, { trigger: 'auto' })).toEqual({ status: 'unchanged' });
    phone2.close();
  });

  test('restaurer par-dessus des données existantes crée d\'abord une copie de sécurité locale', async () => {
    await auth.signIn();
    await runCloudBackup(deps(), { trigger: 'manual' });
    await createTransaction(f.db, { type: 'expense', amount: 999, accountId: f.cash.id, categoryId: f.cat('Loisirs'), date: '2026-10-20' }, clock);
    const [meta] = await listCloudBackups(deps());
    await restoreFromCloud(deps(), meta);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].name).toMatch(/^mobibudget-avant-restauration-.*\.json$/);
    expect(JSON.parse(snapshots[0].text).data.transactions).toHaveLength(2);    // l'état d'avant, avec l'opération de 999
    expect(await count(f.db, 'transactions')).toBe(1);                         // état restauré
  });

  test('sans moyen de créer la copie de sécurité, la restauration est annulée et rien ne change', async () => {
    await auth.signIn();
    await runCloudBackup(deps(), { trigger: 'manual' });
    await createTransaction(f.db, { type: 'expense', amount: 999, accountId: f.cash.id, categoryId: f.cat('Loisirs'), date: '2026-10-20' }, clock);
    const [meta] = await listCloudBackups(deps());
    await expect(restoreFromCloud(deps({ saveSafetySnapshot: undefined }), meta)).rejects.toThrow(/copie de sécurité/);
    expect(await count(f.db, 'transactions')).toBe(2);
  });

  test('sauvegarde en ligne endommagée ou incomplète : refusée, données locales intactes', async () => {
    await auth.signIn();
    await runCloudBackup(deps(), { trigger: 'manual' });
    const [meta] = await listCloudBackups(deps());
    store.tamper('utilisateur-1', meta.id, 0, store.rawChunks('utilisateur-1', meta.id).replace('Marché', 'Marchx'));
    await expect(restoreFromCloud(deps(), meta)).rejects.toThrow(/endommagée/);
    store.tamper('utilisateur-1', meta.id, 0, null);
    await expect(restoreFromCloud(deps(), meta)).rejects.toThrow(/incomplète/);
    expect(await count(f.db, 'transactions')).toBe(1);
  });

  test('chiffrement facultatif : contenu illisible en ligne ; mot de passe exigé sur un nouveau téléphone', async () => {
    await auth.signIn();
    await enableEncryption(deps(), 'phrase secrète 2026');
    expect(await loadCloudSettings(f.db)).toMatchObject({ encrypted: true });
    const r = await runCloudBackup(deps(), { trigger: 'manual' });
    expect(r.status).toBe('uploaded');
    const [meta] = await listCloudBackups(deps());
    expect(meta.encrypted).toBe(true);
    const raw = store.rawChunks('utilisateur-1', meta.id);
    expect(raw).not.toContain('Espèces');
    expect(raw).not.toContain('Marché');
    expect(sha256Hex(raw)).toBe(meta.checksum);

    const phone2 = await openTestDb();
    const d2 = deps({ db: phone2.db, secrets: new MemorySecrets() });
    await expect(restoreFromCloud(d2, meta)).rejects.toBeInstanceOf(PasswordRequiredError);
    await expect(restoreFromCloud(d2, meta, { password: 'mauvaise phrase' })).rejects.toThrow(/Mot de passe incorrect/);
    expect(await count(phone2.db, 'accounts')).toBe(0);
    await restoreFromCloud(d2, meta, { password: 'phrase secrète 2026' });
    expect(await count(phone2.db, 'transactions')).toBe(1);
    // le nouveau téléphone continue à chiffrer avec la même clé, sans redemander le mot de passe
    await createTransaction(phone2.db, { type: 'income', amount: 1_000, accountId: f.cash.id, categoryId: f.cat('Vente'), date: '2026-10-21' }, clock);
    later(10);
    const r2 = await runCloudBackup(d2, { trigger: 'auto' });
    expect(r2.status).toBe('uploaded');
    if (r2.status === 'uploaded') {
      expect(r2.meta.encrypted).toBe(true);
      const { file } = await downloadCloudBackup(d2, r2.meta);
      expect(file.data.transactions).toHaveLength(2);
    }
    phone2.close();
  });

  test('chiffrement activé mais clé absente du téléphone : échec explicite, rien d\'envoyé en clair', async () => {
    await auth.signIn();
    await enableEncryption(deps(), 'phrase secrète 2026');
    secrets.values.clear();
    const r = await runCloudBackup(deps(), { trigger: 'manual' });
    expect(r).toMatchObject({ status: 'failed', error: expect.stringMatching(/Mot de passe de sauvegarde introuvable/) });
    expect(store.count('utilisateur-1')).toBe(0);
    await disableEncryption(deps());
    expect((await runCloudBackup(deps(), { trigger: 'manual' })).status).toBe('uploaded');
  });

  test('déconnexion : données locales conservées, plus aucun envoi, clé oubliée', async () => {
    await auth.signIn();
    await enableEncryption(deps(), 'phrase secrète 2026');
    await runCloudBackup(deps(), { trigger: 'manual' });
    await signOutCloud(deps());
    expect(auth.currentUser()).toBeNull();
    expect(secrets.values.size).toBe(0);
    expect(await count(f.db, 'transactions')).toBe(1);
    expect(await runCloudBackup(deps(), { trigger: 'auto' })).toEqual({ status: 'skipped', reason: 'signed-out' });
    expect((await loadCloudSettings(f.db)).encrypted).toBe(false);
  });

  test('suppression du compte : toutes les sauvegardes (même inachevées) puis le compte ; données locales conservées', async () => {
    await auth.signIn();
    await enableEncryption(deps(), 'phrase secrète 2026');
    await runCloudBackup(deps(), { trigger: 'manual' });
    later(60);
    await createTransaction(f.db, { type: 'expense', amount: 999, accountId: f.cash.id, categoryId: f.cat('Loisirs'), date: '2026-10-20' }, clock);
    store.failNext('markComplete');
    await runCloudBackup(deps(), { trigger: 'manual' });                         // envoi resté « uploading »
    const other = new FakeAuth('utilisateur-2');
    await other.signIn();
    await runCloudBackup(deps({ auth: other }), { trigger: 'manual', force: true });
    expect(store.count('utilisateur-1')).toBe(2);

    expect(await deleteCloudAccount(deps())).toEqual({ deletedBackups: 2 });
    expect(store.count('utilisateur-1')).toBe(0);
    expect(store.count('utilisateur-2')).toBe(1);                              // les autres comptes ne sont pas touchés
    expect(auth.deletedAccounts).toEqual(['utilisateur-1']);
    expect(auth.currentUser()).toBeNull();
    expect(secrets.values.size).toBe(0);                                       // clé de chiffrement oubliée
    expect(await count(f.db, 'transactions')).toBe(2);                         // données locales intactes
    expect(await loadCloudSettings(f.db)).toMatchObject({ encrypted: false, lastSuccessAt: null, lastCheckAt: null, lastError: null, failures: 0 });
    expect(await runCloudBackup(deps(), { trigger: 'auto' })).toEqual({ status: 'skipped', reason: 'signed-out' });
  });

  test('suppression interrompue : rien de local n\'est perdu, relancer termine le travail', async () => {
    await expect(deleteCloudAccount(deps())).rejects.toThrow(/Connectez-vous/);
    await auth.signIn();
    for (let i = 0; i < 3; i++) {
      later(60);
      await runCloudBackup(deps(), { trigger: 'manual', force: true });
    }
    net.state.online = false;
    await expect(deleteCloudAccount(deps())).rejects.toThrow(/Pas de connexion internet/);
    net.state.online = true;

    store.failNext('deleteBackup');
    await expect(deleteCloudAccount(deps())).rejects.toThrow(/panne simulée/);
    expect(store.count('utilisateur-1')).toBe(3);                              // rien de supprimé
    expect(auth.currentUser()).not.toBeNull();                                 // compte intact, toujours connecté

    auth.failNextDelete('auth/network-request-failed');
    await expect(deleteCloudAccount(deps())).rejects.toMatchObject({ code: 'auth/network-request-failed' });
    expect(store.count('utilisateur-1')).toBe(0);                              // sauvegardes déjà effacées…
    expect(auth.currentUser()).not.toBeNull();                                 // …mais le compte existe encore

    expect(await deleteCloudAccount(deps())).toEqual({ deletedBackups: 0 });  // relancer termine le travail
    expect(auth.deletedAccounts).toEqual(['utilisateur-1']);
    expect(await count(f.db, 'transactions')).toBe(1);
  });

  test('messages d\'erreur compréhensibles et contrôle périodique toutes les 12 h', async () => {
    expect(describeCloudError({ code: 'unavailable' })).toMatch(/Connexion/);
    expect(describeCloudError({ code: 'permission-denied' })).toMatch(/Reconnectez-vous/);
    expect(describeCloudError({ code: 'resource-exhausted' })).toMatch(/Quota/);
    expect(describeCloudError(new Error('boom'))).toMatch(/données locales sont intactes/);
    const s = await loadCloudSettings(f.db);
    expect(isPeriodicCheckDue(s, now)).toBe(true);                               // jamais vérifié
    expect(isPeriodicCheckDue({ ...s, lastCheckAt: new Date(now.getTime() - 11 * 3600_000).toISOString() }, now)).toBe(false);
    expect(isPeriodicCheckDue({ ...s, lastCheckAt: new Date(now.getTime() - 12 * 3600_000).toISOString() }, now)).toBe(true);
  });

  test('la taille des morceaux respecte la limite d\'un document Firestore (1 Mio)', () => {
    expect(CHUNK_SIZE * 4).toBeLessThan(1_048_576);                            // même au pire 4 octets par caractère
  });
});
