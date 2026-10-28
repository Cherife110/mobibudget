import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './ui';
import { colors, radius } from '../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface Slide {
  icon: IconName;
  tint: string;
  bg: string;
  title: string;
  text: string;
  points?: string[];
}

const SLIDES: Slide[] = [
  {
    icon: 'wallet',
    tint: '#fff',
    bg: colors.income,
    title: 'Bienvenue sur MobiBudget',
    text: 'Gardez votre argent clair et sous contrôle : notez vos entrées et vos dépenses en quelques secondes, et voyez toujours où vous en êtes.',
  },
  {
    icon: 'albums-outline',
    tint: colors.chart,
    bg: '#DBEAFE',
    title: 'Un compte pour chaque porte-monnaie',
    text: 'Créez un compte pour chaque endroit où se trouve votre argent. Le solde se calcule tout seul.',
    points: ['Espèces, Mobile Money, banque…', 'Chaque compte peut avoir sa devise (FCFA, €, $…)', 'Solde global de tous vos comptes'],
  },
  {
    icon: 'swap-vertical-outline',
    tint: colors.expense,
    bg: colors.expenseBg,
    title: 'Entrées, dépenses et transferts',
    text: 'Ajoutez une opération en choisissant un montant, une catégorie et une date.',
    points: ['Une dépense oubliée ? Choisissez la date d\'hier', 'Un transfert déplace l\'argent d\'un compte à l\'autre', 'Un transfert n\'est jamais compté comme une dépense'],
  },
  {
    icon: 'stats-chart-outline',
    tint: '#7C3AED',
    bg: '#EDE9FE',
    title: 'Budgets et statistiques',
    text: 'Fixez un plafond mensuel par catégorie et soyez prévenu avant de le dépasser.',
    points: ['Alerte à 80 % du budget', 'Graphiques par jour, semaine et mois', 'Évolution de votre solde dans le temps'],
  },
  {
    icon: 'shield-checkmark-outline',
    tint: colors.warning,
    bg: colors.warningBg,
    title: 'Vos données, vos sauvegardes',
    text: 'L\'application fonctionne sans internet. Après la politique de confidentialité, vous choisirez comment protéger vos données.',
    points: ['Avec votre compte Google : sauvegarde automatique en ligne', 'Ou hors ligne uniquement, avec des exports manuels', 'Vous pourrez changer d\'avis dans Paramètres'],
  },
];

/** Présentation au premier lancement : pages avec « Suivant », la dernière mène à « Commencer ». */
export function IntroSlides({ onDone, onRestore, busy }: { onDone: () => void; onRestore: () => void; busy?: boolean }) {
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];
  const last = index === SLIDES.length - 1;

  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <Text style={styles.counter} accessibilityLabel={`Page ${index + 1} sur ${SLIDES.length}`}>{index + 1} / {SLIDES.length}</Text>
        {!last ? (
          <Pressable onPress={() => setIndex(SLIDES.length - 1)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Passer l'introduction">
            <Text style={styles.skip}>Passer</Text>
          </Pressable>
        ) : <View />}
      </View>

      <View style={styles.body}>
        <View style={[styles.icon, { backgroundColor: slide.bg }]}>
          <Ionicons name={slide.icon} size={48} color={slide.tint} />
        </View>
        <Text style={styles.title} accessibilityRole="header">{slide.title}</Text>
        <Text style={styles.text}>{slide.text}</Text>
        {slide.points ? (
          <View style={styles.points}>
            {slide.points.map((p) => (
              <View key={p} style={styles.pointRow}>
                <Ionicons name="checkmark-circle" size={18} color={colors.income} />
                <Text style={styles.point}>{p}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.dots} accessible={false}>
        {SLIDES.map((s, i) => (
          <View key={s.title} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.actions}>
        {last ? (
          <>
            <Button label="Commencer" icon="arrow-forward" onPress={onDone} />
            <Button label="Restaurer une sauvegarde" icon="cloud-upload-outline" variant="secondary" onPress={onRestore} disabled={busy} />
            <Button label="Précédent" variant="ghost" onPress={() => setIndex(index - 1)} />
          </>
        ) : (
          <>
            <Button label="Suivant" icon="arrow-forward" onPress={() => setIndex(index + 1)} />
            {index > 0 ? <Button label="Précédent" variant="ghost" onPress={() => setIndex(index - 1)} /> : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 18, minHeight: 640 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 24 },
  counter: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  skip: { fontSize: 14, fontWeight: '700', color: colors.chart },
  body: { alignItems: 'center', gap: 14, paddingTop: 8 },
  icon: { width: 96, height: 96, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, textAlign: 'center' },
  text: { fontSize: 15, lineHeight: 22, color: colors.muted, textAlign: 'center' },
  points: { alignSelf: 'stretch', gap: 10, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 16, marginTop: 4 },
  pointRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  point: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.text },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { width: 24, backgroundColor: colors.primary },
  actions: { gap: 10 },
});
