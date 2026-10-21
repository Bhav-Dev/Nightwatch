import type { HealthSampleInput } from '../domain/health';

/** Read access to the phone's health store (Apple Health or Health Connect). */
export interface HealthSource {
  readonly name: 'Apple Health' | 'Health Connect';
  isAvailable(): Promise<boolean>;
  /** Shows the system permission sheet. Resolves true if at least heart rate or sleep was granted. */
  requestPermission(): Promise<boolean>;
  /** Opens the store's own settings, where its permissions are changed (Health Connect). Apple Health has no link in. */
  openSettings?(): void;
  read(start: Date, end: Date): Promise<HealthSampleInput[]>;
}
