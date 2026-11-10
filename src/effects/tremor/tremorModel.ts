// The Tremor, Dawn's bass amp: the DSP (kept as source text like the other
// kernels, so the unit tests run exactly what plays) and what the plugin's
// params mean to it.
//
// Three voices, after three kinds of bass rig:
//   Tube  - a tube bass preamp and DI pedal (after the SGT-DI): the drive
//     is a tube stage that clips one side first (even harmonics, warm and
//     round), with Ultra Lo (Deep: more lows, scooped mids; Tight: the
//     lows cut) and Ultra Hi (a lift at the top).
//   Grind - a blend drive (after the B7K and Vintage Ultra): a hard,
//     symmetrical clip with the clean signal blended under it; Grunt sets
//     how much low end reaches the drive (Raw cuts it, Fat boosts it) and
//     Attack the top going in.
//   Split - a three-band bass distortion (after the Parallax X): the lows
//     stay clean (and compressed), the mids and highs are distorted
//     separately, each at its own level, the crossovers where you put
//     them.
// Every voice is two paths that Blend mixes: the clean one (the low band on
// Split), squeezed by Comp, and the dirty one, driven by Gain. Then the
// three-band EQ (Middle on a four-way frequency switch), the voice's own
// switches and the output level.
//
// Mono like a bass amp (a stereo input is mixed down); everything runs at
// 4x the sample rate, so the distortion doesn't alias, and the clean and
// dirty paths stay lined up for Blend.

import { AMP_LATENCY, AMP_PARTS_SOURCE } from "../furnace/ampKernel";

export const TREMOR_VOICES = ["tube", "grind", "split"] as const;
export type TremorVoice = (typeof TREMOR_VOICES)[number];
export const TREMOR_VOICE_LABELS: Record<TremorVoice, string> = { tube: "Tube", grind: "Grind", split: "Split" };

export const TREMOR_MID_FREQS = [250, 500, 1000, 2000];
export const TREMOR_MID_LABELS = ["250", "500", "1k", "2k"];
export const TREMOR_ULTRA_LO_LABELS = ["Off", "Deep", "Tight"];
export const TREMOR_GRUNT_LABELS = ["Raw", "Flat", "Fat"];
export const TREMOR_ATTACK_LABELS = ["Cut", "Flat", "Boost"];

/** Latency (samples at the base rate) of the oversampling: the amp's. */
export const TREMOR_LATENCY = AMP_LATENCY;

const step = (v: number | undefined, fallback: number, n: number) => Math.min(n - 1, Math.max(0, Math.round(v ?? fallback)));

export function tremorVoice(v: number | undefined): TremorVoice {
  return TREMOR_VOICES[step(v, 0, TREMOR_VOICES.length)];
}

export function tremorMidIndex(v: number | undefined): number {
  return step(v, 1, TREMOR_MID_FREQS.length);
}

/** A three-way switch's position (0-2). */
export function tremorSwitch(v: number | undefined, fallback = 1): number {
  return step(v, fallback, 3);
}

/** The EQ knobs (0-10) as dB: ±12, flat at 5. */
export const tremorEqDb = (v: number) => (v - 5) * 2.4;

/** The kernel's settings. */
export interface TremorSettings {
  /** 0 Tube, 1 Grind, 2 Split. */
  voice: number;
  /** Into the dirty path (linear). */
  drive: number;
  /** The dirty path's share (0-1). */
  blend: number;
  /** The dirty path's level against the clean one (linear). */
  dirtTrim: number;
  /** The clean path's compressor: threshold (dB), ratio, makeup (dB). */
  compThreshold: number;
  compRatio: number;
  compMakeup: number;
  /** The EQ (dB) and Middle's frequency (Hz). */
  bassDb: number;
  midDb: number;
  midHz: number;
  trebleDb: number;
  /** Tube: Ultra Lo 0 off, 1 deep, 2 tight; Ultra Hi 0 or 1. */
  ultraLo: number;
  ultraHi: number;
  /** Grind: Grunt 0 raw, 1 flat, 2 fat; Attack 0 cut, 1 flat, 2 boost. */
  grunt: number;
  attack: number;
  /** Split: the crossovers (Hz) and the distorted bands' levels (dB). */
  lowSplit: number;
  highSplit: number;
  midLevel: number;
  highLevel: number;
  /** Output level, dB. */
  output: number;
}

/** Per voice: the drive's range (dB at Gain 0 and 10) and the dirty
 * path's trim (dB), so Blend moves between paths of about the same level. */
const VOICE_DRIVE: Record<TremorVoice, { lo: number; hi: number; trim: number }> = {
  tube: { lo: 0, hi: 34, trim: -8 },
  grind: { lo: 6, hi: 48, trim: -16 },
  split: { lo: 6, hi: 44, trim: -6 },
};

const tenth = (v: number | undefined, fallback: number) => Math.min(10, Math.max(0, v ?? fallback)) / 10;
const clampTo = (v: number | undefined, fallback: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v ?? fallback));

/** The kernel settings for a Tremor's params. */
export function tremorSettingsFromParams(p: Record<string, number>): TremorSettings {
  const voice = tremorVoice(p.voice);
  const d = VOICE_DRIVE[voice];
  const comp = tenth(p.comp, 3);
  return {
    voice: TREMOR_VOICES.indexOf(voice),
    drive: Math.pow(10, (d.lo + (d.hi - d.lo) * tenth(p.gain, 5)) / 20),
    blend: tenth(p.blend, 6),
    dirtTrim: Math.pow(10, d.trim / 20),
    // Comp at 0 doesn't compress; at 10, 8:1 from -30 dB.
    compThreshold: -10 - 20 * comp,
    compRatio: 1 + 7 * comp,
    compMakeup: 9 * comp,
    bassDb: tremorEqDb(clampTo(p.bass, 5, 0, 10)),
    midDb: tremorEqDb(clampTo(p.mid, 5, 0, 10)),
    midHz: TREMOR_MID_FREQS[tremorMidIndex(p.midFreq)],
    trebleDb: tremorEqDb(clampTo(p.treble, 5, 0, 10)),
    ultraLo: tremorSwitch(p.ultraLo, 0),
    ultraHi: (p.ultraHi ?? 0) >= 0.5 ? 1 : 0,
    grunt: tremorSwitch(p.grunt),
    attack: tremorSwitch(p.attack),
    lowSplit: clampTo(p.lowSplit, 250, 60, 500),
    highSplit: clampTo(p.highSplit, 2000, 800, 6000),
    midLevel: clampTo(p.midLevel, 0, -24, 12),
    highLevel: clampTo(p.highLevel, -6, -24, 12),
    output: clampTo(p.output, 0, -24, 24),
  };
}

export const TREMOR_SOURCE =
  AMP_PARTS_SOURCE +
  String.raw`
// Two cascaded Butterworth sections: a 24 dB/octave (Linkwitz-Riley)
// crossover side.
class Lr4 {
  constructor() { this.a = new Biquad(); this.b = new Biquad(); }
  set(type, fc, fs) { this.a.set(type, fc, Math.SQRT1_2, 0, fs); this.b.set(type, fc, Math.SQRT1_2, 0, fs); }
  run(x) { return this.b.run(this.a.run(x)); }
}

// The tube stage: biased, so it clips one side first.
function tubeClip(u) {
  return triode(u + 0.3, 1.8) - triode(0.3, 1.8);
}

class TremorKernel {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.fs = sampleRate * AMP_OS;
    this.h = designFir();
    this.up = new Float64Array((2 * AMP_TAPS) / AMP_OS);
    this.upPos = 0;
    this.down = new Float64Array(2 * AMP_TAPS);
    this.downPos = 0;
    this.inHp = new OnePole();
    // The compressor's level detector (dB) and gain.
    this.env = 0;
    // Split's bands.
    this.lowLp = new Lr4(); this.restHp = new Lr4(); this.midLp = new Lr4(); this.highHp = new Lr4();
    // The drives' filters.
    this.preHp = new OnePole(); this.preShelf = new Biquad(); this.preTop = new Biquad();
    this.stageHp = new OnePole(); this.postLp = new Biquad(); this.highLp = new OnePole();
    // The EQ and the Tube voice's switches.
    this.bass = new Biquad(); this.mid = new Biquad(); this.treble = new Biquad();
    this.ultraLow = new Biquad(); this.ultraMid = new Biquad(); this.ultraHigh = new Biquad();
    this.dc = new OnePole();
    this.s = null;
  }

  set(s) {
    this.s = s;
    const fs = this.fs;
    this.inHp.lowpass(25, fs);
    this.atk = 1 - Math.exp(-1 / (0.005 * fs));
    this.rel = 1 - Math.exp(-1 / (0.15 * fs));
    this.lowLp.set("lp", s.lowSplit, fs);
    this.restHp.set("hp", s.lowSplit, fs);
    this.midLp.set("lp", s.highSplit, fs);
    this.highHp.set("hp", s.highSplit, fs);
    if (s.voice === 0) {
      // Tube: a coupling high-pass into the stage, the plate's soft top.
      this.preHp.lowpass(40, fs);
      this.preShelf.set("lowshelf", 100, 0.7, 0, fs);
      this.preTop.set("highshelf", 2000, 0.7, 0, fs);
      this.stageHp.lowpass(20, fs);
      this.postLp.set("lp", 6500, 0.7, 0, fs);
    } else if (s.voice === 1) {
      // Grind: Grunt sets the low end into the drive, Attack the top.
      this.preHp.lowpass([280, 110, 50][s.grunt], fs);
      this.preShelf.set("lowshelf", 120, 0.7, s.grunt === 2 ? 6 : 0, fs);
      this.preTop.set("highshelf", 2000, 0.7, [-6, 0, 6][s.attack], fs);
      this.stageHp.lowpass(30, fs);
      this.postLp.set("lp", 5500, 0.7, 0, fs);
    } else {
      // Split: the mid band's top is softened after its drive, the high
      // band's fizz less so.
      this.preHp.lowpass(10, fs);
      this.preShelf.set("lowshelf", 100, 0.7, 0, fs);
      this.preTop.set("highshelf", 2000, 0.7, 0, fs);
      this.stageHp.lowpass(20, fs);
      this.postLp.set("lp", 7000, 0.7, 0, fs);
      this.highLp.lowpass(10000, fs);
    }
    this.midGain = Math.pow(10, s.midLevel / 20);
    this.highGain = Math.pow(10, s.highLevel / 20);
    this.bass.set("lowshelf", 100, 0.7, s.bassDb, fs);
    this.mid.set("peak", s.midHz, 0.9, s.midDb, fs);
    this.treble.set("highshelf", 4000, 0.7, s.trebleDb, fs);
    const tube = s.voice === 0;
    this.ultraLow.set(tube && s.ultraLo === 2 ? "hp" : "lowshelf", tube && s.ultraLo === 2 ? 70 : 45, 0.7, tube && s.ultraLo === 1 ? 4 : 0, fs);
    this.ultraMid.set("peak", 500, 0.7, tube && s.ultraLo === 1 ? -8 : 0, fs);
    this.ultraHigh.set("highshelf", 8000, 0.7, tube && s.ultraHi === 1 ? 8 : 0, fs);
    this.dc.lowpass(10, fs);
    this.outGain = Math.pow(10, s.output / 20);
    this.makeup = Math.pow(10, s.compMakeup / 20);
  }

  // The clean path's compressor: a peak detector in dB, hard knee.
  compress(x) {
    const s = this.s;
    if (s.compRatio <= 1) return x;
    const level = 20 * Math.log10(Math.abs(x) + 1e-9);
    this.env += (level > this.env ? this.atk : this.rel) * (level - this.env);
    const over = this.env - s.compThreshold;
    const gr = over > 0 ? over * (1 - 1 / s.compRatio) : 0;
    return x * Math.pow(10, -gr / 20) * this.makeup;
  }

  // One sample at the oversampled rate.
  tick(x) {
    const s = this.s;
    x = this.inHp.hp(x);
    let clean, dirty;
    if (s.voice === 2) {
      clean = this.lowLp.run(x);
      const rest = this.restHp.run(x);
      const mid = Math.tanh(this.midLp.run(rest) * s.drive);
      const high = Math.tanh(this.highHp.run(rest) * s.drive * 2);
      dirty = this.postLp.run(mid) * this.midGain + this.highLp.lp(high) * this.highGain;
    } else {
      clean = x;
      let u = this.preTop.run(this.preShelf.run(this.preHp.hp(x))) * s.drive;
      if (s.voice === 0) {
        u = tubeClip(u);
        u = this.stageHp.hp(u);
        u = Math.tanh(1.5 * u) / 1.5;
      } else {
        u = Math.tanh(u);
        u = this.stageHp.hp(u);
        // The second stage clips harder: the grind.
        const v = 2.5 * u;
        u = v / Math.sqrt(1 + v * v);
      }
      dirty = this.postLp.run(u);
    }
    clean = this.compress(clean);
    let y = (1 - s.blend) * clean + s.blend * dirty * s.dirtTrim;
    y = this.treble.run(this.mid.run(this.bass.run(y)));
    y = this.ultraHigh.run(this.ultraMid.run(this.ultraLow.run(y)));
    return this.dc.hp(y) * this.outGain;
  }

  process(input, output, n) {
    // History buffers are written twice (at i and i + len), so each filter
    // reads one contiguous run without wrapping (as the amp does).
    const h = this.h, up = this.up, L = AMP_TAPS / AMP_OS, down = this.down, T = AMP_TAPS;
    for (let i = 0; i < n; i++) {
      const x = (input ? input[i] : 0) * AMP_OS;
      this.upPos = this.upPos === 0 ? L - 1 : this.upPos - 1;
      up[this.upPos] = x; up[this.upPos + L] = x;
      for (let p = 0; p < AMP_OS; p++) {
        let v = 0;
        for (let k = 0, j = this.upPos; k < L; k++, j++) v += h[p + AMP_OS * k] * up[j];
        const y = this.tick(v);
        this.downPos = this.downPos === 0 ? T - 1 : this.downPos - 1;
        down[this.downPos] = y; down[this.downPos + T] = y;
      }
      let acc = 0;
      for (let k = 0, j = this.downPos; k < T; k++, j++) acc += h[k] * down[j];
      output[i] = acc;
    }
  }
}
`;

interface BiquadLike {
  b0: number; b1: number; b2: number; a1: number; a2: number;
  set(type: string, fc: number, q: number, db: number, fs: number): void;
}
const Biquad = new Function(`${AMP_PARTS_SOURCE}; return Biquad;`)() as new () => BiquadLike;

function biquadDb(q: BiquadLike, f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = q.b0 + q.b1 * c1 + q.b2 * c2, ni = -(q.b1 * s1 + q.b2 * s2);
  const dr = 1 + q.a1 * c1 + q.a2 * c2, di = -(q.a1 * s1 + q.a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** The EQ after the paths (the three bands and the Tube voice's Ultra
 * switches), in dB at each of `freqs`, for the window's curve. */
export function tremorEqCurve(params: Record<string, number>, freqs: number[]): number[] {
  const s = tremorSettingsFromParams(params);
  const fs = 192000;
  const tube = s.voice === 0;
  const make = (type: string, fc: number, q: number, db: number) => {
    const b = new Biquad();
    b.set(type, fc, q, db, fs);
    return b;
  };
  const filters = [
    make("lowshelf", 100, 0.7, s.bassDb),
    make("peak", s.midHz, 0.9, s.midDb),
    make("highshelf", 4000, 0.7, s.trebleDb),
    tube && s.ultraLo === 2 ? make("hp", 70, 0.7, 0) : make("lowshelf", 45, 0.7, tube && s.ultraLo === 1 ? 4 : 0),
    make("peak", 500, 0.7, tube && s.ultraLo === 1 ? -8 : 0),
    make("highshelf", 8000, 0.7, tube && s.ultraHi === 1 ? 8 : 0),
  ];
  return freqs.map((f) => filters.reduce((db, q) => db + biquadDb(q, f, fs), 0));
}
