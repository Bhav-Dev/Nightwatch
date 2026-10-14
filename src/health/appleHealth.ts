import {
  CategoryValueSleepAnalysis,
  isHealthDataAvailableAsync,
  queryCategorySamples,
  queryQuantitySamples,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';

import type { HealthSampleInput, SleepStage } from '../domain/health';
import type { HealthSource } from './source';

const READ = [
  'HKCategoryTypeIdentifierSleepAnalysis',
  'HKQuantityTypeIdentifierHeartRate',
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKQuantityTypeIdentifierOxygenSaturation',
  'HKQuantityTypeIdentifierRespiratoryRate',
] as const;

const STAGE: Partial<Record<number, SleepStage>> = {
  [CategoryValueSleepAnalysis.inBed]: 'inbed',
  [CategoryValueSleepAnalysis.asleep]: 'asleep',
  [CategoryValueSleepAnalysis.awake]: 'awake',
  [CategoryValueSleepAnalysis.asleepCore]: 'light',
  [CategoryValueSleepAnalysis.asleepDeep]: 'deep',
  [CategoryValueSleepAnalysis.asleepREM]: 'rem',
};

export const appleHealth: HealthSource = {
  name: 'Apple Health',
  isAvailable: () => isHealthDataAvailableAsync(),
  requestPermission: () => requestAuthorization({ toRead: READ }),
  async read(start, end) {
    const filter = { date: { startDate: start, endDate: end } };
    const out: HealthSampleInput[] = [];
    const quantity = async (
      id: 'HKQuantityTypeIdentifierHeartRate' | 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN' | 'HKQuantityTypeIdentifierOxygenSaturation' | 'HKQuantityTypeIdentifierRespiratoryRate',
      kind: HealthSampleInput['kind'],
      unit: string,
    ) => {
      // Missing permission for one type must not lose the others.
      const rows = await queryQuantitySamples(id, { limit: 0, filter, unit: unit as never }).catch(() => []);
      for (const r of rows) out.push({ kind, start: new Date(r.startDate), end: new Date(r.endDate), value: r.quantity });
    };
    await quantity('HKQuantityTypeIdentifierHeartRate', 'hr', 'count/min');
    await quantity('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 'hrv', 'ms');
    await quantity('HKQuantityTypeIdentifierOxygenSaturation', 'spo2', '%');
    await quantity('HKQuantityTypeIdentifierRespiratoryRate', 'resp', 'count/min');
    const sleep = await queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', { limit: 0, filter }).catch(() => []);
    for (const s of sleep) {
      const stage = STAGE[s.value as number];
      if (stage) out.push({ kind: 'sleep_stage', start: new Date(s.startDate), end: new Date(s.endDate), value: null, stage });
    }
    return out;
  },
};
