// The Crusher's DSP: a character compressor after the classic modern
// "distortion compressor" of the 90s, the one engineers reach for to
// flatten a room mic, thicken a bass or make a vocal sit forward. Kept as
// source text because it runs inside an AudioWorklet (crusher.ts); the
// unit tests evaluate this same text.
//
// - Input drives the audio into a fixed threshold (-10 dBFS), so more
//   Input is more compression; Output sets the level after. With both at
//   5 the level is where it started, before any compression.
// - Attack (0.05-30 ms) and Release (50 ms-3.5 s) read 0-10, slow at 10.
// - Ratio steps through 1:1 (no compression, for the distortion alone),
//   2:1, 3, 4, 6, 10, 20:1 and Nuke (a brick wall). The knee hardens as
//   the ratio rises: 14 dB wide at 2:1, none at Nuke. At 2:1 the release
//   is opto-like: a slow second envelope holds what's been compressed
//   long and hard, so it lets go fast after a peak and slowly after a
//   squash.
// - British Mode takes over the ratio: past the threshold the loudest
//   hits come out lower than the softer ones (a slope past infinity:1, as
//   with every ratio button of a vintage British limiter pressed in), with
//   a 3 dB knee and the release twice as fast.
// - Dist 2 adds mostly even harmonics (tube-like), Dist 3 mostly odd
//   (tape-like), on the compressed signal: more as it's driven harder.
//   Fast releases add their own low-frequency distortion, as the gain
//   follows the waveform.
// - The detector hears the input after Input, through the HP filter (6
//   dB/oct below 100 Hz, so the low end doesn't pump everything) and the
//   Band emphasis (+8 dB around 6.8 kHz, so sibilance compresses most: a
//   de-esser). Both channels are linked: the louder sets the gain.
// - The gain, the distortion and Mix (dry against processed) run at twice
//   the sample rate (a 31-tap filter each way, 15 samples of latency), so
//   the distortion's harmonics don't fold back as aliasing.

/** Ratio steps: their labels, and how much of "dB over the threshold" is
 * taken off (1 - 1/ratio). */
export const CRUSHER_RATIO_LABELS = ["1:1", "2:1", "3:1", "4:1", "6:1", "10:1", "20:1", "Nuke"];
const SLOPES = [0, 1 / 2, 2 / 3, 3 / 4, 5 / 6, 9 / 10, 19 / 20, 1];
/** Knee width (dB) per ratio step. */
const KNEES = [0, 14, 10, 8, 6, 4, 2, 0];
/** British Mode: the slope past the threshold, and its knee. */
const BRITISH_SLOPE = 1.15;
const BRITISH_KNEE = 3;
export const CRUSHER_DISTS = ["clean", "dist2", "dist3"] as const;
export type CrusherDist = (typeof CRUSHER_DISTS)[number];
export const CRUSHER_DIST_LABELS: Record<CrusherDist, string> = { clean: "Clean", dist2: "Dist 2", dist3: "Dist 3" };
/** The fixed threshold Input drives into, dBFS. */
export const CRUSHER_THRESHOLD_DB = -10;
/** Oversampling's latency, in samples at the base rate. */
export const CRUSHER_LATENCY = 15;

const clampStep = (v: number, n: number) => Math.max(0, Math.min(n - 1, Math.round(v)));
const knob = (v: number) => Math.max(0, Math.min(10, v)) / 10;

export const crusherRatioIndex = (v: number | undefined) => clampStep(v ?? 3, SLOPES.length);
export const crusherDist = (v: number | undefined): CrusherDist => CRUSHER_DISTS[clampStep(v ?? 0, CRUSHER_DISTS.length)];
/** Input's gain, dB, for its knob. */
export const crusherInputDb = (v: number) => 40 * knob(v) - 10;
/** Output's gain, dB, for its knob. */
export const crusherOutputDb = (v: number) => 40 * knob(v) - 30;
/** Attack, seconds, for its knob. */
export const crusherAttack = (v: number) => 0.00005 * Math.pow(600, knob(v));
/** Release, seconds, for its knob. */
export const crusherRelease = (v: number) => 0.05 * Math.pow(70, knob(v));

export const formatCrusherAttack = (v: number) => {
  const ms = crusherAttack(v) * 1000;
  return `${ms < 1 ? ms.toFixed(2) : ms < 10 ? ms.toFixed(1) : ms.toFixed(0)} ms`;
};
export const formatCrusherRelease = (v: number) => {
  const s = crusherRelease(v);
  return s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`;
};

export interface CrusherSettings {
  inputDb: number;
  outputDb: number;
  /** Seconds. */
  attack: number;
  /** Seconds. */
  release: number;
  /** dB taken off per dB over the threshold. */
  slope: number;
  kneeDb: number;
  /** The 2:1 step's two-stage release. */
  opto: boolean;
  /** 0 Clean, 1 Dist 2, 2 Dist 3. */
  dist: number;
  detHp: boolean;
  detBand: boolean;
  mix: number;
}

export function crusherSettingsFromParams(params: Record<string, number>): CrusherSettings {
  const british = (params.british ?? 0) >= 0.5;
  const ratio = crusherRatioIndex(params.ratio);
  const release = crusherRelease(params.release ?? 5);
  return {
    inputDb: crusherInputDb(params.input ?? 5),
    outputDb: crusherOutputDb(params.output ?? 5),
    attack: crusherAttack(params.attack ?? 5),
    release: british ? release / 2 : release,
    slope: british ? BRITISH_SLOPE : SLOPES[ratio],
    kneeDb: british ? BRITISH_KNEE : KNEES[ratio],
    opto: !british && ratio === 1,
    dist: CRUSHER_DISTS.indexOf(crusherDist(params.dist)),
    detHp: (params.detHp ?? 0) >= 0.5,
    detBand: (params.detBand ?? 0) >= 0.5,
    mix: Math.max(0, Math.min(1, params.mix ?? 1)),
  };
}

/** The gain reduction (dB, >= 0) for a level `x` dB, as the settings'
 * static curve has it (no attack or release): for the window's curve. */
export function crusherCurve(s: CrusherSettings, x: number): number {
  return s.slope * crusherKnee(x - CRUSHER_THRESHOLD_DB, s.kneeDb);
}

function crusherKnee(d: number, w: number): number {
  if (2 * d >= w) return d;
  if (w > 0 && 2 * d > -w) return ((d + w / 2) * (d + w / 2)) / (2 * w);
  return 0;
}

export const CRUSHER_SOURCE = `
const CR_DB = Math.LN10 / 20;
const CR_TAPS = 31;
const CR_T = ${CRUSHER_THRESHOLD_DB};
// Dist 2: an offset tanh, unity slope at rest (mostly 2nd harmonic).
const CR_K2 = 0.6;
const CR_B2 = 0.3;
const CR_T2 = Math.tanh(CR_K2 * CR_B2);
const CR_N2 = 1 / (CR_K2 * (1 - CR_T2 * CR_T2));
// Dist 3: a symmetric tanh (mostly 3rd).
const CR_K3 = 1.3;

// Low-pass for 2x oversampling: windowed sinc at the base rate's Nyquist.
const CR_FIR = (() => {
  const h = new Float64Array(CR_TAPS);
  const m = (CR_TAPS - 1) / 2;
  let sum = 0;
  for (let i = 0; i < CR_TAPS; i++) {
    const t = i - m;
    const sinc = t === 0 ? 0.5 : Math.sin(Math.PI * 0.5 * t) / (Math.PI * t);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (CR_TAPS - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (CR_TAPS - 1));
    h[i] = sinc * w;
    sum += h[i];
  }
  for (let i = 0; i < CR_TAPS; i++) h[i] /= sum;
  return h;
})();

class CrusherFir {
  constructor() {
    this.buf = new Float64Array(CR_TAPS * 2);
    this.pos = 0;
  }
  push(x) {
    this.pos = (this.pos + 1) % CR_TAPS;
    this.buf[this.pos] = x;
    this.buf[this.pos + CR_TAPS] = x;
  }
  out() {
    let y = 0;
    const b = this.buf;
    const p = this.pos + 1;
    for (let i = 0; i < CR_TAPS; i++) y += CR_FIR[i] * b[p + i];
    return y;
  }
}

// A biquad (transposed direct form II), a state per channel.
class CrusherBiquad {
  constructor(b0, b1, b2, a1, a2) {
    this.b0 = b0;
    this.b1 = b1;
    this.b2 = b2;
    this.a1 = a1;
    this.a2 = a2;
    this.z1 = new Float64Array(2);
    this.z2 = new Float64Array(2);
  }
  run(x, c) {
    const y = this.b0 * x + this.z1[c];
    this.z1[c] = this.b1 * x - this.a1 * y + this.z2[c];
    this.z2[c] = this.b2 * x - this.a2 * y;
    return y;
  }
}

// First-order high-pass (bilinear).
function crusherHighpass(f, sr) {
  const k = Math.tan((Math.PI * f) / sr);
  const n = 1 / (1 + k);
  return new CrusherBiquad(n, -n, 0, (k - 1) * n, 0);
}

// A peaking boost (the cookbook's).
function crusherPeak(f, q, db, sr) {
  const a = Math.pow(10, db / 40);
  const w = (2 * Math.PI * f) / sr;
  const cs = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha / a;
  return new CrusherBiquad((1 + alpha * a) / a0, (-2 * cs) / a0, (1 - alpha * a) / a0, (-2 * cs) / a0, (1 - alpha / a) / a0);
}

function crusherKnee(d, w) {
  if (2 * d >= w) return d;
  if (w > 0 && 2 * d > -w) return ((d + w / 2) * (d + w / 2)) / (2 * w);
  return 0;
}

class CrusherKernel {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.hp = crusherHighpass(100, sampleRate);
    this.band = crusherPeak(Math.min(6800, sampleRate * 0.45), 1.4, 8, sampleRate);
    this.slowAtk = Math.exp(-1 / (0.4 * sampleRate));
    // The DC blocker after Dist 2, at the doubled rate.
    this.dcR = Math.exp((-2 * Math.PI * 8) / (2 * sampleRate));
    this.dcX = new Float64Array(2);
    this.dcY = new Float64Array(2);
    this.gr = 0;
    this.slow = 0;
    this.gain = 1;
    this.smooth = 1 - Math.exp(-1 / (0.01 * sampleRate));
    this.inG = 1;
    this.outG = 1;
    this.wet = 1;
    this.started = false;
    this.upL = new CrusherFir();
    this.upR = new CrusherFir();
    this.downL = new CrusherFir();
    this.downR = new CrusherFir();
    // Meters, read and reset by the processor.
    this.meterGr = 0;
    this.meterOut = 0;
    this.meterIn = 0;
  }

  set(s) {
    const sr = this.sr;
    this.slope = s.slope;
    this.knee = s.kneeDb;
    this.opto = !!s.opto;
    this.atk = Math.exp(-1 / (Math.max(0.000005, s.attack) * sr));
    this.rel = Math.exp(-1 / (Math.max(0.001, s.release) * sr));
    this.slowRel = Math.exp(-1 / ((0.5 + 4 * s.release) * sr));
    this.dist = s.dist;
    this.useHp = !!s.detHp;
    this.useBand = !!s.detBand;
    this.inTarget = Math.exp(s.inputDb * CR_DB);
    this.outTarget = Math.exp(s.outputDb * CR_DB);
    this.wetTarget = Math.max(0, Math.min(1, s.mix));
    if (!this.started) {
      this.inG = this.inTarget;
      this.outG = this.outTarget;
      this.wet = this.wetTarget;
      this.started = true;
    }
  }

  get latency() {
    return ${CRUSHER_LATENCY};
  }

  // The gain (linear) for one sample of the detector's input.
  detect(kl, kr) {
    const level = Math.max(Math.abs(kl), Math.abs(kr));
    const x = level > 1e-6 ? Math.log(level) / CR_DB : -120;
    const t = this.slope * crusherKnee(x - CR_T, this.knee);
    this.gr = t > this.gr ? t + this.atk * (this.gr - t) : t + this.rel * (this.gr - t);
    let g = this.gr;
    if (this.opto) {
      this.slow = t > this.slow ? t + this.slowAtk * (this.slow - t) : t + this.slowRel * (this.slow - t);
      if (this.slow > g) g = this.slow;
    }
    if (g > this.meterGr) this.meterGr = g;
    return Math.exp(-g * CR_DB);
  }

  // The distortion on one (doubled-rate) sample of channel c.
  shape(x, c) {
    if (this.dist === 1) {
      const y = (Math.tanh(CR_K2 * (x + CR_B2)) - CR_T2) * CR_N2;
      const out = y - this.dcX[c] + this.dcR * this.dcY[c];
      this.dcX[c] = y;
      this.dcY[c] = out;
      return out;
    }
    if (this.dist === 2) return Math.tanh(CR_K3 * x) / CR_K3;
    return x;
  }

  // n frames of inL/inR (a missing right is the left) into outL/outR.
  process(inL, inR, outL, outR, n) {
    const smooth = this.smooth;
    for (let i = 0; i < n; i++) {
      const l = inL ? inL[i] : 0;
      const r = inR ? inR[i] : l;
      if (Math.abs(l) > this.meterIn) this.meterIn = Math.abs(l);
      if (Math.abs(r) > this.meterIn) this.meterIn = Math.abs(r);
      this.inG += (this.inTarget - this.inG) * smooth;
      this.outG += (this.outTarget - this.outG) * smooth;
      this.wet += (this.wetTarget - this.wet) * smooth;
      const inG = this.inG;
      let kl = l * inG;
      let kr = r * inG;
      if (this.useHp) {
        kl = this.hp.run(kl, 0);
        kr = this.hp.run(kr, 1);
      }
      if (this.useBand) {
        kl = this.band.run(kl, 0);
        kr = this.band.run(kr, 1);
      }
      const g = this.detect(kl, kr);
      // Up (zero-stuffed, x2 to keep the level), process - the dry is the
      // same upsampled input, so it stays in line - then down.
      const gPrev = this.gain;
      const w = this.wet;
      const out = this.outG;
      let yl = 0;
      let yr = 0;
      for (let k = 0; k < 2; k++) {
        this.upL.push(k === 0 ? 2 * l : 0);
        this.upR.push(k === 0 ? 2 * r : 0);
        const gk = (k === 0 ? (gPrev + g) / 2 : g) * inG;
        const xl = this.upL.out();
        const xr = this.upR.out();
        this.downL.push(xl * (1 - w) + this.shape(xl * gk, 0) * out * w);
        this.downR.push(xr * (1 - w) + this.shape(xr * gk, 1) * out * w);
        // Keep the even-phase output: an exact 15-sample delay.
        if (k === 0) {
          yl = this.downL.out();
          yr = this.downR.out();
        }
      }
      this.gain = g;
      outL[i] = yl;
      if (outR) outR[i] = yr;
      const a = Math.max(Math.abs(yl), Math.abs(yr));
      if (a > this.meterOut) this.meterOut = a;
    }
  }

  takeMeters() {
    const m = { gainReduction: this.meterGr, output: this.meterOut, input: this.meterIn };
    this.meterGr = 0;
    this.meterOut = 0;
    this.meterIn = 0;
    return m;
  }
}
`;
