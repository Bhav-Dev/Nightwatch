/**
 * The nightly aggregation job (spec: "Aggregation algorithm"). Reads every active
 * contributor's synced nights, runs the shared remedy-effect functions over them, and
 * publishes community figures and per-(segment, window) snapshots for the API to serve.
 *
 * The statistics live in shared/remedyEffect.ts so the app and this job always agree; this
 * file only gathers inputs, groups deltas by segment and window, applies the publication
 * rules and writes the result. computeAggregates is pure, so tests can check it directly.
 */
import type { AggregateRowDto, AggregatesResponse, AggregateWindow, StackRowDto } from '../../../shared/api.ts';
import { EMPTY_PROFILE, type ProfileBands, segmentsFor } from '../../../shared/profile.ts';
import {
  type AggregateStatus,
  communityFigure,
  type Delta,
  distribution,
  EARLY_USERS,
  eligibleNights,
  type NightSummary,
  stackId,
  withinUserDelta,
  withinUserStackDelta,
} from '../../../shared/remedyEffect.ts';
import { type Clock, isoDate } from '../clock.ts';
import { randomId, sha256Hex } from '../crypto.ts';
import { json, type Sql } from '../db/sql.ts';

/** One contributor as the computation sees them: an opaque id, nights and profile bands. */
export interface ContributorInput {
  contributorId: string;
  nights: NightSummary[];
  profile: ProfileBands | null;
}

/** A row of the aggregate table. */
export interface AggregateRecord {
  segment: string;
  time_window: AggregateWindow;
  remedy_id: string;
  status: AggregateStatus;
  users: number;
  nights: number | null;
  median_delta: number | null;
  p25: number | null;
  p75: number | null;
  median_delta_pct: number | null;
  holds_without_alcohol: boolean | null;
  trend: 'better' | 'worse' | 'steady' | null;
  distribution: { bucket: number; count: number }[] | null;
}

export interface StackRecord {
  remedy_a: string;
  remedy_b: string;
  users: number;
  nights: number;
  median_delta: number;
  p25: number;
  p75: number;
}

export interface SnapshotRecord {
  segment: string;
  time_window: AggregateWindow;
  body: AggregatesResponse;
}

export interface ComputeResult {
  rows: AggregateRecord[];
  stacks: StackRecord[];
  snapshots: SnapshotRecord[];
  /** Contributors with enough eligible nights to count. */
  contributors: number;
  sanityFailures: string[];
}

const WINDOWS: AggregateWindow[] = ['all', '90d'];
const WINDOW_DAYS = 90;
/** A 90-day median this many points from the all-time one counts as a trend. */
const TREND_POINTS = 2;
/** Segments (other than 'all') need this many contributors to be published at all. */
const MIN_SEGMENT_USERS = EARLY_USERS;

const round = (x: number | null, dp: number) => (x === null ? null : Math.round(x * 10 ** dp) / 10 ** dp);

/** API shape of an aggregate row: scores to 2 decimal places, snoring fractions to 4. */
export function toRowDto(r: AggregateRecord): AggregateRowDto {
  return {
    remedy_id: r.remedy_id,
    status: r.status,
    users: r.users,
    nights: r.nights,
    median_delta: round(r.median_delta, 2),
    p25: round(r.p25, 2),
    p75: round(r.p75, 2),
    median_delta_pct: round(r.median_delta_pct, 4),
    holds_without_alcohol: r.holds_without_alcohol,
    trend: r.trend,
  };
}

function toStackDto(s: StackRecord): StackRowDto {
  return {
    remedy_ids: [s.remedy_a, s.remedy_b],
    users: s.users,
    nights: s.nights,
    median_delta: round(s.median_delta, 2)!,
    p25: round(s.p25, 2)!,
    p75: round(s.p75, 2)!,
  };
}

const STATUS_RANK: Record<AggregateStatus, number> = { ok: 0, early: 1, hidden: 2 };

/** Best first: published figures by effect size (most negative is the biggest drop), then hidden. */
function compareRows(a: AggregateRecord, b: AggregateRecord): number {
  return (
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    (a.median_delta ?? 0) - (b.median_delta ?? 0) ||
    (a.remedy_id < b.remedy_id ? -1 : 1)
  );
}

const key = (...parts: string[]) => parts.join('\u0000');

function push<K, V>(map: Map<K, V[]>, k: K, v: V) {
  const list = map.get(k);
  if (list) list.push(v);
  else map.set(k, [v]);
}

/**
 * The whole computation, with no I/O. `remedyIds` are the active catalogue remedies; `now`
 * fixes "today" for the 90-day window.
 */
export function computeAggregates(contributors: ContributorInput[], remedyIds: string[], now: Date): ComputeResult {
  const since90 = isoDate(new Date(now.getTime() - WINDOW_DAYS * 86_400_000));
  const remedySet = new Set(remedyIds);

  // (segment, window, remedy) → one delta per contributor.
  const deltas = new Map<string, Delta[]>();
  const stackDeltas = new Map<string, Delta[]>();
  const alcoholDeltas: Delta[] = [];
  const segmentMembers = new Map<string, number>();
  const testingPeople = new Map<string, number>();
  const testingRemedies = new Map<string, Set<string>>();
  let eligibleCount = 0;

  for (const c of contributors) {
    const eligible = eligibleNights(c.nights);
    if (eligible.length === 0) continue;
    eligibleCount++;
    const segments = ['all', ...segmentsFor(c.profile ?? EMPTY_PROFILE)];
    for (const s of segments) segmentMembers.set(s, (segmentMembers.get(s) ?? 0) + 1);

    for (const r of remedyIds) {
      const dAll = withinUserDelta(eligible, r);
      const d90 = withinUserDelta(eligible, r, { withSince: since90 });
      for (const s of segments) {
        if (dAll) push(deltas, key(s, 'all', r), dAll);
        if (d90) push(deltas, key(s, '90d', r), d90);
      }
    }

    const alcohol = withinUserDelta(eligible, 'alcohol', { isFactor: true });
    if (alcohol) alcoholDeltas.push(alcohol);

    // "Testing": who has logged any catalogue remedy, and which.
    const logged = new Set(eligible.flatMap((n) => n.remedies.filter((r) => remedySet.has(r))));
    if (logged.size > 0) {
      for (const s of segments) {
        testingPeople.set(s, (testingPeople.get(s) ?? 0) + 1);
        const set = testingRemedies.get(s) ?? new Set<string>();
        for (const r of logged) set.add(r);
        testingRemedies.set(s, set);
      }
    }

    // Stacks: every pair of remedies this contributor logged on the same night.
    const pairs = new Set<string>();
    for (const n of eligible) {
      const rs = [...new Set(n.remedies.filter((r) => remedySet.has(r)))].sort();
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) pairs.add(key(rs[i], rs[j]));
    }
    for (const p of pairs) {
      const [a, b] = p.split('\u0000');
      const d = withinUserStackDelta(eligible, a, b);
      if (d) push(stackDeltas, p, d);
    }
  }

  // Rows per segment, window and remedy.
  const rows: AggregateRecord[] = [];
  const published = [...segmentMembers]
    .filter(([s, n]) => s === 'all' || n >= MIN_SEGMENT_USERS)
    .map(([s]) => s)
    .sort();
  if (!published.includes('all')) published.unshift('all');

  for (const segment of published) {
    for (const window of WINDOWS) {
      for (const remedy_id of remedyIds) {
        const ds = deltas.get(key(segment, window, remedy_id)) ?? [];
        // Other segments are written only from 10 contributors; 'all' always has a row.
        if (segment !== 'all' && ds.length < MIN_SEGMENT_USERS) continue;
        const fig = communityFigure(ds);
        const hidden = fig.status === 'hidden';
        rows.push({
          segment,
          time_window: window,
          remedy_id,
          status: fig.status,
          users: fig.users,
          nights: hidden ? null : fig.nights,
          median_delta: hidden ? null : fig.median_delta,
          p25: hidden ? null : fig.p25,
          p75: hidden ? null : fig.p75,
          median_delta_pct: hidden ? null : fig.median_delta_pct,
          holds_without_alcohol: hidden ? null : fig.holds_without_alcohol,
          trend: null,
          distribution: segment === 'all' && window === 'all' ? distribution(ds) : null,
        });
      }
    }
  }

  // Trend: last 90 days against all time, when both are at least 'early'. Lower is better.
  const byKey = new Map(rows.map((r) => [key(r.segment, r.time_window, r.remedy_id), r]));
  for (const r of rows) {
    if (r.time_window !== 'all') continue;
    const r90 = byKey.get(key(r.segment, '90d', r.remedy_id));
    if (!r90 || r.status === 'hidden' || r90.status === 'hidden') continue;
    const diff = r90.median_delta! - r.median_delta!;
    const trend = diff <= -TREND_POINTS ? 'better' : diff >= TREND_POINTS ? 'worse' : 'steady';
    r.trend = trend;
    r90.trend = trend;
  }

  // Stacks: whole community, all time, published only once 'ok'.
  const stacks: StackRecord[] = [];
  for (const [p, ds] of stackDeltas) {
    const fig = communityFigure(ds);
    if (fig.status !== 'ok') continue;
    const [remedy_a, remedy_b] = p.split('\u0000');
    stacks.push({
      remedy_a,
      remedy_b,
      users: fig.users,
      nights: fig.nights,
      median_delta: fig.median_delta,
      p25: fig.p25,
      p75: fig.p75,
    });
  }
  stacks.sort((a, b) => a.median_delta - b.median_delta || (stackId(a.remedy_a, a.remedy_b) < stackId(b.remedy_a, b.remedy_b) ? -1 : 1));

  // Sanity checks: known effects must point the right way before anything is published.
  const sanityFailures: string[] = [];
  const alcohol = communityFigure(alcoholDeltas);
  if (alcohol.status === 'ok' && !(alcohol.median_delta > 0)) {
    sanityFailures.push(`alcohol median delta ${alcohol.median_delta.toFixed(2)} is not positive`);
  }
  const side = byKey.get(key('all', 'all', 'side_sleeping'));
  if (side && side.status === 'ok' && !(side.median_delta! < 0)) {
    sanityFailures.push(`side_sleeping median delta ${side.median_delta!.toFixed(2)} is not negative`);
  }

  // Snapshots: one API response per published (segment, window).
  const computedAt = now.toISOString();
  const snapshots: SnapshotRecord[] = [];
  for (const segment of published) {
    for (const window of WINDOWS) {
      const segRows = rows.filter((r) => r.segment === segment && r.time_window === window).sort(compareRows);
      snapshots.push({
        segment,
        time_window: window,
        body: {
          segment,
          window,
          segment_status: 'ok',
          computed_at: computedAt,
          remedies: segRows.map(toRowDto),
          stacks: segment === 'all' && window === 'all' ? stacks.map(toStackDto) : [],
          testing: { people: testingPeople.get(segment) ?? 0, remedies: testingRemedies.get(segment)?.size ?? 0 },
        },
      });
    }
  }

  return { rows, stacks, snapshots, contributors: eligibleCount, sanityFailures };
}

// ---- Loading inputs ----

/** Active = opted in, not withdrawn, not on the exclusion list. */
const ACTIVE = `c.withdrawn_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM contributor_exclusion x WHERE x.contributor_id = c.contributor_id)`;

/**
 * Every active contributor's nights at the current (highest) score version. The queries join
 * contribution to user_id internally; only contributor ids leave the database.
 */
export async function loadContributors(
  sql: Sql,
  excludeDates: string[] = [],
): Promise<{ contributors: ContributorInput[]; scoreVersion: number | null }> {
  const nights = await sql.query<{
    contributor_id: string;
    id: string;
    date: string;
    score: number;
    pct_snoring: number;
    time_in_bed_s: number;
    partial: boolean;
    typical: boolean | null;
    score_version: number;
  }>(
    `SELECT c.contributor_id::text AS contributor_id, n.id, n.date, n.score, n.pct_snoring, n.time_in_bed_s,
            n.partial, n.typical, n.score_version
     FROM contribution c JOIN night_summary n ON n.user_id = c.user_id
     WHERE ${ACTIVE}`,
  );
  const remedies = await sql.query<{ night_id: string; remedy_id: string }>(
    `SELECT r.night_id, r.remedy_id FROM contribution c
     JOIN night_summary n ON n.user_id = c.user_id JOIN remedy_log r ON r.night_id = n.id
     WHERE ${ACTIVE}`,
  );
  const factors = await sql.query<{ night_id: string; factor_id: string; value: string | null }>(
    `SELECT f.night_id, f.factor_id, f.value FROM contribution c
     JOIN night_summary n ON n.user_id = c.user_id JOIN factor_log f ON f.night_id = n.id
     WHERE ${ACTIVE}`,
  );
  const profiles = await sql.query<ProfileBands & { contributor_id: string }>(
    `SELECT c.contributor_id::text AS contributor_id, p.age_band, p.sex, p.height_band, p.weight_band, p.bmi_band,
            p.position, p.pauses_reported, p.apnoea_dx, p.cpap
     FROM contribution c JOIN profile p ON p.user_id = c.user_id
     WHERE ${ACTIVE}`,
  );

  const excluded = new Set(excludeDates);
  const kept = nights.filter((n) => !excluded.has(n.date.slice(0, 10)));
  const scoreVersion = kept.length ? Math.max(...kept.map((n) => n.score_version)) : null;

  const remediesByNight = new Map<string, string[]>();
  for (const r of remedies) push(remediesByNight, r.night_id, r.remedy_id);
  const factorsByNight = new Map<string, { id: string; value: string | null }[]>();
  for (const f of factors) push(factorsByNight, f.night_id, { id: f.factor_id, value: f.value });

  const byContributor = new Map<string, ContributorInput>();
  for (const n of kept) {
    if (n.score_version !== scoreVersion) continue;
    let c = byContributor.get(n.contributor_id);
    if (!c) {
      c = { contributorId: n.contributor_id, nights: [], profile: null };
      byContributor.set(n.contributor_id, c);
    }
    c.nights.push({
      id: n.id,
      date: n.date,
      score: n.score,
      pct_snoring: n.pct_snoring,
      duration_s: n.time_in_bed_s,
      partial: n.partial,
      typical: n.typical,
      remedies: remediesByNight.get(n.id) ?? [],
      factors: factorsByNight.get(n.id) ?? [],
    });
  }
  for (const { contributor_id, ...bands } of profiles) {
    const c = byContributor.get(contributor_id);
    if (c) c.profile = bands;
  }
  // Sorted so the computation sees the same order on every run.
  const contributors = [...byContributor.values()].sort((a, b) => (a.contributorId < b.contributorId ? -1 : 1));
  return { contributors, scoreVersion };
}

// ---- Running and publishing ----

export interface AggregateJobOptions {
  /** Dates (yyyy-mm-dd) whose nights are dropped, e.g. after a bad app release. */
  excludeDates?: string[];
}

export interface AggregateJobResult {
  ok: boolean;
  jobId: string;
  computedAt: string;
  contributors: number;
  aggregateRows: number;
  stackRows: number;
  snapshots: number;
  scoreVersion: number | null;
  message: string | null;
}

const AGGREGATE_COLUMNS = `segment text, time_window text, remedy_id text, status text, users integer, nights integer,
  median_delta double precision, p25 double precision, p75 double precision, median_delta_pct double precision,
  holds_without_alcohol boolean, trend text, distribution jsonb`;
const STACK_COLUMNS = `remedy_a text, remedy_b text, users integer, nights integer, median_delta double precision,
  p25 double precision, p75 double precision`;
const SNAPSHOT_COLUMNS = `segment text, time_window text, body jsonb, etag text, computed_at timestamptz`;


/**
 * Runs the job once. Re-runnable: each run recomputes everything from the synced data and
 * replaces the published tables. On a failed sanity check nothing is published and the
 * failure is recorded in aggregate_job_log.
 */
export async function runAggregation(sql: Sql, clock: Clock, opts: AggregateJobOptions = {}): Promise<AggregateJobResult> {
  const jobId = randomId();
  const started = clock.now();
  const excludeDates = opts.excludeDates ?? [];
  await sql.query(
    `INSERT INTO aggregate_job_log (id, started_at, status, excluded_dates) VALUES ($1, $2::timestamptz, 'running', $3::text::jsonb)`,
    [jobId, started.toISOString(), json(excludeDates)],
  );
  const result: AggregateJobResult = {
    ok: false,
    jobId,
    computedAt: started.toISOString(),
    contributors: 0,
    aggregateRows: 0,
    stackRows: 0,
    snapshots: 0,
    scoreVersion: null,
    message: null,
  };
  const finish = async (status: 'ok' | 'failed', message: string | null, tx: Sql = sql) => {
    result.ok = status === 'ok';
    result.message = message;
    await tx.query(
      `UPDATE aggregate_job_log SET status = $2, finished_at = $3::timestamptz, computed_at = $4::timestamptz,
         contributors = $5, aggregate_rows = $6, stack_rows = $7, snapshots = $8, score_version = $9, message = $10
       WHERE id = $1`,
      [
        jobId,
        status,
        clock.now().toISOString(),
        status === 'ok' ? result.computedAt : null,
        result.contributors,
        result.aggregateRows,
        result.stackRows,
        result.snapshots,
        result.scoreVersion,
        message,
      ],
    );
  };

  try {
    // Housekeeping for tables that only grow. It comes first so a run that publishes nothing
    // still clears them: the privacy policy says these rows last about a day.
    const dayAgo = new Date(started.getTime() - 86_400_000).toISOString();
    await sql.query('DELETE FROM rate_limit WHERE window_start < $1::timestamptz', [dayAgo]);
    await sql.query('DELETE FROM magic_link WHERE expires_at < $1::timestamptz', [dayAgo]);

    const remedyIds = (
      await sql.query<{ id: string }>(`SELECT id FROM catalogue WHERE type = 'remedy' AND active ORDER BY id`)
    ).map((r) => r.id);
    const { contributors, scoreVersion } = await loadContributors(sql, excludeDates);
    const computed = computeAggregates(contributors, remedyIds, started);
    Object.assign(result, {
      contributors: computed.contributors,
      aggregateRows: computed.rows.length,
      stackRows: computed.stacks.length,
      snapshots: computed.snapshots.length,
      scoreVersion,
    });

    if (computed.sanityFailures.length > 0) {
      await finish('failed', `Sanity check failed, nothing published: ${computed.sanityFailures.join('; ')}`);
      return result;
    }

    const snapshots = await Promise.all(
      computed.snapshots.map(async (s) => ({
        ...s,
        etag: `"${(await sha256Hex(JSON.stringify(s.body))).slice(0, 32)}"`,
        computed_at: result.computedAt,
      })),
    );

    // Fill the staging tables, then swap them in, all in one transaction: readers see either
    // last night's figures or tonight's, never a mix.
    await sql.transaction(async (tx) => {
      // Two runs never publish at once. Advisory locks are database-wide, so the key comes from
      // the schema name rather than a constant another app sharing the database might also use.
      await tx.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || '.aggregate'))");
      await tx.exec('DELETE FROM aggregate_next; DELETE FROM aggregate_stack_next; DELETE FROM aggregate_snapshot_next;');
      await tx.query(
        `INSERT INTO aggregate_next SELECT * FROM jsonb_to_recordset($1::text::jsonb) AS x(${AGGREGATE_COLUMNS})`,
        [json(computed.rows)],
      );
      await tx.query(
        `INSERT INTO aggregate_stack_next SELECT * FROM jsonb_to_recordset($1::text::jsonb) AS x(${STACK_COLUMNS})`,
        [json(computed.stacks)],
      );
      await tx.query(
        `INSERT INTO aggregate_snapshot_next SELECT * FROM jsonb_to_recordset($1::text::jsonb) AS x(${SNAPSHOT_COLUMNS})`,
        [json(snapshots)],
      );
      await tx.exec(`
        DELETE FROM aggregate; INSERT INTO aggregate SELECT * FROM aggregate_next;
        DELETE FROM aggregate_stack; INSERT INTO aggregate_stack SELECT * FROM aggregate_stack_next;
        DELETE FROM aggregate_snapshot; INSERT INTO aggregate_snapshot SELECT * FROM aggregate_snapshot_next;
      `);
      await finish('ok', null, tx);
    });

    return result;
  } catch (err) {
    await finish('failed', err instanceof Error ? err.message : String(err)).catch(() => {});
    throw err;
  }
}
