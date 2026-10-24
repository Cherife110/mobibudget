import { Alert } from 'react-native';
import { errorMessage } from './errors';

/** Boîte de confirmation (retourne true si l'utilisateur confirme). */
export function confirmAsync(title: string, message: string, confirmLabel: string, destructive = true): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function showError(e: unknown, title = 'Action impossible'): void {
  Alert.alert(title, errorMessage(e));
}
