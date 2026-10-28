/**
 * @firebase/auth publie une version React Native (chargée par Metro) qui exporte getReactNativePersistence,
 * mais son package.json déclare la condition « types » (web) avant « react-native » : TypeScript ne voit
 * donc que les types web. Cette déclaration reprend la signature exacte de dist/rn/…/react_native.d.ts.
 */
import type { Persistence } from 'firebase/auth';

declare module '@firebase/auth' {
  export interface ReactNativeAsyncStorage {
    setItem(key: string, value: string): Promise<void>;
    getItem(key: string): Promise<string | null>;
    removeItem(key: string): Promise<void>;
  }
  export function getReactNativePersistence(storage: ReactNativeAsyncStorage): Persistence;
}
