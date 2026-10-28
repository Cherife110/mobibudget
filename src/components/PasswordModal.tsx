import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Banner, Button, Field } from './ui';
import { colors, radius } from '../theme';
import { MIN_PASSWORD_LENGTH } from '../cloud/crypto';

/** Saisie d'un mot de passe ; `confirm` demande une seconde saisie identique (création). */
export function PasswordModal({
  visible, title, message, confirm, onSubmit, onClose,
}: { visible: boolean; title: string; message: string; confirm?: boolean; onSubmit: (password: string) => Promise<void>; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!visible) { setPassword(''); setAgain(''); setError(null); setBusy(false); }
  }, [visible]);

  const submit = async () => {
    setError(null);
    if (confirm && password.length < MIN_PASSWORD_LENGTH) return setError(`Au moins ${MIN_PASSWORD_LENGTH} caractères.`);
    if (confirm && password !== again) return setError('Les deux mots de passe ne correspondent pas.');
    setBusy(true);
    try {
      await onSubmit(password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          {error ? <Banner tone="error" text={error} /> : null}
          <Field label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoFocus />
          {confirm ? <Field label="Confirmer le mot de passe" value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" /> : null}
          <Button label="Valider" icon="checkmark" onPress={submit} loading={busy} disabled={password.length === 0} />
          <Button label="Annuler" variant="ghost" onPress={onClose} disabled={busy} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 20, gap: 12 },
  title: { fontSize: 17, fontWeight: '700', color: colors.text },
  message: { fontSize: 13, color: colors.muted, lineHeight: 19 },
});
