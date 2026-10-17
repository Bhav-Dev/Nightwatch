import { localDateKey, localIsoWithOffset } from '../domain/nightDate';
import type { SoundLabelValue } from '../domain/scoring/corrections';
import { nightClips } from './clipRepo';
import type { Db } from './db';
import { detectedEvents, nightLabels } from './labelRepo';
import type { NightRow } from './nightRepo';
import { nightSoundSegments } from './soundRepo';
import { tarSize, type TarInput } from './tar';

/**
 * Export for labelling (internal builds): the last few nights' sound with what the app knew
 * about each night, as one tar archive for tools/labelling/fromApp.ts. Layout:
 *
 *   snorehive-labelling-<date>/export.json
 *   snorehive-labelling-<date>/<yyyy-mm-dd-hhmm>/night.json
 *   snorehive-labelling-<date>/<yyyy-mm-dd-hhmm>/segment-001.m4a ...
 *
 * Names carry dates only, never the user's name or account. Every time in night.json is in
 * seconds from the start of the recording.
 */

export const LABELLING_EXPORT_VERSION = 1;
export const LABELLING_EXPORT_FORMAT = 'snorehive-labelling';

export interface LabellingNight {
  version: typeof LABELLING_EXPORT_VERSION;
  nightId: string;
  /** When recording started: local time with the phone's UTC offset. */
  start: string;
  /** Seconds from the start of the recording to Stop. */
  durationS: number;
  partial: boolean;
  detector: string | null;
  /** Sleep sounds played from the phone until `untilS`. */
  sleepSound: { kind: string; untilS: number } | null;
  /** The recorded sound in time order, [startS, endS). Seconds outside every segment were not recorded. */
  segments: { file: string; startS: number; endS: number; bytes: number }[];
  /** What the detector found, before any of the user's answers. */
  events: { startS: number; endS: number; peakDb: number; meanDb: number }[];
  /** Answers to "was this snoring?" in the order given; a later answer for the same stretch wins. */
  answers: { startS: number; endS: number; label: SoundLabelValue; source: string }[];
  /** Clips kept for the night: 'snore' overlapped detected snoring, 'other' was a loud moment that did not. */
  clips: { startS: number; endS: number; peakS: number; peakDb: number; kind: string; saved: boolean }[];
}

export interface LabellingExportPlan {
  fileName: string;
  nights: LabellingNight[];
  /** The archive's files in order, for writeTar. */
  inputs: TarInput[];
  /** Exact size of the archive. */
  totalBytes: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const utf8 = (s: string) => new TextEncoder().encode(s);

/** "2026-10-15T23:04:12+01:00" → "2026-10-15-2304". */
function nightDirName(start: string): string {
  return `${start.slice(0, 10)}-${start.slice(11, 13)}${start.slice(14, 16)}`;
}

/**
 * Plans an export of the last `count` nights that have recorded sound: the archive's name,
 * contents and exact size. `fileSize` gives a sound file's size on this phone, or null when it is
 * missing (those segments are left out). Resolves null when there is nothing to export.
 */
export async function planLabellingExport(
  db: Db,
  opts: { count: number; fileSize: (path: string) => number | null; now?: Date },
): Promise<LabellingExportPlan | null> {
  const rows = await db.getAllAsync<NightRow>(
    `SELECT * FROM night n WHERE EXISTS (SELECT 1 FROM sound_segment s WHERE s.night_id = n.id)
     ORDER BY started_at DESC LIMIT ?`,
    [opts.count],
  );
  const now = opts.now ?? new Date();
  const root = `${LABELLING_EXPORT_FORMAT}-${localDateKey(now)}`;
  const nights: LabellingNight[] = [];
  const dirs: string[] = [];
  const files: TarInput[] = [];
  for (const n of rows.reverse()) {
    const segments: LabellingNight['segments'] = [];
    const sound: TarInput[] = [];
    for (const s of await nightSoundSegments(db, n.id)) {
      const bytes = opts.fileSize(s.path);
      if (bytes === null || bytes <= 0) continue;
      const ext = /\.[a-z0-9]+$/i.exec(s.path)?.[0] ?? '.m4a';
      const file = `segment-${String(segments.length + 1).padStart(3, '0')}${ext}`;
      segments.push({ file, startS: s.start_s, endS: s.end_s, bytes });
      sound.push({ name: file, size: bytes, path: s.path });
    }
    if (segments.length === 0) continue;

    const start = localIsoWithOffset(n.started_at * 1000);
    let dir = nightDirName(start);
    for (let k = 2; dirs.includes(dir); k++) dir = `${nightDirName(start)}-${k}`;
    dirs.push(dir);
    const night: LabellingNight = {
      version: LABELLING_EXPORT_VERSION,
      nightId: n.id,
      start,
      durationS: n.duration_s,
      partial: n.partial === 1,
      detector: n.detector,
      sleepSound: n.sleep_sound && n.sleep_sound_until_s !== null ? { kind: n.sleep_sound, untilS: n.sleep_sound_until_s } : null,
      segments,
      events: (await detectedEvents(db, n.id)).map((e) => ({ startS: e.startS, endS: e.endS, peakDb: round1(e.peakDb), meanDb: round1(e.meanDb) })),
      answers: (await nightLabels(db, n.id)).map((l) => ({ startS: l.start_s, endS: l.end_s, label: l.label, source: l.source })),
      clips: (await nightClips(db, n.id))
        .sort((a, b) => a.start_s - b.start_s)
        .map((c) => ({ startS: c.start_s, endS: c.end_s, peakS: c.peak_s, peakDb: round1(c.peak_db), kind: c.kind, saved: c.saved === 1 })),
    };
    nights.push(night);
    const json = utf8(JSON.stringify(night, null, 2) + '\n');
    files.push({ name: `${root}/${dir}/night.json`, size: json.length, data: json });
    for (const s of sound) files.push({ ...s, name: `${root}/${dir}/${s.name}` });
  }
  if (nights.length === 0) return null;

  const index = utf8(
    JSON.stringify({ format: LABELLING_EXPORT_FORMAT, version: LABELLING_EXPORT_VERSION, exportedAt: localIsoWithOffset(now.getTime()), nights: dirs }, null, 2) + '\n',
  );
  const inputs = [{ name: `${root}/export.json`, size: index.length, data: index }, ...files];
  return { fileName: `${root}.tar`, nights, inputs, totalBytes: tarSize(inputs.map((i) => i.size)) };
}
