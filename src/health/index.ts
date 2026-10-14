import { Platform } from 'react-native';

import type { HealthSource } from './source';

/**
 * The health store for this platform, or null (web, Expo Go without the native modules).
 * Loaded lazily so a missing native module never crashes app start.
 */
export function getHealthSource(): HealthSource | null {
  try {
    // Lazy require on purpose: importing the other platform's native module would throw.
    /* eslint-disable @typescript-eslint/no-require-imports */
    if (Platform.OS === 'ios') return (require('./appleHealth') as typeof import('./appleHealth')).appleHealth;
    if (Platform.OS === 'android') return (require('./healthConnect') as typeof import('./healthConnect')).healthConnect;
    /* eslint-enable @typescript-eslint/no-require-imports */
  } catch {
    return null;
  }
  return null;
}
