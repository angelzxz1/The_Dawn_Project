// The master's loudness, as ITU-R BS.1770-4 and EBU R128 measure it: each
// side K-weighted (a high shelf, then a high pass), its mean square summed
// over 100 ms steps, and from those the momentary loudness (the last
// 400 ms), the short-term (the last 3 s) and the integrated (everything
// since the last reset, gated: blocks under -70 LUFS left out, then those
// more than 10 LU under the rest). Plus the loudest sample since the
// reset. It runs on the audio thread (loudness.ts), so it hears every
// sample however busy the page is. Kept as source text like the
// metronome's kernel; the tests run the same text.

export const LOUDNESS_KERNEL_SOURCE = `
// The K-weighting filters' coefficients at a sample rate (BS.1770's,
// from their analog prototypes, as libebur128 derives them).
function kWeighting(rate) {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / rate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / rate);
  a0 = 1 + K / Q + K * K;
  const highPass = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, highPass];
}

// Loudness (LUFS) from a mean square summed over the sides.
function loudnessOf(meanSquare) {
  return meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : -Infinity;
}

class LoudnessKernel {
  constructor(rate) {
    this.filters = kWeighting(rate);
    this.step = Math.round(rate / 10);
    this.reset();
  }

  reset() {
    // Each side's two filters' states (x1, x2, y1, y2).
    this.state = [0, 1].map(() => this.filters.map(() => [0, 0, 0, 0]));
    this.sum = 0;
    this.count = 0;
    // The last 30 steps' mean squares (3 s), newest last.
    this.steps = [];
    // Every 400 ms block's mean square, one per step, for the integrated.
    this.blocks = [];
    this.peak = 0;
  }

  // One render quantum of each side (a mono input counts as both).
  process(left, right) {
    const sides = right ? [left, right] : [left, left];
    const n = left.length;
    for (let i = 0; i < n; i++) {
      let square = 0;
      for (let s = 0; s < 2; s++) {
        const x = sides[s][i];
        const a = Math.abs(x);
        if (a > this.peak) this.peak = a;
        let v = x;
        for (let f = 0; f < 2; f++) {
          const { b, a: fa } = this.filters[f];
          const st = this.state[s][f];
          const y = b[0] * v + b[1] * st[0] + b[2] * st[1] - fa[0] * st[2] - fa[1] * st[3];
          st[1] = st[0];
          st[0] = v;
          st[3] = st[2];
          st[2] = y;
          v = y;
        }
        square += v * v;
      }
      this.sum += square;
      if (++this.count === this.step) this.endStep();
    }
  }

  endStep() {
    this.steps.push(this.sum / this.count);
    if (this.steps.length > 30) this.steps.shift();
    this.sum = 0;
    this.count = 0;
    if (this.steps.length >= 4) this.blocks.push(this.mean(4));
  }

  // The mean of the last k steps' mean squares (as many as there are).
  mean(k) {
    const last = this.steps.slice(-k);
    return last.length ? last.reduce((t, v) => t + v, 0) / last.length : 0;
  }

  integrated() {
    const absolute = this.blocks.filter((ms) => loudnessOf(ms) > -70);
    if (absolute.length === 0) return -Infinity;
    const gate = loudnessOf(absolute.reduce((t, v) => t + v, 0) / absolute.length) - 10;
    const relative = absolute.filter((ms) => loudnessOf(ms) > gate);
    return relative.length ? loudnessOf(relative.reduce((t, v) => t + v, 0) / relative.length) : -Infinity;
  }

  // The figures now: LUFS (-Infinity for silence) and the peak, 0-1.
  reading() {
    return {
      momentary: this.steps.length >= 4 ? loudnessOf(this.mean(4)) : -Infinity,
      shortTerm: this.steps.length >= 30 ? loudnessOf(this.mean(30)) : -Infinity,
      integrated: this.integrated(),
      peak: this.peak,
    };
  }
}
`;
