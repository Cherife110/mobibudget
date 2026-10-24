import { Alert, Platform } from 'react-native';
import { errorMessage } from './errors';

/** Sur le web, `Alert.alert` ne fait rien : on utilise les boîtes du navigateur. */
const isWeb = Platform.OS === 'web';

/** Message d'information (un seul bouton). */
export function notify(title: string, message: string): void {
  if (isWeb) {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

/** Boîte de confirmation (retourne true si l'utilisateur confirme). */
export function confirmAsync(title: string, message: string, confirmLabel: string, destructive = true): Promise<boolean> {
  if (isWeb) return Promise.resolve(window.confirm(`${title}\n\n${message}`));
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
  notify(title, errorMessage(e));
}

export const IS_WEB = isWeb;
