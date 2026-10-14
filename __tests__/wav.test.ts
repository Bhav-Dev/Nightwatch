import { decodeWav, encodeWav } from '../src/domain/audio/wav';

describe('wav', () => {
  it('round-trips 16-bit mono PCM', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const bytes = encodeWav(samples, 16000);
    expect(bytes.length).toBe(44 + 10);
    const out = decodeWav(bytes);
    expect(out.sampleRate).toBe(16000);
    expect(out.channels).toBe(1);
    Array.from(out.samples).forEach((x, i) => expect(x).toBeCloseTo(samples[i], 3));
  });
});
