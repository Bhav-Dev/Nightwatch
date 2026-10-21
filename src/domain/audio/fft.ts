/** In-place iterative radix-2 FFT. `re` and `im` must have the same power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) {
    throw new Error('fft: length must be a power of two');
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const r = re[i];
      re[i] = re[j];
      re[j] = r;
      const m = im[i];
      im[i] = im[j];
      im[j] = m;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/**
 * The power spectrum of real blocks of one fixed size, made cheap enough to run on every second
 * of the night: a real block of n samples goes through a complex FFT of n/2 points (even samples
 * as the real part, odd as the imaginary), and the bit-reversal order, twiddle factors and
 * working buffers are worked out once, so nothing is allocated per block. Same result as `fft`
 * on the windowed block, to rounding.
 */
export class RealPowerSpectrum {
  private readonly half: number;
  private readonly rev: Uint32Array;
  /** cos and -sin of 2πk/half, for the complex FFT's butterflies. */
  private readonly twRe: Float64Array;
  private readonly twIm: Float64Array;
  /** cos and sin of 2πk/n, for splitting the half-size result into the real block's spectrum. */
  private readonly splitRe: Float64Array;
  private readonly splitIm: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(readonly n: number) {
    if (n < 4 || (n & (n - 1)) !== 0) throw new Error('RealPowerSpectrum: size must be a power of two, 4 or more');
    const m = n >> 1;
    this.half = m;
    this.rev = new Uint32Array(m);
    for (let i = 1, j = 0; i < m; i++) {
      let bit = m >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      this.rev[i] = j;
    }
    this.twRe = new Float64Array(m >> 1);
    this.twIm = new Float64Array(m >> 1);
    for (let k = 0; k < m >> 1; k++) {
      this.twRe[k] = Math.cos((2 * Math.PI * k) / m);
      this.twIm[k] = -Math.sin((2 * Math.PI * k) / m);
    }
    this.splitRe = new Float64Array(m + 1);
    this.splitIm = new Float64Array(m + 1);
    for (let k = 0; k <= m; k++) {
      this.splitRe[k] = Math.cos((2 * Math.PI * k) / n);
      this.splitIm[k] = Math.sin((2 * Math.PI * k) / n);
    }
    this.re = new Float64Array(m);
    this.im = new Float64Array(m);
  }

  /**
   * Adds |X[k]|² × gain[k] to out[k] for k = 1 … n/2, where X is the DFT of
   * samples[offset … offset + n) multiplied by `window`. out and gain need n/2 + 1 entries.
   */
  accumulate(samples: Float32Array, offset: number, window: Float64Array, gain: Float64Array, out: Float64Array): void {
    const m = this.half;
    const re = this.re;
    const im = this.im;
    const rev = this.rev;
    // Window and pack: z[i] = x[2i] + i·x[2i+1], stored in bit-reversed order.
    for (let i = 0; i < m; i++) {
      const s = offset + 2 * i;
      const r = rev[i];
      re[r] = samples[s] * window[2 * i];
      im[r] = samples[s + 1] * window[2 * i + 1];
    }
    // The first stage's twiddle is 1.
    for (let i = 0; i < m; i += 2) {
      const ar = re[i];
      const ai = im[i];
      const br = re[i + 1];
      const bi = im[i + 1];
      re[i] = ar + br;
      im[i] = ai + bi;
      re[i + 1] = ar - br;
      im[i + 1] = ai - bi;
    }
    const twRe = this.twRe;
    const twIm = this.twIm;
    for (let size = 4; size <= m; size <<= 1) {
      const h = size >> 1;
      const step = m / size;
      for (let j = 0; j < h; j++) {
        const wr = twRe[j * step];
        const wi = twIm[j * step];
        for (let a = j; a < m; a += size) {
          const b = a + h;
          const xr = re[b];
          const xi = im[b];
          const br = xr * wr - xi * wi;
          const bi = xr * wi + xi * wr;
          const ar = re[a];
          const ai = im[a];
          re[b] = ar - br;
          im[b] = ai - bi;
          re[a] = ar + br;
          im[a] = ai + bi;
        }
      }
    }
    // Split: X[k] = E[k] + e^(-2πik/n)·O[k], with E and O from Z[k] and conj(Z[m-k]).
    const cr = this.splitRe;
    const ci = this.splitIm;
    for (let k = 1; k <= m; k++) {
      const zr = re[k === m ? 0 : k];
      const zi = im[k === m ? 0 : k];
      const wr = re[m - k];
      const wi = im[m - k];
      const er = 0.5 * (zr + wr);
      const ei = 0.5 * (zi - wi);
      const or = 0.5 * (zi + wi);
      const oi = -0.5 * (zr - wr);
      const xr = er + cr[k] * or + ci[k] * oi;
      const xi = ei + cr[k] * oi - ci[k] * or;
      out[k] += (xr * xr + xi * xi) * gain[k];
    }
  }
}
