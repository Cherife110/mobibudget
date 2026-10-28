import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../src/context/AppContext';
import { colors } from '../../src/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const icon = (name: IconName, focused: IconName) =>
  ({ color, size, focused: f }: { color: ColorValue; size: number; focused: boolean }) => <Ionicons name={f ? focused : name} size={size} color={color as string} />;

export default function TabsLayout() {
  const { settings } = useApp();
  const insets = useSafeAreaInsets();
  if (!settings.onboardingCompleted) return <Redirect href="/onboarding" />;
  // La configuration initiale demande déjà l'accord : ici, utilisateurs existants, restauration, nouvelle version de la politique.
  if (!settings.privacyAccepted) return <Redirect href="/privacy" />;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTitleStyle: { fontWeight: '700', color: colors.text },
        headerShadowVisible: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.faint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, height: 58 + insets.bottom, paddingBottom: 6 + insets.bottom, paddingTop: 6 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Accueil', headerTitle: 'MobiBudget', tabBarIcon: icon('home-outline', 'home') }} />
      <Tabs.Screen name="transactions" options={{ title: 'Historique', tabBarIcon: icon('list-outline', 'list') }} />
      <Tabs.Screen name="statistics" options={{ title: 'Statistiques', tabBarIcon: icon('stats-chart-outline', 'stats-chart') }} />
      <Tabs.Screen name="budgets" options={{ title: 'Budgets', tabBarIcon: icon('pie-chart-outline', 'pie-chart') }} />
      <Tabs.Screen name="settings" options={{ title: 'Paramètres', tabBarIcon: icon('settings-outline', 'settings') }} />
    </Tabs>
  );
}
