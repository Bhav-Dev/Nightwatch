import { ClipCollector, type ClipCandidate, MAX_CANDIDATES, selectClips } from '../src/clips/clipCollector';
import { MemoryClipFiles } from '../src/clips/clipFiles';
import { type ClipEncoder, registerDecoder, registerEncoder, setPreferredCodec, wavEncoder } from '../src/clips/codec';
import { transcodeClips } from '../src/clips/transcode';
import { insertClip, nightClips } from '../src/data/clipRepo';
import { latestNight } from '../src/data/nightRepo';
import { migrate } from '../src/data/schema';
import { CAPTURE_SAMPLE_RATE, synthesiseNightAudio, type AudioCapture, type CaptureListener } from '../src/native/audioCapture';
import { RecordingSession } from '../src/recording/recordingSession';
import { openTestDb } from './helpers/nodeDb';

const SR = 100;
let n = 0;
const newId = () => `c${++n}`;

function collector() {
  const saved: { c: ClipCandidate; length: number }[] = [];
  const dropped: string[] = [];
  const col = new ClipCollector(
    {
      save: async (c, samples) => {
        saved.push({ c: { ...c }, length: samples.length });
      },
      drop: async (id) => {
        dropped.push(id);
      },
    },
    newId,
  );
  return { col, saved, dropped };
}

const second = () => new Float32Array(SR).fill(0.1);

describe('ClipCollector', () => {
  it('cuts a 15-second clip centred on a loud second', async () => {
    const { col, saved } = collector();
    for (let t = 0; t < 60; t++) col.addSecond(t, second(), SR, t === 30 ? -30 : -60);
    await col.finish();
    expect(saved).toHaveLength(1);
    expect(saved[0].c).toMatchObject({ startS: 23, endS: 38, peakS: 30, peakDb: -30 });
    expect(saved[0].length).toBe(15 * SR);
  });

  it('re-centres on a louder second inside the window', async () => {
    const { col, saved } = collector();
    for (let t = 0; t < 60; t++) col.addSecond(t, second(), SR, t === 30 ? -40 : t === 33 ? -25 : -60);
    await col.finish();
    expect(saved[0].c.peakS).toBe(33);
  });

  it('respects a classifier veto', async () => {
    const { col, saved } = collector();
    for (let t = 0; t < 60; t++) col.addSecond(t, second(), SR, t === 30 ? -30 : -60, t === 30 ? false : null);
    await col.finish();
    expect(saved).toHaveLength(0);
  });

  it(`keeps at most ${MAX_CANDIDATES}, displacing the quietest`, async () => {
    const { col, saved, dropped } = collector();
    for (let t = 0; t < 1000; t++) {
      const loud = t % 40 === 20;
      col.addSecond(t, second(), SR, loud ? -40 + t / 100 : -60);
    }
    await col.finish();
    expect(col.candidates).toHaveLength(MAX_CANDIDATES);
    expect(saved.length - dropped.length).toBe(MAX_CANDIDATES);
    // The loudest (latest) moments survive.
    expect(Math.min(...col.candidates.map((c) => c.peakS))).toBeGreaterThan(500);
  });
});

describe('selectClips', () => {
  it('keeps the five loudest clips that overlap events, plus saved ones', () => {
    const cands = Array.from({ length: 8 }, (_, i) => ({ id: `k${i}`, startS: i * 100, endS: i * 100 + 15, peakDb: i }));
    cands.push({ id: 'saved', startS: 5000, endS: 5015, peakDb: -99, saved: true } as never);
    const events = cands.slice(0, 7).map((c) => ({ startS: c.startS + 5, endS: c.startS + 30 }));
    const { keepIds, clipForEvent } = selectClips(cands, events);
    expect([...keepIds].sort()).toEqual(['k2', 'k3', 'k4', 'k5', 'k6', 'saved']);
    expect(clipForEvent[0]).toBeNull();
    expect(clipForEvent[6]).toBe('k6');
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

describe('clips in a recorded night', () => {
  it('stores WAV clips linked to the night and its events', async () => {
    const db = openTestDb();
    await migrate(db);
    const files = new MemoryClipFiles();
    const capture = new FakeCapture();
    const session = await RecordingSession.begin({ db, capture, sensitivity: 'normal', newId, files });
    for (let s = 0; s < 600; s++) {
      capture.listener!.onWindow({ startS: s, samples: synthesiseNightAudio(s, 1), sampleRate: CAPTURE_SAMPLE_RATE });
    }
    const night = await session.finish();
    const clips = await nightClips(db, night!.nightId);
    expect(clips.length).toBeGreaterThan(0);
    expect(clips.length).toBeLessThanOrEqual(5);
    expect(clips.every((c) => c.codec === 'wav' && files.files.has(c.path))).toBe(true);
    // Files of discarded candidates are gone.
    expect(files.files.size).toBe(clips.length);
    const linked = await db.getAllAsync<{ clip_path: string | null }>('SELECT clip_path FROM event WHERE night_id = ?', [night!.nightId]);
    expect(linked.some((e) => e.clip_path !== null)).toBe(true);
    expect((await latestNight(db))?.detector).toBe('heuristic-v0');
  });
});

describe('codec groundwork', () => {
  it('transcodes stored clips once a new preferred codec is registered', async () => {
    const db = openTestDb();
    await migrate(db);
    const files = new MemoryClipFiles();
    const written = await files.write('a.wav', await wavEncoder.encode(new Float32Array(1600).fill(0.2), 16000));
    await insertClip(db, {
      id: 'a', session_id: null, night_id: null, start_s: 0, end_s: 1, peak_s: 0, peak_db: -20,
      codec: 'wav', sample_rate: 16000, path: written.path, bytes: written.bytes, created_at: 0,
    });

    // Stand-in for a real Opus encoder: tags the bytes so the test can see it ran.
    const fakeOpus: ClipEncoder = { codec: 'opus', extension: 'opus', mimeType: 'audio/ogg', encode: async (s) => new Uint8Array([79, s.length % 256]) };
    registerEncoder(fakeOpus);
    registerDecoder({ codec: 'opus', decode: async () => ({ samples: new Float32Array(1), sampleRate: 16000 }) });
    setPreferredCodec('opus');
    try {
      expect(await transcodeClips(db, files)).toEqual({ converted: 1, failed: 0 });
      expect(await transcodeClips(db, files)).toEqual({ converted: 0, failed: 0 });
      const row = await db.getFirstAsync<{ codec: string; path: string }>("SELECT codec, path FROM clip WHERE id = 'a'", []);
      expect(row).toEqual({ codec: 'opus', path: 'mem://clips/a.opus' });
      expect(files.files.has(written.path)).toBe(false);
    } finally {
      setPreferredCodec('wav');
    }
  });
});
