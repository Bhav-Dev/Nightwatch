import type { Db } from './db';

/**
 * Local store: the source of truth for a user's own data. Audio and clips live only in
 * the file system; clip_path points at them.
 *
 * Deviations from the spec's column names, to avoid SQL keywords:
 * bin.index → bin.idx, snapshot.from/to → from_date/to_date.
 */
const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE night (
    id TEXT PRIMARY KEY NOT NULL,
    date TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    duration_s INTEGER NOT NULL,
    time_in_bed_s INTEGER NOT NULL,
    score INTEGER NOT NULL,
    score_version INTEGER NOT NULL,
    pct_snoring REAL NOT NULL,
    event_count INTEGER NOT NULL,
    max_db REAL NOT NULL,
    floor_db REAL NOT NULL,
    partial INTEGER NOT NULL DEFAULT 0,
    counts_toward_averages INTEGER NOT NULL DEFAULT 1,
    typical INTEGER,
    summary_text TEXT,
    updated_at INTEGER NOT NULL,
    synced_at INTEGER
  );
  CREATE INDEX night_date ON night(date);

  CREATE TABLE event (
    id TEXT PRIMARY KEY NOT NULL,
    night_id TEXT NOT NULL REFERENCES night(id) ON DELETE CASCADE,
    start_s INTEGER NOT NULL,
    end_s INTEGER NOT NULL,
    peak_db REAL NOT NULL,
    mean_db REAL NOT NULL,
    intensity TEXT NOT NULL CHECK (intensity IN ('quiet', 'light', 'loud', 'epic')),
    clip_path TEXT
  );
  CREATE INDEX event_night ON event(night_id);

  CREATE TABLE bin (
    night_id TEXT NOT NULL REFERENCES night(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    mean_db REAL NOT NULL,
    max_db REAL NOT NULL,
    snore_s INTEGER NOT NULL,
    PRIMARY KEY (night_id, idx)
  );

  CREATE TABLE health_sample (
    night_id TEXT NOT NULL REFERENCES night(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('sleep_stage', 'hr', 'hrv', 'spo2', 'resp')),
    start_s INTEGER NOT NULL,
    end_s INTEGER NOT NULL,
    value REAL,
    stage TEXT
  );
  CREATE INDEX health_sample_night ON health_sample(night_id);

  CREATE TABLE health_summary (
    night_id TEXT PRIMARY KEY NOT NULL REFERENCES night(id) ON DELETE CASCADE,
    sleep_efficiency REAL,
    spo2_min REAL,
    spo2_dips INTEGER,
    hr_mean REAL,
    hr_max REAL,
    hrv_mean REAL,
    resp_mean REAL
  );

  CREATE TABLE remedy_log (
    night_id TEXT NOT NULL REFERENCES night(id) ON DELETE CASCADE,
    remedy_id TEXT NOT NULL,
    PRIMARY KEY (night_id, remedy_id)
  );

  CREATE TABLE factor_log (
    night_id TEXT NOT NULL REFERENCES night(id) ON DELETE CASCADE,
    factor_id TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (night_id, factor_id)
  );

  -- Tonight's ticks before a night row exists; moved into remedy_log/factor_log at Stop.
  CREATE TABLE pending_log (
    item_id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('remedy', 'factor')),
    value TEXT
  );

  CREATE TABLE experiment (
    id TEXT PRIMARY KEY NOT NULL,
    remedy_id TEXT NOT NULL,
    started TEXT NOT NULL,
    pattern TEXT NOT NULL,
    status TEXT NOT NULL,
    verdict TEXT
  );

  CREATE TABLE snapshot (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    from_date TEXT NOT NULL,
    to_date TEXT NOT NULL,
    avg_score REAL NOT NULL
  );

  CREATE TABLE profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    age_band TEXT,
    sex TEXT,
    height_band TEXT,
    weight_band TEXT,
    bmi_band TEXT,
    position TEXT,
    pauses_reported TEXT,
    apnoea_dx INTEGER,
    cpap INTEGER,
    version INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE catalogue (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('remedy', 'factor')),
    kind TEXT NOT NULL,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    article_md TEXT NOT NULL DEFAULT '',
    link_url TEXT,
    shop INTEGER NOT NULL DEFAULT 0,
    value_options TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  `,
  // v2: in-progress recordings survive the app being killed; nights remember why they stopped.
  `
  CREATE TABLE recording_session (
    id TEXT PRIMARY KEY NOT NULL,
    started_at INTEGER NOT NULL,
    sensitivity TEXT NOT NULL,
    last_frame_t INTEGER,
    updated_at INTEGER NOT NULL
  );

  -- Per-second features of the recording in progress (never audio). Deleted once the night is saved.
  CREATE TABLE session_frame (
    session_id TEXT NOT NULL REFERENCES recording_session(id) ON DELETE CASCADE,
    t INTEGER NOT NULL,
    level_db REAL NOT NULL,
    centroid_hz REAL NOT NULL,
    envelope TEXT NOT NULL,
    PRIMARY KEY (session_id, t)
  ) WITHOUT ROWID;

  CREATE TABLE session_gap (
    session_id TEXT NOT NULL REFERENCES recording_session(id) ON DELETE CASCADE,
    start_s INTEGER NOT NULL,
    end_s INTEGER NOT NULL,
    cause TEXT NOT NULL
  );

  ALTER TABLE night ADD COLUMN interrupted_at_s INTEGER;
  ALTER TABLE night ADD COLUMN interrupt_cause TEXT;
  `,
  // v3: clips, the on-device model's per-second output, Health import state, sync bookkeeping.
  `
  -- Audio clips around loud moments. The codec is stored per clip so WAV clips can be
  -- transcoded to Opus later without guessing (see src/clips/codec.ts).
  CREATE TABLE clip (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT,
    night_id TEXT REFERENCES night(id) ON DELETE CASCADE,
    start_s INTEGER NOT NULL,
    end_s INTEGER NOT NULL,
    peak_s INTEGER NOT NULL,
    peak_db REAL NOT NULL,
    codec TEXT NOT NULL,
    sample_rate INTEGER NOT NULL,
    path TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    saved INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX clip_night ON clip(night_id);
  CREATE INDEX clip_session ON clip(session_id);

  -- Filled by an on-device model when one runs during capture; null means use the heuristic.
  ALTER TABLE session_frame ADD COLUMN snore_prob REAL;
  ALTER TABLE recording_session ADD COLUMN detector TEXT;

  -- 'local' nights were recorded here; 'remote' nights were pulled from another device and
  -- have no bins, events or clips.
  ALTER TABLE night ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
  ALTER TABLE night ADD COLUMN health_imported_at INTEGER;
  ALTER TABLE night ADD COLUMN detector TEXT;

  -- Amazon product info for shop links (search phrase and per-marketplace ASINs), JSON.
  ALTER TABLE catalogue ADD COLUMN amazon TEXT;

  -- Night ids deleted on this phone that the server still has.
  CREATE TABLE sync_tombstone (
    night_id TEXT PRIMARY KEY NOT NULL
  );

  -- Cached server responses (community snapshot with its ETag, catalogue tags, subscription).
  CREATE TABLE cache (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    etag TEXT,
    fetched_at INTEGER NOT NULL
  );
  `,
  `
  -- Nights under 3 hours in bed now stay out of averages whether or not they were interrupted
  -- (short test recordings were counting). Sync ignores this column, so updated_at stays.
  UPDATE night SET counts_toward_averages = 0 WHERE time_in_bed_s < 10800;
  `,
  `
  -- 'snore' clips overlap snoring events; 'other' clips are the loudest moments that were not
  -- counted as snoring, kept so the user can check what was left out.
  ALTER TABLE clip ADD COLUMN kind TEXT NOT NULL DEFAULT 'snore';
  `,
  `
  -- Compressed audio of the parts of a night with sound in them (silence is not kept), for
  -- playback from the timeline. Times are seconds from the start of the session. Kept on this
  -- phone for a limited number of nights; never synced.
  CREATE TABLE sound_segment (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT,
    night_id TEXT REFERENCES night(id) ON DELETE CASCADE,
    start_s INTEGER NOT NULL,
    end_s INTEGER NOT NULL,
    codec TEXT NOT NULL,
    path TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX sound_segment_night ON sound_segment(night_id);
  CREATE INDEX sound_segment_session ON sound_segment(session_id);
  `,
  `
  -- Sleep sounds played from the phone (generated white, pink or brown noise) and the second,
  -- from the start of the recording, they stopped at. Snoring under them is measured against
  -- the sound rather than the quiet room.
  ALTER TABLE recording_session ADD COLUMN sleep_sound TEXT;
  ALTER TABLE recording_session ADD COLUMN sleep_sound_until_s INTEGER;
  ALTER TABLE night ADD COLUMN sleep_sound TEXT;
  ALTER TABLE night ADD COLUMN sleep_sound_until_s INTEGER;
  `,
  `
  -- The forecast fetched when recording started (MET Norway, for a ~10 km area), kept until
  -- the night is saved. No position is stored, only the rounded area.
  CREATE TABLE session_weather (
    session_id TEXT PRIMARY KEY NOT NULL,
    forecast TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  -- A night's weather: temperature and humidity while recording, and what the morning was like.
  CREATE TABLE night_weather (
    night_id TEXT PRIMARY KEY NOT NULL REFERENCES night(id) ON DELETE CASCADE,
    temp_mean_c REAL,
    temp_min_c REAL,
    humidity_mean REAL,
    morning_symbol TEXT,
    morning_temp_c REAL,
    area TEXT,
    fetched_at INTEGER NOT NULL
  );
  `,
  `
  -- The user's answers to "was this snoring?", one row per answer, applied in order. They are
  -- also the labelled examples the detector will be trained and checked on (kept on this phone).
  CREATE TABLE sound_label (
    id TEXT PRIMARY KEY NOT NULL,
    night_id TEXT NOT NULL REFERENCES night(id) ON DELETE CASCADE,
    start_s INTEGER NOT NULL,
    end_s INTEGER NOT NULL,
    label TEXT NOT NULL CHECK (label IN ('snore', 'not_snore')),
    peak_db REAL NOT NULL,
    mean_db REAL NOT NULL,
    -- What the answer was given on: a clip, or a moment picked on the timeline.
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX sound_label_night ON sound_label(night_id, created_at);
  -- The detector's own events, copied here the first time a night is corrected. The event table
  -- then holds the corrected night, rebuilt from these plus the answers.
  CREATE TABLE event_detected (
    id TEXT PRIMARY KEY NOT NULL,
    night_id TEXT NOT NULL REFERENCES night(id) ON DELETE CASCADE,
    start_s INTEGER NOT NULL,
    end_s INTEGER NOT NULL,
    peak_db REAL NOT NULL,
    mean_db REAL NOT NULL,
    intensity TEXT NOT NULL
  );
  CREATE INDEX event_detected_night ON event_detected(night_id);
  -- The score before any answers, to show what changed.
  ALTER TABLE night ADD COLUMN detector_score INTEGER;
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** The schema's migrations in order (read-only; exported so tests can check a data migration on its own). */
export const MIGRATION_SQL: readonly string[] = MIGRATIONS;

export async function migrate(db: Db): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[v]);
      await db.execAsync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
