import { describe, expect, it } from "vitest";
import { TREMOR_LATENCY, TREMOR_SOURCE, tremorEqCurve, tremorSettingsFromParams, type TremorSettings } from "./tremorModel";
import { FACTORY_PRESETS } from "../presets";

const SR = 48000;
const Kernel = new Function(`${TREMOR_SOURCE}; return TremorKernel;`)() as new (sr: number) => {
  set(s: TremorSettings): void;
  process(input: Float32Array | null, output: Float32Array, n: number): void;
};

function run(params: Record<string, number>, input: Float32Array) {
  const k = new Kernel(SR);
  k.set(tremorSettingsFromParams(params));
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 128) k.process(input.subarray(i, i + 128), out.subarray(i, i + 128), Math.min(128, input.length - i));
  return out;
}
const sine = (f: number, db: number, seconds = 0.5) =>
  new Float32Array(Math.round(seconds * SR)).map((_, i) => Math.pow(10, db / 20) * Math.sin((2 * Math.PI * f * i) / SR));
/** A bass note: A1 with its harmonics, plucked. */
const note = new Float32Array(SR).map((_, i) => {
  const t = i / SR;
  let v = 0;
  for (let k = 1; k <= 12; k++) v += Math.sin(2 * Math.PI * 55 * k * t) / k ** 1.3;
  return 0.18 * Math.exp(-t * 1.5) * v;
});
/** RMS (dB) over the second half. */
function rms(x: Float32Array) {
  let s = 0;
  for (let i = x.length / 2; i < x.length; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / (x.length / 2));
}
/** Amplitude of frequency f over the second half (Hann-windowed). */
function amp(x: Float32Array, f: number) {
  const a = Math.floor(x.length / 2), b = x.length;
  let re = 0, im = 0, ws = 0;
  for (let i = a; i < b; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - a)) / (b - a - 1));
    re += w * x[i] * Math.cos((2 * Math.PI * f * i) / SR);
    im += w * x[i] * Math.sin((2 * Math.PI * f * i) / SR);
    ws += w;
  }
  return (2 * Math.hypot(re, im)) / ws;
}
const thd = (out: Float32Array, f: number) => Math.hypot(...[2, 3, 4, 5, 6].map((k) => amp(out, f * k))) / amp(out, f);
const dB = (x: number) => 20 * Math.log10(x);
const flat = { bass: 5, mid: 5, treble: 5 };

describe("Tremor", () => {
  it("every voice plays at about the level it's given, at its defaults", () => {
    for (const voice of [0, 1, 2]) expect(Math.abs(rms(run({ voice }, note)) - rms(note)), `voice ${voice}`).toBeLessThan(3);
  });

  it("more Gain, more distortion, in every voice", () => {
    for (const voice of [0, 1, 2]) {
      const at = (gain: number) => thd(run({ voice, gain, blend: 10, comp: 0, ...flat }, sine(330, -20)), 330);
      expect(at(9), `voice ${voice}`).toBeGreaterThan(at(2) * 1.5);
    }
  });

  it("the Tube clips one side first (even harmonics); the Grind evenly (odd)", () => {
    const h2h3 = (voice: number) => {
      const out = run({ voice, gain: 6, blend: 10, comp: 0, ...flat }, sine(110, -16));
      return amp(out, 220) / amp(out, 330);
    };
    expect(h2h3(0)).toBeGreaterThan(0.5);
    expect(h2h3(1)).toBeLessThan(0.2);
  });

  it("Blend at 0 is the clean bass, however much Gain", () => {
    const out = run({ voice: 1, gain: 10, blend: 0, comp: 0, ...flat }, sine(110, -20));
    expect(thd(out, 110)).toBeLessThan(0.01);
  });

  it("the Split keeps the lows clean and distorts above the split", () => {
    const split = { voice: 2, gain: 9, blend: 10, comp: 0, ...flat, lowSplit: 250 };
    // Only the distorted bands: a low note barely gets in, a mid one does.
    expect(rms(run(split, sine(60, -20)))).toBeLessThan(rms(run(split, sine(800, -20))) - 20);
    // Only the clean low band: a low note stays clean.
    expect(thd(run({ ...split, blend: 0 }, sine(60, -20)), 60)).toBeLessThan(0.01);
  });

  it("Grunt sets how much low end reaches the Grind's drive", () => {
    const low = (grunt: number) => amp(run({ voice: 1, gain: 3, blend: 10, comp: 0, grunt, ...flat }, sine(55, -30)), 55);
    expect(dB(low(2))).toBeGreaterThan(dB(low(0)) + 6);
  });

  it("Comp evens out the clean path", () => {
    const swing = (comp: number) => {
      const p = { voice: 0, blend: 0, comp, ...flat };
      return rms(run(p, sine(110, -6))) - rms(run(p, sine(110, -26)));
    };
    expect(swing(0)).toBeCloseTo(20, 0);
    expect(swing(10)).toBeLessThan(8);
  });

  it("the EQ curve follows the knobs, and Ultra Lo works only on the Tube", () => {
    const at = (p: Record<string, number>, f: number) => tremorEqCurve({ ...flat, ...p }, [f])[0];
    expect(at({}, 1000)).toBeCloseTo(0, 1);
    expect(at({ bass: 10 }, 60)).toBeGreaterThan(8);
    expect(at({ mid: 0, midFreq: 2 }, 1000)).toBeLessThan(-8);
    expect(at({ treble: 10 }, 8000)).toBeGreaterThan(8);
    expect(at({ voice: 0, ultraLo: 1 }, 500)).toBeLessThan(-6);
    expect(at({ voice: 0, ultraLo: 2 }, 30)).toBeLessThan(-6);
    expect(at({ voice: 1, ultraLo: 1 }, 500)).toBeCloseTo(0, 1);
  });

  it("is silent on silence, and stays finite on a full-scale burst", () => {
    for (const voice of [0, 1, 2]) {
      const silent = run({ voice }, new Float32Array(SR / 4));
      expect(Math.max(...silent.map(Math.abs))).toBeLessThan(1e-6);
      expect(run({ voice, gain: 10, comp: 10, output: 24 }, sine(80, 0, 0.3)).every(Number.isFinite)).toBe(true);
    }
  });

  it("its presets stay near the input's level", () => {
    const presets = FACTORY_PRESETS.filter((p) => p.type === "tremor");
    expect(presets.length).toBeGreaterThanOrEqual(6);
    for (const p of presets) expect(Math.abs(rms(run(p.params, note)) - rms(note)), p.name).toBeLessThan(4);
  });

  it("reports the oversampling latency", () => {
    expect(TREMOR_LATENCY).toBe(16);
  });
});
