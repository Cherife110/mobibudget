import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../src/context/AppContext';
import { CloudProvider } from '../src/context/CloudContext';
// Déclare la tâche de fond de sauvegarde dès le chargement de l'application (exigé par Android).
import '../src/cloud/backgroundTask';
import { colors } from '../src/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <CloudProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.card },
              headerTintColor: colors.text,
              headerTitleStyle: { fontWeight: '700' },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.bg },
              headerBackTitle: 'Retour',
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            <Stack.Screen name="privacy" options={{ headerShown: false }} />
            <Stack.Screen name="privacy-policy" options={{ title: 'Politique de confidentialité' }} />
            <Stack.Screen name="add-transaction" options={{ title: 'Nouvelle opération' }} />
            <Stack.Screen name="transactions/[id]" options={{ title: "Modifier l'opération" }} />
            <Stack.Screen name="accounts/index" options={{ title: 'Comptes' }} />
            <Stack.Screen name="accounts/[id]" options={{ title: 'Compte' }} />
            <Stack.Screen name="categories" options={{ title: 'Catégories' }} />
            <Stack.Screen name="exchange-rates" options={{ title: 'Taux de change' }} />
            <Stack.Screen name="cloud-backups" options={{ title: 'Sauvegardes en ligne' }} />
          </Stack>
        </CloudProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}
