# MobiBudget

Application Android personnelle de gestion financière — fonctionne **entièrement hors connexion**, avec une **sauvegarde en ligne facultative** (compte Google). En français, FCFA et autres devises.
React Native · Expo SDK 58 · Expo Router · TypeScript strict · SQLite (`expo-sqlite`).

Les données vivent dans SQLite sur le téléphone. Deux envois sont possibles, chacun facultatif et choisi par l'utilisateur :
- une **copie** des données avec la sauvegarde en ligne (compte Google, Firebase) : voir « Sauvegarde en ligne » et `docs/FIREBASE.md` ;
- des **statistiques d'utilisation** sans aucune donnée financière (Firebase Analytics) : voir « Confidentialité et statistiques ».

Permissions Android : `INTERNET` (ces deux envois) ; stockage, vibreur, superposition et identifiant publicitaire sont retirés.

## Lancer le projet

```bash
npm install
npm run typecheck      # TypeScript strict
npm test               # 136 tests sur SQLite réel (règles métier, sauvegarde en ligne simulée)
npm start              # serveur de développement : version de développement (npm run build:dev), touche « s » pour Expo Go
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

## Confidentialité et statistiques

- **Accord obligatoire** : la configuration initiale comporte une étape « Vos données, vos choix », juste après la présentation et
  avant le choix Google / hors ligne ; les utilisateurs existants (et après une restauration) la voient au démarrage. L'accord est enregistré dans `settings` (`privacy_policy_version`,
  `privacy_accepted_at`, `analytics_consent`). Il est propre au téléphone : ni exporté dans les sauvegardes, ni remplacé par une restauration.
- **Modifier la politique** : texte dans `src/constants/privacy.ts` (affiché dans l'appli, lisible hors connexion), puis augmenter
  `PRIVACY_POLICY_VERSION` : chacun devra l'accepter à nouveau, et l'accord pour les statistiques est redemandé.
- **Statistiques facultatives** (case décochée par défaut, modifiable dans Paramètres › Confidentialité) : Google Analytics pour Firebase,
  via `src/lib/analytics.ts`. Firebase compte seul les installations, sessions et utilisateurs actifs ; seul événement personnalisé :
  `onboarding_complete`, sans paramètre. **Ne jamais envoyer de donnée financière** (montant, nom de compte ou de catégorie, description).
- `firebase.json` coupe la collecte tant que l'accord n'est pas donné et désactive l'identifiant publicitaire, l'Android ID et les usages
  publicitaires ; `app.json` bloque les permissions publicitaires (`AD_ID`, `ACCESS_ADSERVICES_*`).
- **Navigateur** : pas de Firebase, les statistiques sont ignorées sans erreur (`analytics.web.ts`). Pour les tester sur le téléphone,
  il faut une version compilée avec EAS (`npm run build:dev`).
- **Mise en place** (projet Firebase, `google-services.json` à la racine, durée de conservation, test dans DebugView) : `docs/FIREBASE.md`.
- Avant le Play Store : publier le texte de la politique à une adresse publique (demandée aussi par le formulaire « Sécurité des données »).

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

## Devises et taux de change

- Chaque compte a sa **devise** (code ISO 4217 ; catalogue d'une soixantaine de devises). Les anciens comptes passent en XOF sans que leurs montants changent.
- Les montants sont des **entiers de la plus petite unité** de la devise (XOF : franc ; EUR/USD : centime ; KWD : millième). Aucun flottant.
- La devise d'un compte ne peut plus changer dès qu'il a des opérations ; une opération ne peut pas être déplacée vers un compte d'une autre devise.
- **Taux saisis à la main** (Paramètres › Taux de change) : « 1 EUR = 655,957 XOF » avec une date d'effet. Stockés en entiers (8 décimales), conversion en BigInt, arrondi au plus proche (moitié vers l'extérieur). Un taux peut servir dans les deux sens.
- Les totaux, budgets et statistiques sont en **devise de référence (XOF)**. Chaque opération est convertie **individuellement au taux en vigueur à sa date** (dernier taux dont la date d'effet est ≤ la date de l'opération) ; les montants d'origine ne sont jamais modifiés ni réévalués.
- **Taux manquant** : l'opération (ou le solde) est **exclue** du total et un avertissement l'indique, avec un lien vers l'écran des taux. Aucune triangulation automatique (EUR→USD passe par un taux EUR↔USD saisi).
- Le **solde global** convertit le solde de chaque devise au taux du jour. L'**évolution du solde** convertit chaque jour au taux de CE jour : une variation de taux revalorise donc le solde (le dernier point égale toujours le solde global).
- **Transferts entre devises différentes : refusés** (une vraie opération de change, avec deux montants, n'existe pas encore).
- Sauvegarde **v2** : devise par compte, taux et devise de référence. Les sauvegardes v1 (FCFA) restent restaurables.

## Sauvegarde en ligne (facultative)

- Configuration : **`docs/FIREBASE.md`** (projet Firebase gratuit, connexion Google, règles `firestore.rules`).
- Au premier lancement : choix **« Avec mon compte Google »** ou **« Hors ligne uniquement »**, modifiable ensuite dans Paramètres.
- Une copie complète est envoyée après les modifications (1 min plus tard), à l'ouverture, au retour d'internet et environ toutes les 12 h en arrière-plan (horaire décidé par Android). Données inchangées → rien n'est renvoyé.
- Options : automatique oui/non, **Wi-Fi seulement**, **mot de passe** (chiffrement AES-256-GCM, désactivé par défaut ; mot de passe oublié = sauvegarde irrécupérable).
- **5 sauvegardes** conservées. Un envoi n'est visible qu'une fois complet (empreinte SHA-256 vérifiée à la restauration). Jamais d'envoi d'une base vide.
- Un échec réseau ne touche jamais aux données locales ; nouvel essai automatique (1, 2, 4… min, max 60 min).
- Nouveau téléphone : se connecter au même compte → proposition de restaurer la dernière sauvegarde. Restaurer par-dessus des données existantes crée d'abord une copie de sécurité locale (`Documents/securite/`).
- La connexion Google nécessite une version compilée (`npm run build:dev` ou `npm run build:apk`) : elle ne fonctionne ni dans Expo Go ni dans le navigateur.
- **Suppression du compte** : Paramètres › Sauvegarde en ligne › « Supprimer mon compte en ligne » efface toutes les sauvegardes (même inachevées), puis le compte Firebase, et retire l'accès accordé dans le compte Google. Les données locales restent. Firebase peut exiger une connexion récente : l'application redemande alors la connexion Google. Après un échec (réseau…), relancer termine le travail (`deleteCloudAccount`).

### Demande de suppression sans l'application (Play Store)
Google Play demande aussi une adresse web où demander la suppression du compte (Play Console › Sécurité des données).
Publie avec la politique un texte comme celui-ci :

> **Supprimer votre compte MobiBudget.** Dans l'application : Paramètres › Sauvegarde en ligne › « Supprimer mon compte en ligne ».
> Sans accès à l'application : écrivez à techerife@gmail.com depuis l'adresse e-mail de votre compte Google, objet « Suppression de compte MobiBudget ».
> Vos sauvegardes en ligne et votre compte sont supprimés dans un délai d'un mois au plus ; rien n'en est conservé.
> Les statistiques d'utilisation ne sont pas liées à votre compte et s'effacent d'elles-mêmes au bout de 2 mois.

Pour traiter une demande reçue par e-mail : console Firebase › Authentication › rechercher l'adresse et noter l'UID ;
Firestore › `users` › `{UID}` › supprimer la collection `backups` avec ses sous-collections `chunks` ; enfin supprimer l'utilisateur dans Authentication.

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
  accounts/ transactions/ add-transaction.tsx categories.tsx onboarding.tsx privacy.tsx privacy-policy.tsx cloud-backups.tsx
src/
  db/            types.ts (Db atomique + verrou), schema.ts, migrations.ts (versionnées), database.ts (expo-sqlite)
  repositories/  accès SQL paramétré (comptes, catégories, transactions, budgets, paramètres)
  services/      règles métier testables (balance, transaction, budget, statistics, backup, account, category, onboarding, privacy, cloudBackup)
  cloud/         adaptateurs de la sauvegarde en ligne : Firebase (Auth, Firestore), Google Sign-In, chiffrement, réseau, tâche de fond
  lib/           analytics.ts (statistiques Firebase Analytics)
  components/ hooks/ context/ utils/ constants/ types/
__tests__/       tests Jest sur de vrais SQLite (node:sqlite), sans mock
```

Les services ne dépendent ni de React ni d'Expo : ils sont testés tels quels avec un vrai moteur SQLite.
Clés étrangères activées (`PRAGMA foreign_keys = ON`), index sur dates / comptes / catégories, migrations par `PRAGMA user_version`.

## Limitations connues

- Sauvegarde en ligne : la connexion Google, Firestore, la suppression du compte et les règles de sécurité n'ont pas pu être testés ici (pas d'accès aux services Google) ; la logique l'est avec un faux cloud.
- Non testée sur un téléphone ou un émulateur Android (voir le compte rendu de vérification) : seul le code métier est couvert par des tests automatisés ; l'interface a été vérifiée par typage strict et compilation du bundle.
- Sauvegarde non chiffrée.
- Pas de saisie récurrente, de pièces jointes, d'opération de change entre comptes de devises différentes, de changement de devise de référence, de mode sombre (mode clair forcé).
- Mono-appareil : pas de synchronisation (changer de téléphone = export puis restauration).
- `package.json › overrides` : `@react-native-firebase/app` réutilise le SDK `firebase` du projet. Sans cela, deux copies
  de `@firebase/app` sont installées et la connexion Google comme Firestore échouent sur le téléphone. Si tu changes la version
  de `firebase`, vérifie qu'il n'en reste qu'une : `npm ls @firebase/app`.
- Outils de développement : TypeScript 6 et Jest 30 (versions attendues par Expo SDK 58). Ne lance pas `npm audit fix --force` : il ferait reculer Expo de plusieurs années.
- Les alertes `npm audit` concernent `@expo/cli` (outil de développement, non embarqué dans l'APK).
