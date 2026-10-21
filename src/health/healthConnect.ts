import {
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
  SleepStageType,
} from 'react-native-health-connect';

import type { HealthSampleInput, SleepStage } from '../domain/health';
import type { HealthSource } from './source';

const RECORDS = ['SleepSession', 'HeartRate', 'HeartRateVariabilityRmssd', 'OxygenSaturation', 'RespiratoryRate'] as const;

const STAGE: Partial<Record<number, SleepStage>> = {
  [SleepStageType.AWAKE]: 'awake',
  [SleepStageType.SLEEPING]: 'asleep',
  [SleepStageType.LIGHT]: 'light',
  [SleepStageType.DEEP]: 'deep',
  [SleepStageType.REM]: 'rem',
};

let initialised = false;
async function ready(): Promise<boolean> {
  if (initialised) return true;
  if ((await getSdkStatus()) !== SdkAvailabilityStatus.SDK_AVAILABLE) return false;
  initialised = await initialize();
  return initialised;
}

export const healthConnect: HealthSource = {
  name: 'Health Connect',
  isAvailable: () => ready().catch(() => false),
  async requestPermission() {
    if (!(await ready())) return false;
    const granted = await requestPermission(RECORDS.map((recordType) => ({ accessType: 'read' as const, recordType })));
    return granted.some((g) => 'recordType' in g && (g.recordType === 'HeartRate' || g.recordType === 'SleepSession'));
  },
  openSettings: () => openHealthConnectSettings(),
  async read(start, end) {
    if (!(await ready())) return [];
    const timeRangeFilter = { operator: 'between' as const, startTime: start.toISOString(), endTime: end.toISOString() };
    const out: HealthSampleInput[] = [];
    const all = async <T extends (typeof RECORDS)[number]>(type: T) => {
      const rows = [];
      let pageToken: string | undefined;
      do {
        const res = await readRecords(type, { timeRangeFilter, pageToken }).catch(() => null);
        if (!res) break;
        rows.push(...res.records);
        pageToken = res.pageToken || undefined;
      } while (pageToken);
      return rows;
    };
    for (const r of await all('HeartRate')) {
      for (const s of r.samples) out.push({ kind: 'hr', start: new Date(s.time), end: new Date(s.time), value: s.beatsPerMinute });
    }
    for (const r of await all('HeartRateVariabilityRmssd')) {
      out.push({ kind: 'hrv', start: new Date(r.time), end: new Date(r.time), value: r.heartRateVariabilityMillis });
    }
    for (const r of await all('OxygenSaturation')) {
      out.push({ kind: 'spo2', start: new Date(r.time), end: new Date(r.time), value: r.percentage });
    }
    for (const r of await all('RespiratoryRate')) {
      out.push({ kind: 'resp', start: new Date(r.time), end: new Date(r.time), value: r.rate });
    }
    for (const r of await all('SleepSession')) {
      if (!r.stages?.length) {
        out.push({ kind: 'sleep_stage', start: new Date(r.startTime), end: new Date(r.endTime), value: null, stage: 'asleep' });
        continue;
      }
      for (const st of r.stages) {
        const stage = STAGE[st.stage];
        if (stage) out.push({ kind: 'sleep_stage', start: new Date(st.startTime), end: new Date(st.endTime), value: null, stage });
      }
    }
    return out;
  },
};
