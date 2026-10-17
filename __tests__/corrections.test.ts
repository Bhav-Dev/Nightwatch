import { buildMoments, momentAt, neighbour } from '../src/domain/moments';
import { DEFAULT_RECAP_TIME, parseRecapTime, recapAt, recapContent } from '../src/domain/recap';
import { REVIEW_MIN_DAYS_BETWEEN, shouldAskForReview, type ReviewContext } from '../src/domain/reviewPrompt';
import { applyLabels, isSnoringAt, rescoreNight, type SoundLabel } from '../src/domain/scoring/corrections';
import { snoreScore } from '../src/domain/scoring';
import type { SnoreEvent } from '../src/domain/scoring';

const ev = (startS: number, endS: number, peakDb = 22, meanDb = 18): SnoreEvent => ({ startS, endS, peakDb, meanDb, intensity: 'loud' });
const label = (startS: number, endS: number, l: SoundLabel['label'], peakDb = 25, meanDb = 20): SoundLabel => ({ startS, endS, label: l, peakDb, meanDb });

describe('snoring answers', () => {
  it('"not snoring" removes a whole event', () => {
    expect(applyLabels([ev(100, 160), ev(500, 600)], [label(90, 170, 'not_snore')]).map((e) => [e.startS, e.endS])).toEqual([[500, 600]]);
  });

  it('"not snoring" on part of a long event splits it, dropping slivers under 10 s', () => {
    const out = applyLabels([ev(0, 600)], [label(100, 115, 'not_snore'), label(592, 600, 'not_snore')]);
    expect(out.map((e) => [e.startS, e.endS])).toEqual([
      [0, 100],
      [115, 592],
    ]);
  });

  it('"snoring" adds a stretch and merges with snoring it touches', () => {
    const out = applyLabels([ev(100, 160, 22, 18)], [label(150, 200, 'snore', 30, 24), label(1000, 1015, 'snore')]);
    expect(out.map((e) => [e.startS, e.endS, e.intensity])).toEqual([
      [100, 200, 'epic'],
      [1000, 1015, 'loud'],
    ]);
    expect(out[0].peakDb).toBe(30);
    expect(out[0].meanDb).toBeCloseTo((18 * 60 + 24 * 50) / 110);
  });

  it('a later answer for the same stretch wins, so answers can be undone', () => {
    const detected = [ev(100, 160)];
    expect(applyLabels(detected, [label(100, 160, 'not_snore'), label(100, 160, 'snore', 22, 18)]).map((e) => [e.startS, e.endS])).toEqual([[100, 160]]);
  });

  it('rescoring uses the usual formula and refills the timeline bins', () => {
    const events = [ev(0, 3600, 20, 15), ev(4000, 4300, 28, 20)];
    const r = rescoreNight(events, 8 * 3600, 96);
    const pct = 3900 / (8 * 3600);
    expect(r.pctSnoring).toBeCloseTo(pct);
    expect(r.score).toBe(snoreScore(pct, (15 * 3600 + 20 * 300) / 3900));
    expect(r.eventCount).toBe(2);
    expect(r.maxDb).toBe(28);
    expect(r.binSnoreS.slice(0, 12).every((s) => s === 300)).toBe(true);
    expect(r.binSnoreS[12]).toBe(0); // 3600 to 3900: no snoring
    expect(r.binSnoreS[13]).toBe(200); // 4000 to 4200
    expect(r.binSnoreS[14]).toBe(100); // 4200 to 4300
    expect(r.binSnoreS.reduce((a, b) => a + b, 0)).toBe(3900);
  });

  it('knows whether a stretch counts as snoring', () => {
    expect(isSnoringAt([ev(100, 160)], 150, 170)).toBe(true);
    expect(isSnoringAt([ev(100, 160)], 160, 170)).toBe(false);
  });
});

describe('moments', () => {
  const moments = buildMoments({
    snoring: [{ startS: 100, endS: 160, peakDb: 22 }],
    other: [
      { startS: 300, endS: 315, peakDb: 30 },
      { startS: 150, endS: 165, peakDb: 25 }, // overlaps snoring: not a separate moment
      { startS: 305, endS: 330, peakDb: null }, // overlaps the other clip: merged
    ],
    recorded: [
      { startS: 90, endS: 340 },
      { startS: 1000, endS: 1003 }, // too short
      { startS: 2000, endS: 2060 },
    ],
    answered: [{ startS: 300, endS: 330 }],
  });

  it('lists snoring, other sounds and remaining recorded sound in time order', () => {
    expect(moments.map((m) => [m.kind, m.startS, m.endS])).toEqual([
      ['sound', 90, 100],
      ['snore', 100, 160],
      ['sound', 160, 300],
      ['other', 300, 330],
      ['sound', 330, 340],
      ['sound', 2000, 2060],
    ]);
    expect(moments.find((m) => m.kind === 'other')?.answered).toBe(true);
    expect(moments.find((m) => m.kind === 'other')?.peakDb).toBe(30);
  });

  it('steps to the next and previous moment', () => {
    expect(momentAt(moments, 120)?.kind).toBe('snore');
    expect(neighbour(moments, 120, 1)?.startS).toBe(160);
    expect(neighbour(moments, 120, -1)?.startS).toBe(90);
    expect(neighbour(moments, 2010, 1)).toBeNull();
    expect(neighbour(moments, 95, -1)).toBeNull();
    expect(neighbour(moments, 1500, -1)?.startS).toBe(330);
  });
});

describe('recap time', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 17, h, m, 0);

  it('is the chosen time, but never sooner than 90 minutes after stopping', () => {
    expect(recapAt(at(7, 15), '12:30')).toEqual(at(12, 30));
    expect(recapAt(at(11, 45), '12:30')).toEqual(at(13, 15));
    expect(recapAt(at(7, 15), '10:00')).toEqual(at(10, 0));
  });

  it('is skipped when off or when it would land after 9pm', () => {
    expect(recapAt(at(7), 'off')).toBeNull();
    expect(recapAt(at(20), '18:30')).toBeNull();
  });

  it('falls back to the default for unknown settings', () => {
    expect(parseRecapTime(null)).toBe(DEFAULT_RECAP_TIME);
    expect(parseRecapTime('nonsense')).toBe(DEFAULT_RECAP_TIME);
    expect(parseRecapTime('off')).toBe('off');
  });

  it('words the notification', () => {
    expect(recapContent(34, 'Light', 3)).toEqual({ title: 'Last night: 34, light', body: '3 moments to check: were they snoring?' });
    expect(recapContent(10, 'Quiet', 0).body).toBe('Have a look back at your night.');
  });
});

describe('review prompt', () => {
  const now = new Date(2026, 9, 17, 12, 40);
  const base: ReviewContext = {
    now,
    nightsRecorded: 5,
    stoppedAt: new Date(2026, 9, 17, 7, 0),
    nightWasShort: false,
    fromRecap: true,
    engagement: 3,
    correctedShare: 0.1,
    previousAsks: [],
  };

  it('asks at a leisurely, engaged moment', () => {
    expect(shouldAskForReview(base)).toBe(true);
  });

  it('never just after waking, unless they came from the recap', () => {
    const justUp = { ...base, fromRecap: false, now: new Date(2026, 9, 17, 7, 20) };
    expect(shouldAskForReview(justUp)).toBe(false);
    expect(shouldAskForReview({ ...justUp, now: new Date(2026, 9, 17, 9, 30) })).toBe(true);
  });

  it('not before 3 nights, after a short night, without engagement, or after a bad detection night', () => {
    expect(shouldAskForReview({ ...base, nightsRecorded: 2 })).toBe(false);
    expect(shouldAskForReview({ ...base, nightWasShort: true })).toBe(false);
    expect(shouldAskForReview({ ...base, engagement: 1 })).toBe(false);
    expect(shouldAskForReview({ ...base, correctedShare: 0.8 })).toBe(false);
  });

  it(`waits ${REVIEW_MIN_DAYS_BETWEEN} days between asks and at most 3 a year`, () => {
    const day = 86_400_000;
    expect(shouldAskForReview({ ...base, previousAsks: [new Date(now.getTime() - 30 * day)] })).toBe(false);
    expect(shouldAskForReview({ ...base, previousAsks: [new Date(now.getTime() - 130 * day)] })).toBe(true);
    const three = [130, 260, 390].map((d) => new Date(now.getTime() - d * day));
    expect(shouldAskForReview({ ...base, previousAsks: three })).toBe(true); // one is over a year old
    const threeRecent = [125, 250, 360].map((d) => new Date(now.getTime() - d * day));
    expect(shouldAskForReview({ ...base, previousAsks: threeRecent })).toBe(false);
  });
});
