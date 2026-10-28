/** Changer la version redemande l'accord de chaque utilisateur au prochain lancement. */
export const PRIVACY_POLICY_VERSION = '1.0';
/** Date de cette version (AAAA-MM-JJ). */
export const PRIVACY_POLICY_DATE = '2026-10-28';
/** Adresse pour exercer ses droits. */
export const PRIVACY_CONTACT_EMAIL = 'techerife@gmail.com';

export interface PolicySection {
  title: string;
  paragraphs: string[];
}

export const PRIVACY_POLICY_INTRO =
  "MobiBudget est une application de gestion de budget personnel qui fonctionne sans connexion. Cette politique explique quelles données sont traitées, pourquoi, et comment en garder le contrôle.";

/** Texte complet affiché dans l'application (à publier aussi à une adresse publique pour le Play Store). */
export const PRIVACY_POLICY: PolicySection[] = [
  {
    title: 'Vos données financières',
    paragraphs: [
      "Vos comptes, soldes, opérations, catégories, budgets et taux de change sont enregistrés sur votre téléphone. Tant que vous n'activez pas la sauvegarde en ligne, ils ne sont envoyés à aucun serveur : personne d'autre que vous n'y a accès.",
      "L'application ne contient pas de publicité.",
    ],
  },
  {
    title: 'Sauvegarde en ligne avec votre compte Google (facultatif)',
    paragraphs: [
      "Si vous vous connectez avec votre compte Google, MobiBudget envoie automatiquement une copie complète de vos données financières dans Google Firebase (Authentication et Cloud Firestore), pour que vous puissiez les retrouver sur un autre téléphone. Base légale : votre demande d'utiliser ce service.",
      "Données concernées : votre adresse e-mail, votre nom et l'identifiant de votre compte Google ; la copie de vos données ; pour chaque sauvegarde, sa date, le nombre de comptes, d'opérations et de budgets qu'elle contient, la version de l'application et un identifiant aléatoire de ce téléphone.",
      "Seul votre compte peut lire ces sauvegardes depuis l'application. Sans mot de passe, elles sont stockées en clair sur les serveurs de Google : Google, qui les héberge, et l'éditeur de MobiBudget, qui administre le service, peuvent techniquement y accéder. Avec « Protéger par un mot de passe », la sauvegarde est chiffrée sur votre téléphone avant l'envoi et personne d'autre ne peut la lire ; un mot de passe oublié la rend irrécupérable.",
      "Les 5 sauvegardes les plus récentes sont conservées, les plus anciennes sont supprimées automatiquement. Si vous vous déconnectez, l'envoi s'arrête mais les sauvegardes existantes restent en ligne. Pour tout effacer, utilisez Paramètres › Sauvegarde en ligne › Supprimer mon compte en ligne : vos sauvegardes, puis votre compte MobiBudget, sont supprimés définitivement ; votre compte Google n'est pas touché.",
    ],
  },
  {
    title: 'Sauvegardes sur fichier',
    paragraphs: [
      "Les fichiers de sauvegarde sont créés sur votre téléphone, uniquement à votre demande. Ils ne sont pas chiffrés : si vous les enregistrez ou les partagez avec un autre service (Google Drive, e-mail, messagerie…), ce service les traite selon ses propres règles.",
    ],
  },
  {
    title: "Statistiques d'utilisation (facultatif)",
    paragraphs: [
      "Si vous l'acceptez, MobiBudget envoie des statistiques d'utilisation à Google Analytics pour Firebase, un service de Google, pour savoir combien de personnes utilisent l'application et l'améliorer. Base légale : votre consentement.",
      "Ces statistiques comprennent : un identifiant aléatoire propre à cette installation (ni votre nom, ni votre numéro, ni votre e-mail), des informations techniques sur l'appareil (modèle, version d'Android, langue, taille d'écran), le pays et la région approximatifs (déduits de l'adresse IP, que Google Analytics ne conserve pas), la version de l'application, les dates et la durée d'utilisation, et quelques étapes clés comme la fin de la configuration initiale.",
      "Ne sont jamais envoyés avec les statistiques : vos montants et soldes, les noms de vos comptes et catégories, les descriptions de vos opérations, vos taux de change et vos sauvegardes. L'identifiant publicitaire de l'appareil n'est pas collecté et rien n'est utilisé à des fins publicitaires.",
      "Sans votre accord, aucune statistique n'est envoyée. Vous pouvez changer d'avis à tout moment dans Paramètres › Confidentialité : l'envoi s'arrête aussitôt.",
    ],
  },
  {
    title: 'Conservation et transfert',
    paragraphs: [
      "Google conserve les statistiques liées à l'identifiant d'installation pendant 2 mois ; il ne reste ensuite que des totaux qui ne permettent pas d'identifier un utilisateur. Les sauvegardes en ligne sont conservées tant que votre compte existe, dans la limite des 5 plus récentes.",
      "Ces données peuvent être traitées sur des serveurs situés hors de votre pays, notamment aux États-Unis. Pour en savoir plus sur les pratiques de Google : policies.google.com/privacy.",
    ],
  },
  {
    title: 'Permissions',
    paragraphs: [
      "MobiBudget utilise l'accès à Internet uniquement pour la sauvegarde en ligne et les statistiques, si vous les avez activées ; une tâche en arrière-plan peut lancer la sauvegarde environ toutes les 12 heures. L'application ne demande ni votre position, ni vos contacts, ni l'accès à vos photos, à vos SMS ou à votre appareil photo.",
    ],
  },
  {
    title: 'Vos droits',
    paragraphs: [
      "Vous pouvez à tout moment retirer votre accord aux statistiques (Paramètres › Confidentialité), arrêter la sauvegarde en ligne en vous déconnectant, supprimer votre compte et toutes vos sauvegardes en ligne (Paramètres › Sauvegarde en ligne › Supprimer mon compte en ligne), et supprimer toutes les données de l'application sur le téléphone en la désinstallant ou en effaçant ses données dans les réglages d'Android.",
      "Si vous n'avez plus accès à l'application, demandez la suppression de votre compte et de vos sauvegardes en écrivant à l'adresse ci-dessous depuis l'adresse e-mail de votre compte Google : elle est faite dans un délai d'un mois au plus. Les statistiques, liées à un identifiant d'installation et non à votre compte, s'effacent d'elles-mêmes au bout de 2 mois.",
      "Pour toute autre demande, par exemple l'accès à vos données, écrivez à la même adresse. Vous pouvez aussi adresser une réclamation à l'autorité de protection des données personnelles de votre pays.",
    ],
  },
  {
    title: 'Modifications',
    paragraphs: [
      "Si cette politique change, MobiBudget vous présente la nouvelle version au démarrage et vous demande de l'accepter avant de continuer.",
    ],
  },
  {
    title: 'Contact',
    paragraphs: [`Pour toute question sur vos données : ${PRIVACY_CONTACT_EMAIL}.`],
  },
];
