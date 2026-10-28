import React from 'react';
import { useRouter } from 'expo-router';
import { Screen } from '../src/components/ui';
import { PrivacyConsent } from '../src/components/PrivacyConsent';

/** Demandé au démarrage tant que la politique en vigueur n'est pas acceptée (utilisateurs existants, après une restauration). */
export default function Privacy() {
  const router = useRouter();
  return (
    <Screen style={{ paddingTop: 56 }}>
      <PrivacyConsent onAccepted={() => router.replace('/')} />
    </Screen>
  );
}
