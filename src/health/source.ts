import type { HealthSampleInput } from '../domain/health';

/** Read access to the phone's health store (Apple Health or Health Connect). */
export interface HealthSource {
  readonly name: 'Apple Health' | 'Health Connect';
  isAvailable(): Promise<boolean>;
  /** Shows the system permission sheet. Resolves true if at least heart rate or sleep was granted. */
  requestPermission(): Promise<boolean>;
  read(start: Date, end: Date): Promise<HealthSampleInput[]>;
}
