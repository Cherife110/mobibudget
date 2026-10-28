import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Card, Screen } from '../src/components/ui';
import { colors } from '../src/theme';
import { PRIVACY_POLICY, PRIVACY_POLICY_DATE, PRIVACY_POLICY_INTRO, PRIVACY_POLICY_VERSION } from '../src/constants/privacy';
import { formatDateFR } from '../src/utils/dates';

/** Texte complet, consultable hors connexion. */
export default function PrivacyPolicy() {
  return (
    <Screen>
      <Text style={styles.meta}>Version {PRIVACY_POLICY_VERSION} · {formatDateFR(PRIVACY_POLICY_DATE)}</Text>
      <Text style={styles.paragraph}>{PRIVACY_POLICY_INTRO}</Text>
      {PRIVACY_POLICY.map((section) => (
        <Card key={section.title} style={{ gap: 8 }}>
          <Text style={styles.heading}>{section.title}</Text>
          {section.paragraphs.map((p, i) => (
            <Text key={i} style={styles.paragraph} selectable>{p}</Text>
          ))}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: { fontSize: 13, color: colors.muted },
  heading: { fontSize: 16, fontWeight: '700', color: colors.text },
  paragraph: { fontSize: 14, color: colors.text, lineHeight: 21 },
});
