/**
 * A deterministic synthetic community with planted effects, for testing the aggregation job.
 * Everything comes from one seeded PRNG (mulberry32), so every run builds the same data.
 */
import { AGE_BANDS, BMI_BANDS, POSITIONS, type ProfileBands } from '../../shared/profile.ts';
import type { NightSummary } from '../../shared/remedyEffect.ts';
import { json, type Sql } from '../src/db/sql.ts';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticNight extends NightSummary {
  score_version: number;
}

export interface SyntheticContributor {
  userId: string;
  contributorId: string;
  profile: ProfileBands;
  nights: SyntheticNight[];
}

export interface SyntheticOptions {
  contributors: number;
  seed: number;
  today: string;
  /** Planted score changes, by remedy or factor id. */
  effects: Record<string, number>;
}

export const TRIAL_REMEDIES = ['side_sleeping', 'nasal_strips', 'throat_spray', 'mouth_tape'];

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function synthesise(opts: SyntheticOptions): SyntheticContributor[] {
  const rand = mulberry32(opts.seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const uuid = () =>
    'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(rand() * 16).toString(16));
  const effect = (id: string) => opts.effects[id] ?? 0;

  const out: SyntheticContributor[] = [];
  for (let i = 0; i < opts.contributors; i++) {
    const profile: ProfileBands = {
      age_band: pick(AGE_BANDS),
      // Only five people say "other", so that segment stays under the 10-person floor.
      sex: i < 5 ? 'other' : pick(['female', 'male'] as const),
      height_band: null,
      weight_band: null,
      bmi_band: pick(BMI_BANDS),
      position: pick(POSITIONS),
      pauses_reported: pick(['yes', 'no', 'not_sure'] as const),
      apnoea_dx: rand() < 0.1,
      cpap: false,
    };
    const count = 35 + Math.floor(rand() * 45);
    const end = addDays(opts.today, -Math.floor(rand() * 40));
    const start = addDays(end, -(count - 1));
    const baseline = 35 + rand() * 30;

    // One to three remedies, each started some days after the previous. Usually more than two
    // weeks apart, sometimes close enough to trigger the co-introduction rule.
    const shuffled = [...TRIAL_REMEDIES];
    for (let j = shuffled.length - 1; j > 0; j--) {
      const k = Math.floor(rand() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    const tried = shuffled.slice(0, 1 + Math.floor(rand() * 3));
    let day = 8 + Math.floor(rand() * 8);
    const introduced = tried.map((r) => {
      const d = day;
      day += rand() < 0.2 ? 3 + Math.floor(rand() * 5) : 15 + Math.floor(rand() * 10);
      return [r, d] as const;
    });
    // Some people run a humidifier almost every night from the start: background, present on
    // both sides of every comparison, so it must not knock out their other remedies' nights.
    const background = rand() < 0.2;
    // A few people have their early nights scored by an older algorithm, which the job ignores.
    const oldVersionNights = rand() < 0.1 ? 10 : 0;

    const nights: SyntheticNight[] = [];
    for (let k = 0; k < count; k++) {
      const date = addDays(start, k);
      const remedies = introduced.filter(([, d]) => k >= d && rand() < 0.6).map(([r]) => r);
      if (background && rand() < 0.95) remedies.push('humidifier');
      const factors: { id: string; value: string | null }[] = [];
      if (rand() < 0.2) factors.push({ id: 'alcohol', value: pick(['1-2', '3-4', '5+']) });
      if (rand() < 0.1) factors.push({ id: 'congestion', value: null });
      let score = baseline + gauss() * 6;
      for (const r of remedies) score += effect(r);
      for (const f of factors) score += effect(f.id);
      score = Math.max(0, Math.min(100, Math.round(score)));
      const old = k < oldVersionNights;
      nights.push({
        id: `${i}-${k}-${uuid().slice(0, 8)}`,
        date,
        score: old ? 99 : score,
        pct_snoring: Math.max(0, Math.min(1, Math.round((score / 200 + gauss() * 0.02) * 1000) / 1000)),
        duration_s: rand() < 0.03 ? 2 * 3600 : 6 * 3600 + Math.floor(rand() * 7200),
        partial: rand() < 0.03,
        typical: rand() < 0.03 ? false : rand() < 0.5 ? true : null,
        remedies,
        factors,
        score_version: old ? 1 : 2,
      });
    }
    out.push({ userId: uuid(), contributorId: uuid(), profile, nights });
  }
  return out;
}

/** Writes the community straight into the tables (bulk, via jsonb_to_recordset). */
export async function insertSynthetic(sql: Sql, people: SyntheticContributor[], now: string): Promise<void> {
  await sql.query(
    `INSERT INTO app_user (id, auth_provider, auth_subject, created_at, last_sign_in_at)
     SELECT id, 'email', id::text || '@synthetic.test', $2::timestamptz, $2::timestamptz
     FROM jsonb_to_recordset($1::text::jsonb) AS x(id uuid)`,
    [json(people.map((p) => ({ id: p.userId }))), now],
  );
  await sql.query(
    `INSERT INTO contribution (contributor_id, user_id, opted_in_at)
     SELECT contributor_id, user_id, $2::timestamptz FROM jsonb_to_recordset($1::text::jsonb) AS x(contributor_id uuid, user_id uuid)`,
    [json(people.map((p) => ({ contributor_id: p.contributorId, user_id: p.userId }))), now],
  );
  await sql.query(
    `INSERT INTO profile (user_id, age_band, sex, height_band, weight_band, bmi_band, position, pauses_reported,
       apnoea_dx, cpap, version, updated_at)
     SELECT user_id, age_band, sex, height_band, weight_band, bmi_band, position, pauses_reported, apnoea_dx, cpap,
       1, $2::timestamptz
     FROM jsonb_to_recordset($1::text::jsonb) AS x(user_id uuid, age_band text, sex text, height_band text,
       weight_band text, bmi_band text, position text, pauses_reported text, apnoea_dx boolean, cpap boolean)`,
    [json(people.map((p) => ({ user_id: p.userId, ...p.profile }))), now],
  );
  const nights = people.flatMap((p) => p.nights.map((n) => ({ ...n, user_id: p.userId })));
  for (let i = 0; i < nights.length; i += 5000) {
    const chunk = nights.slice(i, i + 5000);
    await sql.query(
      `INSERT INTO night_summary (id, user_id, date, duration_s, time_in_bed_s, score, score_version, pct_snoring,
         event_count, max_db, partial, typical, updated_at, server_updated_at)
       SELECT id, user_id, date, duration_s, duration_s, score, score_version, pct_snoring, 0, 60, partial, typical,
         $2::timestamptz, $2::timestamptz
       FROM jsonb_to_recordset($1::text::jsonb) AS x(id text, user_id uuid, date text, duration_s integer,
         score double precision, score_version integer, pct_snoring double precision, partial boolean, typical boolean)`,
      [json(chunk), now],
    );
    await sql.query(
      `INSERT INTO remedy_log (night_id, remedy_id)
       SELECT night_id, remedy_id FROM jsonb_to_recordset($1::text::jsonb) AS x(night_id text, remedy_id text)`,
      [json(chunk.flatMap((n) => n.remedies.map((r) => ({ night_id: n.id, remedy_id: r }))))],
    );
    await sql.query(
      `INSERT INTO factor_log (night_id, factor_id, value)
       SELECT night_id, factor_id, value FROM jsonb_to_recordset($1::text::jsonb) AS x(night_id text, factor_id text, value text)`,
      [json(chunk.flatMap((n) => n.factors.map((f) => ({ night_id: n.id, factor_id: f.id, value: f.value }))))],
    );
  }
}
