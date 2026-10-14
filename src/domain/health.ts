/**
 * Apple Health / Health Connect samples aligned to a night, and the per-night summary that
 * is the only Health data ever synced (raw samples never leave the phone).
 */
import type { HealthSummaryDto } from '../../shared/api';

export type HealthKind = 'sleep_stage' | 'hr' | 'hrv' | 'spo2' | 'resp';
export type SleepStage = 'inbed' | 'awake' | 'asleep' | 'light' | 'deep' | 'rem';

export interface HealthSampleInput {
  kind: HealthKind;
  start: Date;
  end: Date;
  /** hr bpm, hrv ms, resp breaths/min, spo2 as a fraction (0.97) or percent (97). Null for stages. */
  value: number | null;
  stage?: SleepStage;
}

export interface AlignedSample {
  kind: HealthKind;
  /** Offsets in seconds from the night's start, clipped to the night. */
  startS: number;
  endS: number;
  value: number | null;
  stage: SleepStage | null;
}

/** Samples this close to the night's edges still count (watch clocks and batching drift). */
export const ALIGN_TOLERANCE_S = 60;

export function alignToNight(samples: readonly HealthSampleInput[], nightStartEpochS: number, durationS: number): AlignedSample[] {
  const out: AlignedSample[] = [];
  for (const s of samples) {
    const a = s.start.getTime() / 1000 - nightStartEpochS;
    const b = s.end.getTime() / 1000 - nightStartEpochS;
    if (b < -ALIGN_TOLERANCE_S || a > durationS + ALIGN_TOLERANCE_S) continue;
    let value = s.value;
    if (s.kind === 'spo2' && value !== null && value <= 1) value = value * 100;
    out.push({
      kind: s.kind,
      startS: Math.max(0, Math.min(durationS, Math.round(a))),
      endS: Math.max(0, Math.min(durationS, Math.round(b))),
      value,
      stage: s.stage ?? null,
    });
  }
  return out.sort((x, y) => x.startS - y.startS);
}

const ASLEEP: SleepStage[] = ['asleep', 'light', 'deep', 'rem'];
export const SPO2_DIP_BELOW = 90;
export const SPO2_DIP_MIN_S = 10;
/** A point reading is taken to last until the next one, but no longer than this. */
const POINT_HOLD_S = 60;

export interface Spo2Dip {
  startS: number;
  endS: number;
  minValue: number;
}

/** Runs of SpO2 below 90% lasting at least 10 seconds. */
export function spo2Dips(aligned: readonly AlignedSample[]): Spo2Dip[] {
  const spo2 = aligned.filter((s) => s.kind === 'spo2' && s.value !== null);
  const dips: Spo2Dip[] = [];
  let cur: Spo2Dip | null = null;
  for (let i = 0; i < spo2.length; i++) {
    const s = spo2[i];
    const end = s.endS > s.startS ? s.endS : Math.min(spo2[i + 1]?.startS ?? s.startS + POINT_HOLD_S, s.startS + POINT_HOLD_S);
    if (s.value! < SPO2_DIP_BELOW) {
      if (cur && s.startS <= cur.endS + 1) {
        cur.endS = Math.max(cur.endS, end);
        cur.minValue = Math.min(cur.minValue, s.value!);
      } else {
        if (cur) dips.push(cur);
        cur = { startS: s.startS, endS: end, minValue: s.value! };
      }
    } else if (cur) {
      dips.push(cur);
      cur = null;
    }
  }
  if (cur) dips.push(cur);
  return dips.filter((d) => d.endS - d.startS >= SPO2_DIP_MIN_S);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summariseHealth(aligned: readonly AlignedSample[], timeInBedS: number): HealthSummaryDto {
  const values = (k: HealthKind) => aligned.filter((s) => s.kind === k && s.value !== null).map((s) => s.value!);

  // Asleep time as the union of asleep intervals (sources often overlap).
  const asleep = aligned
    .filter((s) => s.kind === 'sleep_stage' && s.stage && ASLEEP.includes(s.stage))
    .map((s) => [s.startS, s.endS] as const)
    .sort((a, b) => a[0] - b[0]);
  let asleepS = 0;
  let reach = -1;
  for (const [a, b] of asleep) {
    const from = Math.max(a, reach);
    if (b > from) asleepS += b - from;
    reach = Math.max(reach, b);
  }
  const hr = values('hr');
  const spo2 = values('spo2');
  return {
    sleep_efficiency: asleep.length && timeInBedS > 0 ? Math.min(1, asleepS / timeInBedS) : null,
    spo2_min: spo2.length ? Math.min(...spo2) : null,
    spo2_dips: spo2.length ? spo2Dips(aligned).length : null,
    hr_mean: avg(hr),
    hr_max: hr.length ? Math.max(...hr) : null,
    hrv_mean: avg(values('hrv')),
    resp_mean: avg(values('resp')),
  };
}

/** Epic events followed within 60 s by a heart rate at least 15 bpm above the night's mean. */
export function heartRateSpikes(
  aligned: readonly AlignedSample[],
  epicEvents: readonly { startS: number }[],
  hrMean: number | null,
): number {
  if (hrMean === null) return 0;
  const hr = aligned.filter((s) => s.kind === 'hr' && s.value !== null);
  return epicEvents.filter((e) => hr.some((s) => s.startS >= e.startS && s.startS <= e.startS + 60 && s.value! >= hrMean + 15)).length;
}
