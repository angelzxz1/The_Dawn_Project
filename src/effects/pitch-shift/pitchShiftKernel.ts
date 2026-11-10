// The Pitch Shift's DSP, two ways (kept as source text because it runs in
// an AudioWorklet - pitchShifter.ts - and the unit tests run exactly what
// plays; the native engine's port, crates/dawn-engine/src/effects/
// pitch_shift.rs, is held to it by pitchShiftParity.ts):
//
// Studio - a phase vocoder that shifts each partial on its own, the way
//   the most natural polyphonic shifters do. Every hop (an eighth of a
//   2048-sample frame) the recent input is analyzed; each spectral peak's
//   true frequency comes from how far its phase moved since the last hop;
//   the peak and the bins around it (its "region") move up or down to the
//   new frequency together, keeping their phases relative to the peak's
//   (phase locking, so the partial stays one clean sine rather than a
//   phasey smear), and the peak's phase advances at its new frequency from
//   where the same partial was a hop ago. On a sharp attack (a pick or a
//   pluck) the phases start over from the input's, so the attack stays
//   crisp, and the shifted sound the frame would smear ahead of it (the
//   pre-echo) is brought down to the input's level there. A chord comes
//   out as a chord, every note shifted the same.
//   Latency: one frame (4096 samples at 44.1/48 kHz, 8192 above: long
//   enough to tell a low chord's notes apart).
// Live - a delay-line shifter for playing through: one read tap moves
//   through recent input at the new speed, and when it runs out of room it
//   jumps a window back (or forward), to the spot within reach where the
//   waveform best matches what it was playing (the highest correlation),
//   and crossfades there; so the splices land in step and don't warble.
//   On a pick attack the tap jumps to just behind it, so attacks come out
//   3 ms after they're played; in between, the delay drifts within the
//   window (Window sets how far: longer is smoother, shorter tighter).
//
// Feedback returns the output into the input, so each pass is shifted
// again. The dry path waits as long as the shifted one, so Dry/Wet blends
// them in time; the blend is equal-power.

/** The kernel's settings. */
export interface PitchKernelSettings {
  /** 0 Live, 1 Studio. */
  mode: number;
  /** Playback ratio (2 = an octave up). */
  ratio: number;
  /** Live's window (s). */
  window: number;
  feedback: number;
  /** 0..1 dry/wet, equal-power. */
  wet: number;
}

/** Live's delay line (frames): far above the longest window and search. */
export const PITCH_LIVE_BUFFER = 65536;

/** Studio's frame size at a sample rate. */
export const pitchFrameSize = (sampleRate: number) => (sampleRate > 50000 ? 8192 : 4096);

/** Live's shortest delay (frames): room for the interpolator. */
export const PITCH_LIVE_FLOOR = 4;

/** Where Live plays an attack from (s): just behind it. */
export const PITCH_LIVE_ATTACK = 0.003;

/** The frames the shifted signal (and so the dry one) is delayed by: a
 * frame for Studio; for Live, where it plays each attack from (in a
 * sustained note it drifts around that, as any delay-line shifter does). */
export function pitchLatency(s: Pick<PitchKernelSettings, "mode">, sampleRate: number): number {
  return s.mode === 1 ? pitchFrameSize(sampleRate) : PITCH_LIVE_FLOOR + Math.round(PITCH_LIVE_ATTACK * sampleRate);
}

export const PITCH_SHIFT_SOURCE = String.raw`
const TWO_PI = 2 * Math.PI;
const LIVE_BUFFER = ${PITCH_LIVE_BUFFER};
const LIVE_FLOOR = ${PITCH_LIVE_FLOOR};
const LIVE_ATTACK = ${PITCH_LIVE_ATTACK};

function princarg(x) {
  return x - TWO_PI * Math.floor(x / TWO_PI + 0.5);
}

// In-place radix-2 complex FFT (forward e^-i, inverse e^+i, unscaled).
class Fft {
  constructor(n) {
    this.n = n;
    this.rev = new Uint32Array(n);
    let bits = 0;
    while ((1 << bits) < n) bits++;
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((TWO_PI * i) / n);
      this.sin[i] = Math.sin((TWO_PI * i) / n);
    }
  }
  run(re, im, inverse) {
    const n = this.n, rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step], wi = inverse ? this.sin[k * step] : -this.sin[k * step];
          const a = start + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }
}

// --- Studio: the phase vocoder, one per channel ---
class PvChannel {
  constructor(n) {
    const bins = n / 2 + 1;
    this.inRing = new Float64Array(n);
    this.outAcc = new Float64Array(n);
    this.prevPhase = new Float64Array(bins);
    this.psi = new Float64Array(bins);
    this.prevPsi = new Float64Array(bins);
    this.peaks = new Int32Array(bins);
    this.prevPeaks = new Int32Array(bins);
    this.nPeaks = 0;
    this.nPrev = 0;
    this.prevHfc = 0;
  }
}

class Studio {
  constructor(sampleRate) {
    const n = (this.n = sampleRate > 50000 ? 8192 : 4096);
    this.hop = n / 8;
    this.fft = new Fft(n);
    // Periodic Hann, used to analyze and to resynthesize; the overlapping
    // squares sum to a constant, divided out.
    this.win = new Float64Array(n);
    for (let i = 0; i < n; i++) this.win[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / n);
    let sum = 0;
    for (let m = 0; m < 8; m++) sum += this.win[m * this.hop] * this.win[m * this.hop];
    this.norm = 1 / (sum * n);
    const bins = n / 2 + 1;
    this.re = new Float64Array(n); this.im = new Float64Array(n);
    this.yre = new Float64Array(n); this.yim = new Float64Array(n);
    this.mag = new Float64Array(bins); this.phase = new Float64Array(bins); this.omega = new Float64Array(bins);
    this.bound = new Int32Array(bins + 1);
    this.ch = [new PvChannel(n), new PvChannel(n)];
    this.pos = 0;
    this.count = 0;
  }

  // One frame per channel, added into the output from the next sample on.
  frame(c, ratio) {
    const n = this.n, hop = this.hop, half = n / 2, re = this.re, im = this.im, mag = this.mag, phase = this.phase, omega = this.omega;
    for (let i = 0; i < n; i++) { re[i] = c.inRing[(this.pos + i) % n] * this.win[i]; im[i] = 0; }
    this.fft.run(re, im, false);
    let maxMag = 0, hfc = 0;
    for (let k = 0; k <= half; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      mag[k] = m;
      if (m > maxMag) maxMag = m;
      hfc += k * m * m;
      const ph = Math.atan2(im[k], re[k]);
      phase[k] = ph;
      omega[k] = (TWO_PI * k) / n + princarg(ph - c.prevPhase[k] - (TWO_PI * k * hop) / n) / hop;
      c.prevPhase[k] = ph;
    }
    // A sharp attack: the phases start over from the input's.
    const onset = hfc > 2 * c.prevHfc && hfc > 1e-6;
    c.prevHfc = hfc;
    // The peaks, and the region each one carries: up to the quietest bin
    // between it and the next.
    const thresh = maxMag * 1e-4;
    let np = 0;
    for (let k = 2; k < half - 1; k++) {
      const m = mag[k];
      if (m > thresh && m > mag[k - 1] && m >= mag[k + 1] && m > mag[k - 2] && m >= mag[k + 2]) c.peaks[np++] = k;
    }
    const bound = this.bound;
    bound[0] = 0;
    for (let i = 1; i < np; i++) {
      let lo = c.peaks[i - 1];
      for (let k = c.peaks[i - 1] + 1; k <= c.peaks[i]; k++) if (mag[k] < mag[lo]) lo = k;
      bound[i] = lo;
    }
    bound[np] = half + 1;
    const yre = this.yre, yim = this.yim;
    yre.fill(0); yim.fill(0);
    let q = 0;
    for (let i = 0; i < np; i++) {
      const p = c.peaks[i];
      const w = ratio * omega[p];
      const shift = Math.floor((w * n) / TWO_PI + 0.5) - p;
      // The same partial a hop ago: the previous frame's nearest peak.
      while (q + 1 < c.nPrev && Math.abs(c.prevPeaks[q + 1] - p) <= Math.abs(c.prevPeaks[q] - p)) q++;
      let psi;
      if (ratio === 1 || onset || c.nPrev === 0 || Math.abs(c.prevPeaks[q] - p) > 2) psi = phase[p];
      else psi = c.prevPsi[c.prevPeaks[q]] + hop * w;
      psi = princarg(psi);
      c.psi[p] = psi;
      const rot = psi - phase[p];
      for (let k = bound[i]; k < bound[i + 1]; k++) {
        const kk = k + shift;
        if (kk < 1 || kk >= half) continue;
        const ph = phase[k] + rot;
        yre[kk] += mag[k] * Math.cos(ph);
        yim[kk] += mag[k] * Math.sin(ph);
      }
    }
    // Keep this frame's peaks and phases for the next.
    for (let i = 0; i < np; i++) { c.prevPeaks[i] = c.peaks[i]; c.prevPsi[c.peaks[i]] = c.psi[c.peaks[i]]; }
    c.nPrev = np;
    for (let k = 1; k < half; k++) { yre[n - k] = yre[k]; yim[n - k] = -yim[k]; }
    this.fft.run(yre, yim, true);
    // Pre-echo: in a frame where an attack starts (a 64-sample block ten
    // times louder than the frame so far), the shifted sound before it is
    // brought down to the input's own level there.
    let onsetAt = 0;
    let sum = 0;
    for (let b = 0; b < n / 64; b++) {
      let e = 0;
      for (let i = b * 64; i < b * 64 + 64; i++) {
        const v = c.inRing[(this.pos + i) % n];
        e += v * v;
      }
      if (b >= 2 && e > (10 * sum) / b && e > 1e-7) {
        onsetAt = b * 64;
        break;
      }
      sum += e;
    }
    let gain = 1;
    if (onsetAt > 0) {
      let want = 0, got = 0;
      for (let i = 0; i < onsetAt; i++) {
        const v = c.inRing[(this.pos + i) % n] * this.win[i], y = yre[i] / n;
        want += v * v;
        got += y * y;
      }
      if (got > want) gain = Math.sqrt(want / got);
    }
    for (let i = 0; i < n; i++) {
      const g = i >= onsetAt ? 1 : i < onsetAt - 64 ? gain : gain + ((1 - gain) * (i - onsetAt + 64)) / 64;
      const at = (this.pos + i) % n;
      c.outAcc[at] += yre[i] * g * this.win[i] * this.norm;
    }
  }

  // One sample of each channel in; one of each out (a frame late).
  tick(xl, xr, out, ratio) {
    const n = this.n, a = this.ch[0], b = this.ch[1], p = this.pos;
    out[0] = a.outAcc[p]; a.outAcc[p] = 0; a.inRing[p] = xl;
    out[1] = b.outAcc[p]; b.outAcc[p] = 0; b.inRing[p] = xr;
    this.pos = (p + 1) % n;
    if (++this.count === this.hop) {
      this.count = 0;
      this.frame(a, ratio);
      this.frame(b, ratio);
    }
  }
}

// --- Live: the delay line with matched splices ---
class Live {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.mask = LIVE_BUFFER - 1;
    this.buf = [new Float64Array(LIVE_BUFFER), new Float64Array(LIVE_BUFFER)];
    this.write = 0;
    this.d = -1;
    this.dOld = 0;
    this.fadeLen = 0;
    this.fadePos = 0;
    this.corr = Math.round(0.008 * sampleRate);
    // Where an attack plays from, and the attack detector: a fast and a
    // slow level, and a hold so one attack is caught once.
    this.pad = Math.round(LIVE_ATTACK * sampleRate);
    this.fast = 0;
    this.slow = 0;
    this.hold = 0;
    this.aFast = 1 - Math.exp(-1 / (0.001 * sampleRate));
    this.aSlow = 1 - Math.exp(-1 / (0.05 * sampleRate));
  }

  reset(win) {
    this.win = Math.round(win * this.sr);
    this.search = Math.round(Math.min(0.012 * this.sr, this.win / 4));
    this.d = LIVE_FLOOR + this.pad;
    this.fadeLen = 0;
    this.fadePos = 0;
  }

  // The crossfade for a splice at this ratio.
  fadeFor(ratio) {
    return Math.max(16, Math.min(Math.round(0.012 * this.sr), Math.floor((0.45 * this.win) / Math.abs(1 - ratio))));
  }

  read(buf, pos) {
    const m = this.mask;
    const i = Math.floor(pos);
    const f = pos - i;
    const y0 = buf[(i - 1) & m], y1 = buf[i & m], y2 = buf[(i + 1) & m], y3 = buf[(i + 2) & m];
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * f + c2) * f + c1) * f + y1;
  }

  // Jumps the tap by about a window (lo..hi frames), to where the recent
  // waveform matches best, and starts the crossfade there.
  splice(lo, hi, fade) {
    const m = this.mask, l = this.buf[0], r = this.buf[1];
    const at = Math.floor(this.write - this.d);
    let best = lo, bestScore = -Infinity;
    for (let s = lo; s <= hi; s++) {
      let ab = 0, bb = 0;
      for (let j = 0; j < this.corr; j += 2) {
        const a = l[(at - j) & m] + r[(at - j) & m];
        const b = l[(at - s - j) & m] + r[(at - s - j) & m];
        ab += a * b;
        bb += b * b;
      }
      const score = ab / Math.sqrt(bb + 1e-12);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    this.dOld = this.d;
    this.d += best;
    this.fadeLen = fade;
    this.fadePos = 0;
  }

  tick(xl, xr, out, ratio) {
    const m = this.mask, w = this.write;
    this.buf[0][w] = xl;
    this.buf[1][w] = xr;
    // A pick attack: the tap jumps to just behind it, so every attack comes
    // out as soon as it can, whatever the tap was doing (going up, it needs
    // half a window of room to read ahead into).
    const v = 0.5 * Math.abs(xl + xr);
    this.fast += this.aFast * (v - this.fast);
    this.slow += this.aSlow * (v - this.slow);
    if (this.hold > 0) this.hold--;
    else if (ratio !== 1 && this.fast > 3 * this.slow + 1e-4) {
      this.hold = Math.round(0.08 * this.sr);
      const to = ratio < 1 ? LIVE_FLOOR + this.pad : LIVE_FLOOR + this.fadeFor(ratio) * (ratio - 1) + 2 + this.win / 2;
      if (this.d > to + this.pad) {
        this.dOld = this.d;
        this.d = to;
        this.fadeLen = this.pad;
        this.fadePos = 0;
      }
    }
    let yl = this.read(this.buf[0], w - this.d), yr = this.read(this.buf[1], w - this.d);
    if (this.fadePos < this.fadeLen) {
      const g = 0.5 - 0.5 * Math.cos((Math.PI * (this.fadePos + 0.5)) / this.fadeLen);
      yl = g * yl + (1 - g) * this.read(this.buf[0], w - this.dOld);
      yr = g * yr + (1 - g) * this.read(this.buf[1], w - this.dOld);
      this.fadePos++;
      this.dOld += 1 - ratio;
    }
    out[0] = yl;
    out[1] = yr;
    this.d += 1 - ratio;
    this.write = (w + 1) & m;
    if (this.fadePos < this.fadeLen || ratio === 1) return;
    const fade = this.fadeFor(ratio);
    if (ratio < 1 && this.d >= LIVE_FLOOR + this.win) this.splice(-this.win, -this.win + 2 * this.search, fade);
    else if (ratio > 1 && this.d <= LIVE_FLOOR + fade * (ratio - 1) + 1) this.splice(this.win - 2 * this.search, this.win, fade);
  }
}

class PitchKernel {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.studio = new Studio(sampleRate);
    this.live = new Live(sampleRate);
    this.dry = [new Float64Array(LIVE_BUFFER), new Float64Array(LIVE_BUFFER)];
    this.dryAt = 0;
    this.last = [0, 0];
    this.out = [0, 0];
    this.s = null;
  }

  set(s) {
    const prev = this.s;
    this.s = s;
    if (!prev || prev.mode !== s.mode || prev.window !== s.window) this.live.reset(s.window);
    this.latency = s.mode === 1 ? this.studio.n : LIVE_FLOOR + this.live.pad;
    this.dryGain = Math.cos((s.wet * Math.PI) / 2);
    this.wetGain = Math.sin((s.wet * Math.PI) / 2);
  }

  process(inL, inR, outL, outR, n) {
    const s = this.s, out = this.out, dl = this.dry[0], dr = this.dry[1], dm = LIVE_BUFFER - 1;
    for (let i = 0; i < n; i++) {
      const l = inL ? inL[i] : 0;
      const r = inR ? inR[i] : l;
      const xl = l + s.feedback * this.last[0], xr = r + s.feedback * this.last[1];
      if (s.mode === 1) this.studio.tick(xl, xr, out, s.ratio);
      else this.live.tick(xl, xr, out, s.ratio);
      this.last[0] = out[0];
      this.last[1] = out[1];
      dl[this.dryAt] = l;
      dr[this.dryAt] = r;
      const back = (this.dryAt - this.latency) & dm;
      outL[i] = dl[back] * this.dryGain + out[0] * this.wetGain;
      if (outR) outR[i] = dr[back] * this.dryGain + out[1] * this.wetGain;
      this.dryAt = (this.dryAt + 1) & dm;
    }
  }
}
`;

export const PITCH_MODES = ["live", "studio"] as const;
export type PitchMode = (typeof PITCH_MODES)[number];
export const PITCH_MODE_LABELS: Record<PitchMode, string> = { live: "Live", studio: "Studio" };

/** The Mode switch; missing (a project from before it) is Studio. */
export function pitchMode(v: number | undefined): PitchMode {
  return (v ?? 1) >= 0.5 ? "studio" : "live";
}

/** The kernel settings for a Pitch Shift's params. */
export function pitchSettingsFromParams(p: Record<string, number>): PitchKernelSettings {
  const clamp = (v: number | undefined, fallback: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v ?? fallback));
  return {
    mode: pitchMode(p.mode) === "studio" ? 1 : 0,
    ratio: Math.pow(2, (clamp(p.pitch, 0, -24, 24) + clamp(p.fine, 0, -100, 100) / 100) / 12),
    window: clamp(p.window, 0.04, 0.02, 0.25),
    feedback: clamp(p.feedback, 0, 0, 0.9),
    wet: clamp(p.wet, 1, 0, 1),
  };
}
