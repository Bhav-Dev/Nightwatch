import { type AssembledGap, FrameAssembler, int16ToFloat32 } from '../src/domain/audio/frameAssembler';

const SR = 1000; // small rate keeps the tests fast; the assembler is rate-agnostic

function collect() {
  const frames: { t: number; length: number; first: number }[] = [];
  const gaps: AssembledGap[] = [];
  const asm = new FrameAssembler({
    onFrame: (t, s) => frames.push({ t, length: s.length, first: s[0] }),
    onGap: (g) => gaps.push(g),
  });
  return { asm, frames, gaps };
}

const tone = (n: number, value = 0.1) => new Float32Array(n).fill(value);

describe('FrameAssembler', () => {
  it('joins 100 ms buffers into 1-second frames', () => {
    const { asm, frames, gaps } = collect();
    for (let k = 0; k < 25; k++) asm.push(tone(100), SR, k * 0.1);
    expect(frames.map((f) => f.t)).toEqual([0, 1]);
    expect(frames.every((f) => f.length === SR)).toBe(true);
    expect(gaps).toEqual([]);
  });

  it('tolerates jitter in the stream clock', () => {
    const { asm, frames, gaps } = collect();
    for (let k = 0; k < 30; k++) asm.push(tone(100), SR, k * 0.1 + (k % 2 ? 0.4 : -0.05));
    expect(frames).toHaveLength(3);
    expect(gaps).toEqual([]);
  });

  it('reports a clock jump as a stalled gap and realigns to whole seconds', () => {
    const { asm, frames, gaps } = collect();
    for (let k = 0; k < 15; k++) asm.push(tone(100), SR, k * 0.1); // 1.5 s
    // Capture resumes at 10.25 s.
    for (let k = 0; k < 30; k++) asm.push(tone(100, 0.2), SR, 10.25 + k * 0.1);
    expect(gaps).toEqual([{ startS: 1, endS: 11, cause: 'stalled' }]);
    expect(frames.map((f) => f.t)).toEqual([0, 11, 12]);
    expect(frames[1].first).toBeCloseTo(0.2);
  });

  it('turns two or more all-zero seconds into a microphone-taken gap', () => {
    const { asm, frames, gaps } = collect();
    asm.push(tone(SR), SR, 0);
    asm.push(new Float32Array(3 * SR), SR, 1);
    asm.push(tone(SR), SR, 4);
    expect(frames.map((f) => f.t)).toEqual([0, 4]);
    expect(gaps).toEqual([{ startS: 1, endS: 4, cause: 'microphone_taken' }]);
  });

  it('skips a single zero second without reporting a gap', () => {
    const { asm, frames, gaps } = collect();
    asm.push(tone(SR), SR, 0);
    asm.push(new Float32Array(SR), SR, 1);
    asm.push(tone(SR), SR, 2);
    expect(frames.map((f) => f.t)).toEqual([0, 2]);
    expect(gaps).toEqual([]);
  });

  it('closes a trailing silent run at finish', () => {
    const { asm, gaps } = collect();
    asm.push(tone(SR), SR, 0);
    asm.push(new Float32Array(2 * SR), SR, 1);
    asm.finish();
    expect(gaps).toEqual([{ startS: 1, endS: 3, cause: 'microphone_taken' }]);
  });
});

describe('int16ToFloat32', () => {
  it('scales to [-1, 1)', () => {
    const out = int16ToFloat32(new Int16Array([0, 16384, -32768, 32767]).buffer);
    expect(Array.from(out)).toEqual([0, 0.5, -1, 32767 / 32768]);
  });
});
