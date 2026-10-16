import { MemoryClipFiles } from '../src/clips/clipFiles';
import { saveNight } from '../src/data/nightRepo';
import { migrate } from '../src/data/schema';
import { attachSoundToNight, insertSoundSegment, nightSoundSegments, sessionSoundSegments } from '../src/data/soundRepo';
import { analyseNight } from '../src/domain/scoring';
import { CAPTURE_SAMPLE_RATE, synthesiseNightAudio, type AudioCapture, type CaptureListener } from '../src/native/audioCapture';
import { RecordingSession } from '../src/recording/recordingSession';
import {
  SOUND_HANGOVER_S,
  SOUND_MAX_SEGMENT_S,
  SOUND_PRE_ROLL_S,
  type SegmentWriter,
  type SoundSegment,
  SoundRecorder,
  toPcm16,
} from '../src/recording/soundRecorder';
import { pruneOldSound } from '../src/recording/soundRetention';
import { evenNight } from './helpers/fixtureNight';
import { openTestDb } from './helpers/nodeDb';

const RATE = 100; // a tiny "sample rate" keeps the recorder tests fast; the logic is per second
const QUIET = -60;
const LOUD = -40;

/** Records what the encoder was asked to do; each segment's size is 2 bytes per sample. */
class FakeWriter implements SegmentWriter {
  readonly calls: string[] = [];
  private samples = 0;
  private id = '';
  constructor(private readonly emptyIds: Set<string> = new Set()) {}
  begin(id: string) {
    this.id = id;
    this.samples = 0;
    this.calls.push(`begin ${id}`);
  }
  write(pcm: Int16Array) {
    this.samples += pcm.length;
  }
  async end() {
    this.calls.push(`end ${this.id}`);
    return { path: `mem://sounds/${this.id}.m4a`, bytes: this.emptyIds.has(this.id) ? 0 : this.samples * 2 };
  }
}

function recorder(writer: SegmentWriter = new FakeWriter()) {
  let n = 0;
  const segments: SoundSegment[] = [];
  const rec = new SoundRecorder(writer, () => `s${++n}`, async (s) => void segments.push(s));
  const feed = (levels: Record<number, number>, fromT: number, toT: number) => {
    for (let t = fromT; t < toT; t++) rec.addSecond(t, new Float32Array(RATE), RATE, levels[t] ?? QUIET);
  };
  return { rec, segments, feed };
}

const loudBetween = (from: number, to: number) => Object.fromEntries(Array.from({ length: to - from }, (_, i) => [from + i, LOUD]));

describe('sound recorder', () => {
  it('keeps a stretch of sound with a lead-in and a quiet tail, and nothing else', async () => {
    const { rec, segments, feed } = recorder();
    feed(loudBetween(10, 13), 0, 60);
    await rec.finish();
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ startS: 10 - SOUND_PRE_ROLL_S, endS: 12 + SOUND_HANGOVER_S + 1 });
    expect(segments[0].bytes).toBe((segments[0].endS - segments[0].startS) * RATE * 2);
  });

  it('carries on through the short pauses between snores', async () => {
    const { rec, segments, feed } = recorder();
    // A snore every 4 seconds for two minutes: one segment, not thirty.
    const snores = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [100 + i * 4, LOUD]));
    feed(snores, 0, 300);
    await rec.finish();
    expect(segments).toHaveLength(1);
    expect(segments[0].startS).toBe(100 - SOUND_PRE_ROLL_S);
  });

  it('splits continuous sound into capped segments with no gap between them', async () => {
    const { rec, segments, feed } = recorder();
    feed(loudBetween(20, 20 + 2 * SOUND_MAX_SEGMENT_S + 50), 0, 20 + 2 * SOUND_MAX_SEGMENT_S + 100);
    await rec.finish();
    expect(segments.length).toBe(3);
    expect(segments[0].endS - segments[0].startS).toBe(SOUND_MAX_SEGMENT_S);
    expect(segments[1].startS).toBe(segments[0].endS);
    expect(segments[2].startS).toBe(segments[1].endS);
  });

  it('ends a segment where an interruption starts', async () => {
    const { rec, segments, feed } = recorder();
    feed(loudBetween(5, 9), 0, 9);
    feed(loudBetween(50, 52), 50, 70);
    await rec.finish();
    expect(segments.map((s) => [s.startS, s.endS])).toEqual([
      [2, 9],
      [50, 52 + SOUND_HANGOVER_S],
    ]);
  });

  it('closes an open segment at Stop, and drops segments the encoder could not use', async () => {
    const writer = new FakeWriter(new Set(['s1']));
    const { rec, segments, feed } = recorder(writer);
    feed(loudBetween(5, 7), 0, 30);
    feed(loudBetween(40, 45), 30, 45);
    await rec.finish();
    expect(writer.calls).toEqual(['begin s1', 'end s1', 'begin s2', 'end s2']);
    expect(segments.map((s) => s.id)).toEqual(['s2']);
  });

  it('converts float samples to 16-bit, clipping overloads', () => {
    expect([...toPcm16(new Float32Array([0, 0.5, -1, 1.5]))]).toEqual([0, 16384, -32767, 32767]);
  });
});

class FakeCapture implements AudioCapture {
  listener: CaptureListener | null = null;
  async requestPermission() {
    return true;
  }
  async start(l: CaptureListener) {
    this.listener = l;
  }
  async stop() {}
  isRecording() {
    return true;
  }
}

describe('sound in a recorded night', () => {
  let n = 0;
  const newId = () => `id-${++n}`;

  it('stores the night’s sound segments and attaches them to the night', async () => {
    const db = openTestDb();
    await migrate(db);
    const capture = new FakeCapture();
    const session = await RecordingSession.begin({ db, capture, sensitivity: 'normal', newId, sound: new FakeWriter() });
    // Ten minutes of the synthetic night: background noise with a stretch of snoring.
    for (let s = 0; s < 600; s++) capture.listener!.onWindow({ startS: s, samples: synthesiseNightAudio(s, 1), sampleRate: CAPTURE_SAMPLE_RATE });
    const night = await session.finish();
    const segments = await nightSoundSegments(db, night!.nightId);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((s) => s.codec === 'aac' && s.bytes > 0 && s.end_s > s.start_s)).toBe(true);
    // Silence is not kept: the segments cover less than the whole recording.
    expect(segments.reduce((sum, s) => sum + s.end_s - s.start_s, 0)).toBeLessThan(600);
  });

  it('throws the sound away with a discarded recording', async () => {
    const db = openTestDb();
    await migrate(db);
    const files = new MemoryClipFiles();
    const capture = new FakeCapture();
    const session = await RecordingSession.begin({ db, capture, sensitivity: 'normal', newId, files, sound: new FakeWriter() });
    for (let s = 0; s < 300; s++) capture.listener!.onWindow({ startS: s, samples: synthesiseNightAudio(s, 1), sampleRate: CAPTURE_SAMPLE_RATE });
    await session.discard();
    expect(await db.getAllAsync('SELECT * FROM sound_segment', [])).toEqual([]);
    expect(await sessionSoundSegments(db, session.id)).toEqual([]);
  });

  it('deletes sound older than the keeping period, and keeps the night', async () => {
    const db = openTestDb();
    await migrate(db);
    const now = new Date(2026, 9, 16, 9, 0);
    const nowS = Math.floor(now.getTime() / 1000);
    for (const [id, ageDays] of [['old', 31], ['recent', 5]] as const) {
      const startedAt = new Date(now.getTime() - ageDays * 86_400_000);
      const analysis = analyseNight({ durationS: 8 * 3600, frames: evenNight(8, 0.2, 15) });
      await saveNight(db, { id, startedAt, endedAt: new Date(startedAt.getTime() + 8 * 3600_000), partial: false, analysis, newId });
      await insertSoundSegment(db, { id: `seg-${id}`, session_id: `session-${id}`, start_s: 0, end_s: 60, codec: 'aac', path: `mem://sounds/${id}.m4a`, bytes: 1000, created_at: nowS });
      await attachSoundToNight(db, `session-${id}`, id);
    }
    const removed: string[] = [];
    expect(await pruneOldSound(db, (p) => void removed.push(p), now)).toBe(1);
    expect(removed).toEqual(['mem://sounds/old.m4a']);
    expect(await nightSoundSegments(db, 'recent')).toHaveLength(1);
    expect(await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM night WHERE id = 'old'", [])).toEqual({ n: 1 });
  });
});
