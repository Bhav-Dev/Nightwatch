import { insertClip } from '../src/data/clipRepo';
import type { Db } from '../src/data/db';
import { addLabel } from '../src/data/labelRepo';
import { planLabellingExport, type LabellingNight } from '../src/data/labellingExport';
import { nightEvents, saveNight } from '../src/data/nightRepo';
import { migrate } from '../src/data/schema';
import { attachSoundToNight, insertSoundSegment } from '../src/data/soundRepo';
import { listTar, tarSize, writeTar, type TarFileReader } from '../src/data/tar';
import { localIsoWithOffset } from '../src/domain/nightDate';
import { analyseNight } from '../src/domain/scoring';
import { evenNight } from './helpers/fixtureNight';
import { openTestDb } from './helpers/nodeDb';

let n = 0;
const newId = () => `id-${++n}`;

/** Fake sound files: path → contents. A path missing here is a file deleted from the phone. */
const files = new Map<string, Uint8Array>();
const fileSize = (path: string) => files.get(path)?.length ?? null;

async function addNight(db: Db, id: string, startedAt: Date, segments: [number, number, number][]) {
  const analysis = analyseNight({ durationS: 2 * 3600, frames: evenNight(2, 0.2, 15) });
  await saveNight(db, { id, startedAt, endedAt: new Date(startedAt.getTime() + 2 * 3600_000), partial: false, analysis, newId });
  for (const [startS, endS, bytes] of segments) {
    const path = `file:///data/sounds/${newId()}.m4a`;
    if (bytes > 0) files.set(path, new Uint8Array(bytes).fill(startS % 251));
    await insertSoundSegment(db, { id: newId(), session_id: `s-${id}`, start_s: startS, end_s: endS, codec: 'aac', path, bytes: Math.max(bytes, 1), created_at: 0 });
  }
  await attachSoundToNight(db, `s-${id}`, id);
  return analysis;
}

async function setup() {
  const db = openTestDb();
  await migrate(db);
  return db;
}

describe('local time with offset', () => {
  const at = Date.UTC(2026, 9, 15, 22, 4, 12, 600);
  it('writes local wall time and the offset', () => {
    expect(localIsoWithOffset(at, 60)).toBe('2026-10-15T23:04:12+01:00');
    expect(localIsoWithOffset(at, -300)).toBe('2026-10-15T17:04:12-05:00');
    expect(localIsoWithOffset(at, 330)).toBe('2026-10-16T03:34:12+05:30');
    expect(localIsoWithOffset(at, 0)).toBe('2026-10-15T22:04:12+00:00');
  });
  it('uses the phone’s offset by default', () => {
    const s = localIsoWithOffset(at);
    const sign = s[19] === '-' ? -1 : 1;
    const offsetMin = sign * (Number(s.slice(20, 22)) * 60 + Number(s.slice(23, 25)));
    expect(new Date(`${s.slice(0, 19)}Z`).getTime() - offsetMin * 60_000).toBe(Math.floor(at / 1000) * 1000);
  });
});

describe('export for labelling', () => {
  const now = new Date(2026, 9, 17, 9, 30);

  it('bundles the last nights with sound, their segments and what the app knew', async () => {
    const db = await setup();
    await addNight(db, 'older', new Date(2026, 9, 13, 23, 0), [[0, 300, 900]]);
    await addNight(db, 'a', new Date(2026, 9, 14, 23, 10), [[0, 300, 1000], [300, 600, 1200]]);
    const analysis = await addNight(db, 'b', new Date(2026, 9, 15, 22, 45), [[10, 310, 700], [400, 500, 0], [600, 650, 300]]);
    await addNight(db, 'silent', new Date(2026, 9, 16, 23, 0), []);
    // Answers on night b: one detected event was not snoring, and a missed stretch was.
    const first = (await nightEvents(db, 'b'))[0];
    await addLabel(db, { id: newId(), nightId: 'b', startS: first.start_s, endS: first.end_s, label: 'not_snore', peakDb: 0, meanDb: 0, source: 'clip', now: 1 });
    await addLabel(db, { id: newId(), nightId: 'b', startS: 7000, endS: 7030, label: 'snore', peakDb: 9, meanDb: 6, source: 'moment', now: 2 });
    await insertClip(db, { id: 'c1', session_id: null, night_id: 'b', start_s: 100, end_s: 115, peak_s: 106, peak_db: 18.04, codec: 'aac', sample_rate: 16000, path: 'x', bytes: 1, created_at: 0 });

    const plan = (await planLabellingExport(db, { count: 3, fileSize, now }))!;
    expect(plan.fileName).toBe('snorehive-labelling-2026-10-17.tar');
    expect(plan.nights.map((x) => x.nightId)).toEqual(['older', 'a', 'b']);

    const b = plan.nights[2];
    expect(b.start).toBe(localIsoWithOffset(new Date(2026, 9, 15, 22, 45).getTime()));
    expect(b.durationS).toBe(7200);
    // The missing file is left out; names follow time order.
    expect(b.segments).toEqual([
      { file: 'segment-001.m4a', startS: 10, endS: 310, bytes: 700 },
      { file: 'segment-002.m4a', startS: 600, endS: 650, bytes: 300 },
    ]);
    // The detector's events, not the corrected night.
    expect(b.events).toHaveLength(analysis.events.length);
    expect(b.events[0]).toMatchObject({ startS: analysis.events[0].startS, endS: analysis.events[0].endS });
    expect(b.answers).toEqual([
      { startS: first.start_s, endS: first.end_s, label: 'not_snore', source: 'clip' },
      { startS: 7000, endS: 7030, label: 'snore', source: 'moment' },
    ]);
    expect(b.clips).toEqual([{ startS: 100, endS: 115, peakS: 106, peakDb: 18, kind: 'snore', saved: false }]);

    const dir = `snorehive-labelling-2026-10-17/${b.start.slice(0, 10)}-${b.start.slice(11, 13)}${b.start.slice(14, 16)}`;
    expect(plan.inputs.map((i) => i.name)).toContain(`${dir}/segment-002.m4a`);
    expect(plan.inputs[0].name).toBe('snorehive-labelling-2026-10-17/export.json');
    expect(plan.totalBytes).toBe(tarSize(plan.inputs.map((i) => i.size)));
    // Nothing personal: no account, email or device in the archive's text.
    expect(new TextDecoder().decode(plan.inputs[0].data)).not.toMatch(/@|device|email/);
  });

  it('takes only the most recent nights asked for, and nothing when no night has sound', async () => {
    const db = await setup();
    expect(await planLabellingExport(db, { count: 7, fileSize, now })).toBeNull();
    await addNight(db, 'a', new Date(2026, 9, 14, 23, 10), [[0, 300, 1000]]);
    await addNight(db, 'b', new Date(2026, 9, 15, 23, 10), [[0, 300, 1000]]);
    expect((await planLabellingExport(db, { count: 1, fileSize, now }))!.nights.map((x) => x.nightId)).toEqual(['b']);
  });

  it('writes an archive the tar reader lists back, with each night.json beside its sound', async () => {
    const db = await setup();
    await addNight(db, 'a', new Date(2026, 9, 14, 23, 10), [[0, 300, 1000], [300, 420, 1500]]);
    const plan = (await planLabellingExport(db, { count: 7, fileSize, now }))!;
    const chunks: Uint8Array[] = [];
    const open = (path: string): TarFileReader => {
      const data = files.get(path)!;
      let at = 0;
      return { read: (k) => data.subarray(at, (at = Math.min(data.length, at + k))), close: () => undefined };
    };
    await writeTar(plan.inputs, (b) => void chunks.push(b.slice()), { mtimeS: 0, open, chunkBytes: 256 });
    const archive = new Uint8Array(plan.totalBytes);
    expect(chunks.reduce((at, c) => (archive.set(c, at), at + c.length), 0)).toBe(plan.totalBytes);

    const entries = listTar((o, l) => archive.subarray(o, o + l), archive.length);
    expect(entries.map((e) => e.name.split('/').slice(2).join('/'))).toEqual(['', 'night.json', 'segment-001.m4a', 'segment-002.m4a']);
    const nightEntry = entries.find((e) => e.name.endsWith('/night.json'))!;
    const night = JSON.parse(new TextDecoder().decode(archive.subarray(nightEntry.offset, nightEntry.offset + nightEntry.size))) as LabellingNight;
    expect(night).toEqual(plan.nights[0]);
    const seg = entries.find((e) => e.name.endsWith('segment-002.m4a'))!;
    expect(seg.size).toBe(1500);
    expect(archive[seg.offset]).toBe(300 % 251);
  });
});
