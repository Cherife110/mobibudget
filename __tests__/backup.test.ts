import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup, clock, count, type Fixture } from './helpers/fixtures';
import { openTestDb } from './helpers/testDb';
import { createTransaction } from '../src/services/transaction.service';
import { setBudget } from '../src/services/budget.service';
import { archiveAccount, createAccount } from '../src/services/account.service';
import { updateCategory, seedDefaultCategories, listCategories } from '../src/services/category.service';
import { getAccountsWithBalances, getGlobalBalance } from '../src/services/balance.service';
import { getBudgetStatuses } from '../src/services/budget.service';
import {
  createBackup, serializeBackup, parseBackup, restoreBackup, validateBackup, backupFileName, summarizeBackup,
  getBackupInfo, markBackupExported, BackupError, BACKUP_FORMAT_VERSION, type BackupFile,
} from '../src/services/backup.service';
import { migrate, getSchemaVersion, LATEST_SCHEMA_VERSION } from '../src/db/migrations';
import { loadAppSettings } from '../src/services/onboarding.service';

async function populate(f: Fixture) {
  await createTransaction(f.db, { type: 'income', amount: 30_000, accountId: f.cash.id, categoryId: f.cat('Salaire'), date: '2026-10-05', description: 'Salaire' }, clock);
  await createTransaction(f.db, { type: 'expense', amount: 12_500, accountId: f.momo.id, categoryId: f.cat('Nourriture'), date: '2026-10-10' }, clock);
  await createTransaction(f.db, { type: 'transfer', amount: 10_000, accountId: f.bank.id, toAccountId: f.cash.id, date: '2026-10-12', description: 'Retrait' }, clock);
  await setBudget(f.db, { categoryId: f.cat('Nourriture'), month: '2026-10', amount: 20_000 }, clock);
  await updateCategory(f.db, f.cat('Loisirs'), { active: false }, clock);
  await archiveAccount(f.db, f.momo.id, clock);
}

/** Copie profonde d'une sauvegarde valide, modifiable pour fabriquer des fichiers corrompus. */
async function validFile(f: Fixture): Promise<any> {
  return JSON.parse(serializeBackup(await createBackup(f.db, clock)));
}

describe('sauvegarde et restauration', () => {
  let f: Fixture;
  beforeEach(async () => { f = await setup(); await populate(f); });
  afterEach(() => f.close());

  test('export JSON versionné puis restauration dans une base vide : données et soldes identiques', async () => {
    const file = await createBackup(f.db, clock);
    expect(file).toMatchObject({ app: 'MobiBudget', formatVersion: BACKUP_FORMAT_VERSION });
    expect(file.data.transactions).toHaveLength(3);
    const text = serializeBackup(file);
    expect(JSON.parse(text).formatVersion).toBe(1);

    const target = await openTestDb();
    const summary = await restoreBackup(target.db, parseBackup(text));
    expect(summary).toEqual({ accounts: 3, categories: 14, transactions: 3, budgets: 1 });

    const again = await createBackup(target.db, clock);
    expect(again.data).toEqual(file.data);                                                   // identité complète, ids inclus
    expect(await getGlobalBalance(target.db)).toBe(await getGlobalBalance(f.db));
    expect((await getAccountsWithBalances(target.db)).map((a) => [a.name, a.balance, a.archived]))
      .toEqual((await getAccountsWithBalances(f.db)).map((a) => [a.name, a.balance, a.archived]));
    expect((await getBudgetStatuses(target.db, '2026-10'))[0]).toMatchObject({ spent: 12_500, amount: 20_000 });
    expect((await loadAppSettings(target.db)).onboardingCompleted).toBe(true);                // l'app s'ouvre directement
    // La base restaurée reste pleinement utilisable (les ids continuent après le max)
    const t = await createTransaction(target.db, { type: 'income', amount: 1, accountId: f.cash.id, categoryId: f.cat('Vente'), date: '2026-10-20' }, clock);
    expect(t.id).toBe(4);
    target.close();
  });

  test('la restauration REMPLACE les données existantes', async () => {
    const file = await createBackup(f.db, clock);
    const other = await openTestDb();
    await other.db.run("INSERT INTO accounts (name, type, initial_balance, reference_date, archived, created_at, updated_at) VALUES ('Ancien', 'cash', 999, '2026-01-01', 0, 'x', 'x')");
    await restoreBackup(other.db, parseBackup(serializeBackup(file)));
    expect((await getAccountsWithBalances(other.db)).map((a) => a.name)).toEqual(['Espèces', 'Banque', 'Mobile Money']);
    other.close();
  });

  test('restauration atomique : en cas d\'erreur en cours de route, les données précédentes restent intactes', async () => {
    const before = await createBackup(f.db, clock);
    const balanceBefore = await getGlobalBalance(f.db);
    const poisoned: BackupFile = JSON.parse(serializeBackup(before));
    // Passe la validation structurelle d'un type, mais viole une clé étrangère à l'insertion des opérations
    poisoned.data.transactions[1].accountId = 777;
    await expect(restoreBackup(f.db, poisoned)).rejects.toThrow();
    const after = await createBackup(f.db, clock);
    expect(after.data).toEqual(before.data);
    expect(await count(f.db, 'transactions')).toBe(3);
    expect(await getGlobalBalance(f.db)).toBe(balanceBefore);
  });

  test('fichiers invalides rejetés avec un message clair', async () => {
    const mutate = async (fn: (j: any) => void) => { const j = await validFile(f); fn(j); return () => validateBackup(j); };
    const cases: Array<[string, (j: any) => void, RegExp]> = [
      ['mauvaise application', (j) => { j.app = 'Autre'; }, /pas une sauvegarde MobiBudget/],
      ['version absente', (j) => { delete j.formatVersion; }, /version du format/],
      ['version future', (j) => { j.formatVersion = 99; }, /version plus récente/],
      ['data absent', (j) => { delete j.data; }, /data/],
      ['liste manquante', (j) => { delete j.data.accounts; }, /liste attendue/],
      ['montant négatif', (j) => { j.data.transactions[0].amount = -5; }, /amount/],
      ['montant décimal', (j) => { j.data.transactions[0].amount = 12.5; }, /entier attendu/],
      ['montant en texte', (j) => { j.data.transactions[0].amount = '1000'; }, /entier attendu/],
      ['montant nul', (j) => { j.data.transactions[0].amount = 0; }, /≥ 1/],
      ['solde initial décimal', (j) => { j.data.accounts[0].initialBalance = 1.5; }, /entier attendu/],
      ['compte inexistant', (j) => { j.data.transactions[0].accountId = 404; }, /n'existe pas/],
      ['catégorie inexistante', (j) => { j.data.transactions[0].categoryId = 404; }, /n'existe pas/],
      ['catégorie du mauvais type', (j) => { j.data.transactions[1].categoryId = j.data.transactions[0].categoryId; }, /ne correspond pas/],
      ['transfert vers soi-même', (j) => { j.data.transactions[2].toAccountId = j.data.transactions[2].accountId; }, /même compte/],
      ['transfert sans destinataire', (j) => { delete j.data.transactions[2].toAccountId; }, /toAccountId/],
      ['date invalide', (j) => { j.data.transactions[0].date = '2026-02-30'; }, /date invalide/],
      ['type inconnu', (j) => { j.data.transactions[0].type = 'cadeau'; }, /valeur invalide/],
      ['type de compte inconnu', (j) => { j.data.accounts[0].type = 'crypto'; }, /valeur invalide/],
      ['identifiant en double', (j) => { j.data.accounts[1].id = j.data.accounts[0].id; }, /en double/],
      ['budget sur catégorie de revenu', (j) => { j.data.budgets[0].categoryId = j.data.transactions[0].categoryId; }, /catégorie de dépense/],
      ['mois de budget invalide', (j) => { j.data.budgets[0].month = '2026-13'; }, /mois invalide/],
      ['budget en double', (j) => { j.data.budgets.push({ ...j.data.budgets[0], id: 99 }); }, /même catégorie/],
      ['nom de compte vide', (j) => { j.data.accounts[0].name = '  '; }, /vide/],
      ['archivé non booléen', (j) => { j.data.accounts[0].archived = 'oui'; }, /booléen/],
    ];
    for (const [label, fn, re] of cases) {
      const run = await mutate(fn);
      try { run(); throw new Error(`« ${label} » aurait dû être rejeté`); }
      catch (e) { expect(e).toBeInstanceOf(BackupError); expect((e as Error).message).toMatch(re); }
    }
  });

  test('textes qui ne sont pas des sauvegardes : vide, tronqué, tableau, scalaire, code', () => {
    for (const bad of ['', '   ', '{"app":"MobiBudget"', 'null', '42', '[]', 'function(){}', 'require("fs")', '<html></html>']) {
      expect(() => parseBackup(bad)).toThrow(BackupError);
    }
  });

  test('le contenu du fichier est traité comme une donnée : jamais exécuté, aucune pollution de prototype', async () => {
    const j = await validFile(f);
    j.data.accounts[0].name = "globalThis.hacked = true; process.exit(1)";
    const text = serializeBackup(j).replace('"data": {', '"__proto__": {"polluted": true}, "constructor": {"x": 1}, "data": {');
    const parsed = parseBackup(text);
    expect(parsed.data.accounts[0].name).toContain('hacked');                                // simple texte
    expect((globalThis as any).hacked).toBeUndefined();
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.keys(parsed)).not.toContain('constructor');
  });

  test('informations de sauvegarde : compteurs, dernier export, nom de fichier', async () => {
    expect((await getBackupInfo(f.db)).lastBackupAt).toBeNull();
    await markBackupExported(f.db, clock);
    expect(await getBackupInfo(f.db)).toMatchObject({ accounts: 3, categories: 14, transactions: 3, budgets: 1, lastBackupAt: clock.now.toISOString() });
    expect(summarizeBackup(await createBackup(f.db, clock)).transactions).toBe(3);
    expect(backupFileName(new Date(2026, 9, 24, 9, 5))).toBe('mobibudget-sauvegarde-2026-10-24-0905.json');
  });
});

describe('persistance après redémarrage', () => {
  test('les données survivent à la fermeture puis à la réouverture de la base (fichier SQLite)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mobibudget-'));
    const path = join(dir, 'mobibudget.db');
    try {
      const first = await openTestDb(path);
      await seedDefaultCategories(first.db, {}, clock);
      const acc = await createAccount(first.db, { name: 'Espèces', type: 'cash', initialBalance: 10_000, referenceDate: '2026-10-01' }, clock);
      const cat = (await listCategories(first.db, { kind: 'expense' }))[0];
      await createTransaction(first.db, { type: 'expense', amount: 2_500, accountId: acc.id, categoryId: cat.id, date: '2026-10-10', description: 'Persistant' }, clock);
      first.close();                                                                          // « fermeture de l'application »

      const second = await openTestDb(path);                                                  // « redémarrage » (migrate rejoué)
      expect(await getSchemaVersion(second.db)).toBe(LATEST_SCHEMA_VERSION);
      expect(await getGlobalBalance(second.db)).toBe(7_500);
      expect((await getAccountsWithBalances(second.db))[0]).toMatchObject({ name: 'Espèces', balance: 7_500 });
      expect(await count(second.db, 'transactions')).toBe(1);
      expect((await listCategories(second.db)).length).toBe(14);
      await migrate(second.db);                                                               // idempotent : aucune donnée perdue
      expect(await count(second.db, 'transactions')).toBe(1);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('une base créée par une version plus récente est refusée plutôt qu\'abîmée', async () => {
    const t = await openTestDb();
    await t.db.exec('PRAGMA user_version = 99');
    await expect(migrate(t.db)).rejects.toThrow(/plus récente/);
    t.close();
  });
});
