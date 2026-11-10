// The Furnace amp's knobs and voicings: what the plugin's params mean to
// the kernel (ampKernel.ts). The knobs read 0-10 like an amp's; the Amp
// selector, and on the High Gain head the channel modes and the rectifier
// switch, pick a voicing - the stage gains, filters and tone-stack parts
// behind the knobs.
//
// Five amps, after the classic designs:
//   Clean American - a blackface-style combo: one stage, the tone stack,
//     then the second stage; 6L6s with plenty of headroom, a bright cap on
//     the volume.
//   Chime - a top-boost-style class A combo: two stages and a cathode
//     follower into the stack, EL84s biased class A (even harmonics, early
//     breakup), no negative feedback, so Presence is the Cut control.
//   British Crunch - a plexi/800-style head: three stages, the cold second
//     one, a cathode follower into the stack, EL34s.
//   British Lead - the same with a fourth stage cascaded in, a tighter
//     input and more mids: the hot-rodded lead sound.
//   High Gain - the reference head (Raw, Vintage and Modern channels, the
//     rectifier switch).
// Clean American's and the British amps' tone stacks use the published part
// values of the circuits they're after (Chime's: see its voicing); their
// gains, filters and power stages are tuned
// to those amps' character by ear and by test (breakup, harmonics, level),
// not fitted to measurements like the head.
//
// Modern is the reference voicing: its constants were fitted against
// measurements of a high-gain rectifier head's rhythm channel (gain and
// harmonics per frequency and level, the clipping curve, the spectrum and
// crest factor of a palm-muted riff), so with the default knobs it lands
// close to that amp. Vintage and Raw are derived from it the way the real
// channels differ: Vintage keeps more mids and a looser low end with less
// gain, Raw drops a clipping stage and opens up the top.

import { AMP_SOURCE, type AmpSettings } from "./ampKernel";

export const AMP_MODES = ["raw", "vintage", "modern"] as const;
export type AmpMode = (typeof AMP_MODES)[number];
export const AMP_MODE_LABELS: Record<AmpMode, string> = { raw: "Raw", vintage: "Vintage", modern: "Modern" };

export const AMP_MODELS = ["clean", "chime", "crunch", "lead", "highGain"] as const;
export type AmpModel = (typeof AMP_MODELS)[number];
export const AMP_MODEL_LABELS: Record<AmpModel, string> = {
  clean: "Clean American",
  chime: "Chime",
  crunch: "British Crunch",
  lead: "British Lead",
  highGain: "High Gain",
};

export const AMP_RECTIFIERS = ["tube", "diode"] as const;
export type AmpRectifier = (typeof AMP_RECTIFIERS)[number];
export const AMP_RECTIFIER_LABELS: Record<AmpRectifier, string> = { tube: "Tube", diode: "Diode" };

/** Default knob positions (0-10): where the reference voicing was fitted. */
export const AMP_DEFAULTS = { gain: 7, bass: 6.1, mid: 4.9, treble: 4, presence: 6.6, master: 5 };

export function ampMode(v: number | undefined): AmpMode {
  return AMP_MODES[Math.min(AMP_MODES.length - 1, Math.max(0, Math.round(v ?? 2)))];
}

/** The Amp selector; missing (a project from before it) is the High Gain
 * head, which was the only amp. */
export function ampModel(v: number | undefined): AmpModel {
  return AMP_MODELS[Math.min(AMP_MODELS.length - 1, Math.max(0, Math.round(v ?? AMP_MODELS.length - 1)))];
}

/** The factory cabinet (cabIrs.ts) that goes with each amp. */
export function ampMatchingCab(model: AmpModel): string {
  return {
    clean: "factory-ir:2x12-open",
    chime: "factory-ir:2x12-alnico",
    crunch: "factory-ir:4x12-crunch",
    lead: "factory-ir:4x12-crunch",
    highGain: "factory-ir:4x12-closed",
  }[model];
}

/** What the Presence knob is on this amp: Chime has no feedback loop, so
 * it's the Cut control (turning it up darkens). */
export function ampPresenceLabel(model: AmpModel): string {
  return model === "chime" ? "Cut" : "Presence";
}

export function ampRectifier(v: number | undefined): AmpRectifier {
  return (v ?? 1) >= 0.5 ? "diode" : "tube";
}

type Voicing = Omit<AmpSettings, "gain" | "bass" | "mid" | "treble" | "presence" | "master" | "output" | "sag">;

/** Fitted against the reference capture (see the header). */
const MODERN: Voicing = {
  stageGains: [20.3, 8.31, 31.6, 7.29],
  stackAt: 4,
  shelfHz: [473, 473, 473, 473],
  shelfKeep: [0.793, 0.793, 0.793, 0.793],
  couplingHz: [20, 349, 40, 30],
  millerHz: [17470, 13976, 12229, 10482],
  inputHz: 363,
  asymmetry: 2.58,
  bias: 0.347,
  bright: 3.44,
  stack: { c1: 0.839e-9, c2: 20e-9, c3: 22.1e-9, r1: 250000, r2: 1000000, r3: 25000, r4: 53282 },
  stackGain: 1.78,
  powerDrive: 2.69,
  powerBias: 0,
  presenceHz: 4691,
  presenceDb: 9,
  depthHz: 88,
  depthDb: 9,
  lowHz: 40,
  highHz: 17042,
};

/** The output trim that puts the Modern voicing at the reference's level. */
const MODERN_TRIM = -5.07;

function voicing(mode: AmpMode): { v: Voicing; trim: number } {
  const m = MODERN;
  if (mode === "modern") return { v: m, trim: MODERN_TRIM };
  if (mode === "vintage") {
    // Less gain, a fuller low end into the first stages, a smaller slope
    // resistor (more mids out of the stack), less bias shift.
    return {
      v: {
        ...m,
        stageGains: [m.stageGains[0], m.stageGains[1] * 0.6, m.stageGains[2] * 0.7, m.stageGains[3]],
        couplingHz: [m.couplingHz[0], m.couplingHz[1] * 0.5, m.couplingHz[2], m.couplingHz[3]],
        inputHz: m.inputHz * 0.6,
        millerHz: m.millerHz.map((f) => f * 0.85),
        bias: m.bias * 0.7,
        stack: { ...m.stack, r4: m.stack.r4 * 0.55 },
        depthDb: m.depthDb * 0.6,
        presenceDb: m.presenceDb * 0.8,
      },
      trim: MODERN_TRIM - 1.6,
    };
  }
  // Raw: three clipping stages, brighter and more open.
  return {
    v: {
      ...m,
      stageGains: m.stageGains.slice(0, 3).map((g, i) => (i === 1 ? g * 0.5 : g)),
      stackAt: 3,
      shelfHz: m.shelfHz.slice(0, 3),
      shelfKeep: m.shelfKeep.slice(0, 3),
      couplingHz: [m.couplingHz[0], m.couplingHz[1] * 0.4, m.couplingHz[2]],
      millerHz: m.millerHz.slice(0, 3).map((f) => f * 1.2),
      inputHz: m.inputHz * 0.5,
      bias: m.bias * 0.5,
      bright: m.bright * 1.5,
      stack: { ...m.stack, r4: m.stack.r4 * 0.7 },
      depthDb: m.depthDb * 0.5,
    },
    trim: MODERN_TRIM + 0.2,
  };
}

/** A classic amp's voicing, its output trim (to the reference level) and
 * its supply sag. */
interface Classic {
  v: Voicing;
  trim: number;
  sag: number;
}

const CLASSICS: Record<Exclude<AmpModel, "highGain">, Classic> = {
  // One stage, the stack (250 pF, 100 nF, 47 nF; 250k treble and bass,
  // 10k mid, 100k slope), the volume and a second stage; a long-tail phase
  // inverter into 6L6s with lots of headroom, a solid-state rectifier.
  clean: {
    v: {
      stageGains: [4, 24],
      stackAt: 1,
      shelfHz: [12, 12],
      shelfKeep: [0.55, 0.55],
      couplingHz: [16, 22],
      millerHz: [22000, 16000],
      inputHz: 18,
      asymmetry: 1.8,
      bias: 0.15,
      bright: 7,
      stack: { c1: 250e-12, c2: 100e-9, c3: 47e-9, r1: 250000, r2: 250000, r3: 10000, r4: 100000 },
      stackGain: 4,
      powerDrive: 1.2,
      powerBias: 0,
      presenceHz: 3800,
      presenceDb: 6,
      depthHz: 100,
      depthDb: 2,
      lowHz: 35,
      highHz: 15000,
    },
    trim: 6,
    sag: 0.6,
  },
  // Two stages and a cathode follower into the stack; no feedback loop,
  // EL84s in class A, a tube rectifier. (The real top boost is a different
  // network from the one the kernel solves: these values give the same
  // network its sound - the forward upper mids and the scooped low mids.)
  chime: {
    v: {
      stageGains: [8, 10],
      stackAt: 2,
      shelfHz: [40, 60],
      shelfKeep: [0.6, 0.6],
      couplingHz: [25, 30],
      millerHz: [20000, 16000],
      inputHz: 30,
      asymmetry: 1.6,
      bias: 0.25,
      bright: 3,
      stack: { c1: 150e-12, c2: 22e-9, c3: 47e-9, r1: 1000000, r2: 1000000, r3: 10000, r4: 100000 },
      stackGain: 3,
      powerDrive: 4,
      powerBias: 0.6,
      presenceHz: 1800,
      presenceDb: -14,
      depthHz: 100,
      depthDb: 0,
      lowHz: 70,
      highHz: 12000,
    },
    trim: 11.9,
    sag: 1.3,
  },
  // Three stages (the second one cold, unbypassed) and a cathode follower
  // into the stack (470 pF, 22 nF, 22 nF; 220k treble, 1M bass, 25k mid,
  // 33k slope); EL34s, a diode rectifier.
  crunch: {
    v: {
      stageGains: [8, 3, 25],
      stackAt: 3,
      shelfHz: [85, 1, 290],
      shelfKeep: [0.45, 1, 0.5],
      couplingHz: [20, 160, 30],
      millerHz: [18000, 14000, 12000],
      inputHz: 60,
      asymmetry: 2.2,
      bias: 0.3,
      bright: 5,
      stack: { c1: 470e-12, c2: 22e-9, c3: 22e-9, r1: 220000, r2: 1000000, r3: 25000, r4: 33000 },
      stackGain: 2,
      powerDrive: 2,
      powerBias: 0,
      presenceHz: 3500,
      presenceDb: 7,
      depthHz: 100,
      depthDb: 3,
      lowHz: 45,
      highHz: 14000,
    },
    trim: -1.6,
    sag: 0.8,
  },
  // The crunch head with a fourth stage cascaded in, a tighter input and a
  // stack with a bigger slope resistor (more mids).
  lead: {
    v: {
      stageGains: [10, 3, 25, 12],
      stackAt: 4,
      shelfHz: [180, 1, 290, 290],
      shelfKeep: [0.45, 1, 0.5, 0.6],
      couplingHz: [30, 220, 60, 40],
      millerHz: [18000, 14000, 12000, 10000],
      inputHz: 160,
      asymmetry: 2.3,
      bias: 0.33,
      bright: 4,
      stack: { c1: 470e-12, c2: 22e-9, c3: 22e-9, r1: 220000, r2: 1000000, r3: 25000, r4: 47000 },
      stackGain: 2,
      powerDrive: 2,
      powerBias: 0,
      presenceHz: 3500,
      presenceDb: 7,
      depthHz: 100,
      depthDb: 4,
      lowHz: 45,
      highHz: 13000,
    },
    trim: -2.4,
    sag: 0.8,
  },
};

/** Supply sag per rectifier: the tube rectifier sags and blooms, the
 * diodes stay stiff and tight. */
/** The tube rectifier's softer supply also drives the power amp harder
 * into compression (with the level matched back) and loosens the low end a
 * little. */
const TUBE = { drive: 1.6, trim: -3.3, input: 0.85 };
const SAG: Record<AmpRectifier, number> = { tube: 1.5, diode: 0.89 };

const knob = (v: number | undefined, fallback: number) => Math.min(1, Math.max(0, (v ?? fallback) / 10));

/** The kernel settings for a Furnace's params. */
export function ampSettingsFromParams(params: Record<string, number>): AmpSettings {
  const knobs = {
    gain: knob(params.gain, AMP_DEFAULTS.gain),
    bass: knob(params.bass, AMP_DEFAULTS.bass),
    mid: knob(params.mid, AMP_DEFAULTS.mid),
    treble: knob(params.treble, AMP_DEFAULTS.treble),
    presence: knob(params.presence, AMP_DEFAULTS.presence),
    master: knob(params.master, AMP_DEFAULTS.master),
  };
  const model = ampModel(params.amp);
  if (model !== "highGain") {
    const c = CLASSICS[model];
    return { ...c.v, ...knobs, output: (params.output ?? 0) + c.trim, sag: c.sag };
  }
  const { v, trim } = voicing(ampMode(params.mode));
  const tube = ampRectifier(params.rectifier) === "tube";
  return {
    ...v,
    ...knobs,
    output: (params.output ?? 0) + trim + (tube ? TUBE.trim : 0),
    sag: SAG[ampRectifier(params.rectifier)],
    powerDrive: v.powerDrive * (tube ? TUBE.drive : 1),
    inputHz: v.inputHz * (tube ? TUBE.input : 1),
  };
}

interface BiquadLike {
  b0: number; b1: number; b2: number; a1: number; a2: number;
  set(type: string, fc: number, q: number, db: number, fs: number): void;
}
const evaluated = new Function(`${AMP_SOURCE}; return { stackResponse, Biquad };`)() as {
  stackResponse(st: AmpSettings["stack"], t: number, l: number, m: number, w: number): [number, number];
  Biquad: new () => BiquadLike;
};

const taper = (x: number) => (Math.pow(10, 2 * x) - 1) / 99;

function biquadDb(q: BiquadLike, f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = q.b0 + q.b1 * c1 + q.b2 * c2, ni = -(q.b1 * s1 + q.b2 * s2);
  const dr = 1 + q.a1 * c1 + q.a2 * c2, di = -(q.a1 * s1 + q.a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** The amp's tone shaping after the distortion (the tone stack, presence
 * and depth), in dB at each of `freqs`, for the window's curve. */
export function ampToneCurve(params: Record<string, number>, freqs: number[]): number[] {
  const s = ampSettingsFromParams(params);
  const fs = 192000;
  const presence = new evaluated.Biquad(), depth = new evaluated.Biquad();
  presence.set("highshelf", s.presenceHz, 0.7, s.presenceDb * s.presence, fs);
  depth.set("peak", s.depthHz, 0.9, s.depthDb, fs);
  return freqs.map((f) => {
    const [re, im] = evaluated.stackResponse(s.stack, s.treble, taper(s.bass), taper(s.mid), 2 * Math.PI * f);
    return 10 * Math.log10(re * re + im * im + 1e-24) + biquadDb(presence, f, fs) + biquadDb(depth, f, fs);
  });
}
