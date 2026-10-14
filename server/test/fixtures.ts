import type { NightDto } from '../../shared/api.ts';

let seq = 0;

/** A valid night for sync tests, with a fresh id each call. */
export function night(overrides: Partial<NightDto> = {}): NightDto {
  seq++;
  return {
    id: `night-${seq}-${crypto.randomUUID()}`,
    date: '2026-10-13',
    duration_s: 8 * 3600,
    time_in_bed_s: 7.5 * 3600,
    score: 42,
    score_version: 1,
    pct_snoring: 0.21,
    event_count: 14,
    max_db: 61.5,
    partial: false,
    typical: true,
    health: null,
    remedies: ['nasal_strips'],
    factors: [{ id: 'alcohol', value: '1-2' }],
    updated_at: '2026-10-14T06:00:00.000Z',
    ...overrides,
  };
}
