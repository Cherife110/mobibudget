# Configurer Firebase : sauvegarde en ligne et statistiques

Les étapes ci-dessous se font une seule fois. Le fichier `google-services.json` (étape 2) est **obligatoire pour compiler**
l'application, car il sert aux statistiques (Firebase Analytics). Le reste peut attendre : tant que `extra.firebase` est vide,
l'option Google s'affiche comme « indisponible dans cette version » et MobiBudget fonctionne normalement hors ligne.

> Les écrans de la console Firebase changent de temps en temps : si un libellé diffère un peu, cherche l'équivalent.

## 1. Créer le projet Firebase
1. Va sur https://console.firebase.google.com et crée un projet (ex. « mobibudget »).
2. Laisse **Google Analytics activé** : il sert aux statistiques d'utilisation, envoyées seulement si l'utilisateur l'accepte.
   Le plan gratuit (Spark) suffit pour un usage personnel ; les quotas exacts sont affichés dans la console (onglet Utilisation).
3. Dans Google Analytics (https://analytics.google.com) › Administration › Conservation des données : garde **2 mois**,
   la durée annoncée dans la politique de confidentialité.

## 2. Ajouter l'application Android et son empreinte SHA-1
1. Dans le projet : **Ajouter une application › Android**, nom du package : `com.cherife.mobibudget`.
2. Empreinte **SHA-1** : la clé de signature est gérée par EAS. Dans le dossier du projet :
   ```bash
   npx eas-cli login
   npx eas-cli init            # si ce n'est pas déjà fait
   npx eas-cli credentials -p android
   ```
   Choisis le profil (`development` ou `production`) : EAS crée la clé si besoin et affiche son **SHA-1**.
   Copie-le dans Firebase : **Paramètres du projet › Vos applications › (app Android) › Ajouter une empreinte**.
   Si tes builds de développement et de production utilisent des clés différentes, ajoute les deux SHA-1.
3. Télécharge `google-services.json` et place-le à la racine du projet, à côté de `app.json`. **Sans lui, le build EAS échoue.**
   Il ne contient pas de secret : ne l'ajoute pas à `.gitignore`, sinon EAS ne l'envoie pas au build.

## 3. Ajouter une application Web (pour obtenir la configuration)
MobiBudget utilise le SDK JavaScript de Firebase : il lui faut la configuration « Web ».
1. **Ajouter une application › Web** (nom au choix, pas besoin d'hébergement).
2. Firebase affiche un objet `firebaseConfig`. Recopie ses valeurs dans `app.json` :
   ```json
   "extra": {
     "firebase": {
       "apiKey": "...",
       "authDomain": "....firebaseapp.com",
       "projectId": "...",
       "appId": "...",
       "messagingSenderId": "...",
       "storageBucket": "..."
     },
     "googleWebClientId": "(étape 4)"
   }
   ```
   Ces valeurs identifient ton projet ; ce ne sont pas des mots de passe. La sécurité repose sur les règles de l'étape 5.

## 4. Activer la connexion Google
1. **Authentication › Méthode de connexion › Google › Activer**, choisis ton adresse comme e-mail d'assistance, enregistre.
2. Dans le panneau du fournisseur Google, section **Configuration du SDK Web**, copie l'**ID client Web**
   (il finit par `.apps.googleusercontent.com`) dans `app.json › extra › googleWebClientId`.

## 5. Créer Firestore et publier les règles
1. **Firestore Database › Créer une base de données**, mode **production**, région au choix (une région proche, par ex. en Europe).
2. Onglet **Règles** : remplace tout le contenu par celui du fichier `firestore.rules` du projet, puis **Publier**.
   Ces règles n'autorisent chaque compte qu'à lire et écrire **ses propres** sauvegardes.

## 6. Compiler et tester sur le téléphone
La connexion Google ne fonctionne pas dans Expo Go ni dans le navigateur : il faut une version compilée.
```bash
npm run build:dev     # version de développement (APK), puis : npx expo start --dev-client
# ou, pour un APK final à installer directement :
npx eas-cli build --platform android --profile preview
```
(`npm run build:apk` produit un fichier `.aab`, destiné au Play Store.)
Installe l'APK, ouvre l'application, choisis « Avec mon compte Google ».

Statistiques en direct : `adb shell setprop debug.firebase.analytics.app com.cherife.mobibudget`, puis Firebase › Analytics › DebugView
(après avoir accepté les statistiques dans l'application). Les rapports habituels arrivent sous 24 h.

## Dépannage
| Message / code | Cause probable |
|---|---|
| « Configuration Google incomplète » (DEVELOPER_ERROR, code 10) | SHA-1 absent ou différent de la clé utilisée, ou `googleWebClientId` incorrect |
| « Le serveur a refusé l'accès » (permission-denied) | règles de l'étape 5 non publiées, ou session expirée : se reconnecter |
| « Connexion au serveur impossible » | pas d'internet ; la sauvegarde repartira toute seule |
| Option Google « indisponible dans cette version » | `extra.firebase` ou `googleWebClientId` vides dans `app.json` au moment du build |
| Build EAS en échec sur `google-services.json` | fichier absent de la racine du projet, ou ignoré par Git (étape 2) |

## Ce qui est envoyé
Une copie complète des données (comptes, opérations, catégories, budgets, taux), **en clair** côté serveur
sauf si tu actives « Protéger par un mot de passe » (chiffrement AES-256-GCM sur le téléphone, clé dérivée
par PBKDF2-SHA256, 310 000 itérations). Les 5 dernières sauvegardes sont conservées.

Si l'utilisateur les accepte, des statistiques d'utilisation sans aucune donnée financière partent aussi vers Google Analytics.
Le détail, montré à l'utilisateur, est dans la politique de confidentialité (`src/constants/privacy.ts`).
