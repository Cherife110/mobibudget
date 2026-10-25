# MobiBudget

Application Android personnelle de gestion financière — **100 % hors connexion**, en français, en FCFA.
React Native · Expo SDK 58 · Expo Router · TypeScript strict · SQLite (`expo-sqlite`).

Aucun compte en ligne, aucun serveur, aucune synchronisation : les données restent sur le téléphone.
L'application ne demande **aucune permission Android** (y compris `INTERNET`, volontairement retirée du manifeste).

## Lancer le projet

```bash
npm install
npm run typecheck      # TypeScript strict
npm test               # 76 tests sur SQLite réel (règles métier)
npm start              # serveur de développement (Expo Go sur le téléphone, même Wi‑Fi)
npm run web            # version navigateur, pour tester sur le PC (voir ci-dessous)
```

> Sur ton téléphone, `npm start` + l'app **Expo Go** permettent d'essayer l'application avant de produire l'APK.
> (Expo Go reste en mode développement : l'APK est la version définitive.)

## Tester dans le navigateur (PC)

```bash
npm run web      # ouvre http://localhost:8081
```
Pratique pour développer et vérifier l'interface sans émulateur. Les données sont stockées **dans le navigateur**
(effacer les données du site les supprime) et ne sont pas liées à celles du téléphone : pour les passer de l'un à l'autre,
utilise l'export / la restauration. Sur le web, l'export est un téléchargement et les confirmations utilisent les boîtes du navigateur.
Le web sert à tester : l'application visée reste l'APK Android. `metro.config.js` est nécessaire pour le moteur SQLite web (WebAssembly).

## Produire l'APK installable

Il faut un compte Expo gratuit (https://expo.dev) — la compilation se fait dans le cloud, rien à installer d'Android.

```bash
npx eas-cli login                  # une seule fois
npx eas-cli init                   # une seule fois : crée le projectId dans app.json
npm run build:apk                  # = eas build --platform android --profile production
```

`eas.json` configure le profil `production` avec `"buildType": "apk"` (et non un AAB). À la fin, EAS affiche un lien
de téléchargement du fichier `.apk` (aussi disponible sur expo.dev › ton projet › Builds).

### Installer l'APK sur le téléphone
1. Ouvre le lien de téléchargement depuis le téléphone (ou copie le `.apk` via USB / Drive).
2. Android demande d'autoriser « Installer des applications inconnues » pour le navigateur ou le gestionnaire de fichiers : accepte.
3. Ouvre le fichier `.apk` puis « Installer ».

### Compilation locale (alternative, sans compte Expo)
Nécessite JDK 17+ et l'Android SDK (Android Studio) :
```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```
Ce build local est signé avec la clé de debug du modèle Expo : installable, mais **à ne pas publier sur le Play Store**.

> Identifiant de package : `com.cherife.mobibudget` (`app.json › expo.android.package`).
> Change-le **avant** le premier build si besoin : il ne pourra plus changer ensuite sans créer une autre application.
> Garde toujours le même identifiant et la même clé de signature (EAS la conserve) pour pouvoir mettre l'application à jour sans perdre les données.

## Règles financières (centralisées dans `src/services`)

| Règle | Implémentation |
|---|---|
| Solde courant = initial + entrées − dépenses + transferts reçus − transferts envoyés | calculé en SQL à chaque lecture (`balance.service.ts`), **jamais stocké** |
| Solde global | somme des soldes des comptes **actifs** (soldes négatifs inclus) |
| Montants | entiers de FCFA, validés (> 0, ≤ 10¹²) ; aucun flottant dans les calculs monétaires |
| Transferts | atomiques (transaction SQLite), comptes distincts et actifs, **jamais** comptés en revenus/dépenses/budgets |
| Dates | `AAAA-MM-JJ` en heure locale ; date passée autorisée (dépense oubliée), future refusée, antérieure à la date de référence du compte refusée |
| Budgets | plafond par catégorie de dépense et par mois ; « dépensé » toujours calculé ; alerte à 80 %, puis à 100 % (atteint/dépassé) ; jamais bloquant |
| Comptes archivés | consultables, plus d'opérations, hors solde global |
| Catégories | revenu ≠ dépense (vérifié) ; renommables ; archivables/réactivables sans toucher à l'historique ; suppression **seulement si aucune opération ne l'utilise** ; réaffectation des opérations vers une catégorie du même type (budgets reportés, ceux de la cible prévalent) |
| Évolution du solde | solde réellement reconstitué à chaque date (pas la variation du jour) |

**Remboursements** : un remboursement reçu s'enregistre comme une *entrée* de la catégorie « Remboursement reçu ».
La dépense initiale reste une dépense ; ne pas la déduire pour ne pas compter le remboursement deux fois.

**Statistiques** : les entrées/dépenses incluent toutes les opérations (comptes archivés compris) ; le graphique d'évolution
et le solde global portent sur les comptes actifs, pour que le dernier point du graphique égale le solde affiché.

## Sauvegarde / restauration

- Export JSON versionné (`formatVersion: 1`) : comptes, catégories, opérations, budgets, paramètres.
  « Enregistrer dans un dossier » (sélecteur système) ou « Partager ».
- **Le fichier n'est pas chiffré** : il contient toutes tes données financières en clair. Range-le en lieu sûr.
- Restauration : le fichier est d'abord **validé** (version, types, montants entiers, références, doublons…) sans rien modifier,
  un avertissement propose de sauvegarder avant de remplacer, puis le remplacement est **atomique** (tout ou rien).
- Un fichier importé n'est jamais exécuté : il est seulement lu comme du JSON et copié champ par champ après contrôle.

## Architecture

```
app/                      écrans (Expo Router) — (tabs): Accueil, Historique, Statistiques, Budgets, Paramètres
  accounts/ transactions/ add-transaction.tsx categories.tsx onboarding.tsx
src/
  db/            types.ts (Db atomique + verrou), schema.ts, migrations.ts (versionnées), database.ts (expo-sqlite)
  repositories/  accès SQL paramétré (comptes, catégories, transactions, budgets, paramètres)
  services/      règles métier testables (balance, transaction, budget, statistics, backup, account, category, onboarding)
  components/ hooks/ context/ utils/ constants/ types/
__tests__/       tests Jest sur de vrais SQLite (node:sqlite), sans mock
```

Les services ne dépendent ni de React ni d'Expo : ils sont testés tels quels avec un vrai moteur SQLite.
Clés étrangères activées (`PRAGMA foreign_keys = ON`), index sur dates / comptes / catégories, migrations par `PRAGMA user_version`.

## Limitations connues

- Non testée sur un téléphone ou un émulateur Android (voir le compte rendu de vérification) : seul le code métier est couvert par des tests automatisés ; l'interface a été vérifiée par typage strict et compilation du bundle.
- Sauvegarde non chiffrée.
- Pas de saisie récurrente, de pièces jointes, de multi-devises, de mode sombre (mode clair forcé).
- Mono-appareil : pas de synchronisation (changer de téléphone = export puis restauration).
- Outils de développement : TypeScript 6 et Jest 30 (versions attendues par Expo SDK 58). Ne lance pas `npm audit fix --force` : il ferait reculer Expo de plusieurs années.
- Les alertes `npm audit` concernent `@expo/cli` (outil de développement, non embarqué dans l'APK).
