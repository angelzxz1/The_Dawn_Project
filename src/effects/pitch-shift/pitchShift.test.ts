import { describe, expect, it } from "vitest";
import { PITCH_SHIFT_SOURCE, pitchLatency, pitchMode, pitchSettingsFromParams, type PitchKernelSettings } from "./pitchShiftKernel";
import { guitarTuning, intervalLabel } from "./pitchInterval";

const SR = 48000;
const Kernel = new Function(`${PITCH_SHIFT_SOURCE}; return PitchKernel;`)() as new (sr: number) => {
  set(s: PitchKernelSettings): void;
  process(inL: Float32Array | null, inR: Float32Array | null, outL: Float32Array, outR: Float32Array | null, n: number): void;
};

function run(params: Record<string, number>, input: Float32Array) {
  const k = new Kernel(SR);
  k.set(pitchSettingsFromParams(params));
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 128) k.process(input.subarray(i, i + 128), null, out.subarray(i, i + 128), null, Math.min(128, input.length - i));
  return out;
}
const N = SR * 2;
const tones = (fs: number[]) => new Float32Array(N).map((_, i) => fs.reduce((a, f) => a + 0.2 * Math.sin((2 * Math.PI * f * i) / SR), 0));
/** Amplitude at f over the second second (Hann-windowed). */
function amp(x: Float32Array, f: number) {
  let re = 0, im = 0, ws = 0;
  for (let i = SR; i < N; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - SR)) / (SR - 1));
    re += w * x[i] * Math.cos((2 * Math.PI * f * i) / SR);
    im += w * x[i] * Math.sin((2 * Math.PI * f * i) / SR);
    ws += w;
  }
  return (2 * Math.hypot(re, im)) / ws;
}
/** The share (dB) of the second second's energy that's at `targets`. */
function purity(x: Float32Array, targets: number[]) {
  let e = 0;
  for (let i = SR; i < N; i++) e += x[i] * x[i];
  return 10 * Math.log10(targets.reduce((a, f) => a + amp(x, f) ** 2 / 2, 0) / (e / SR));
}
/** How much a held note's level wobbles (%), over whole cycles. */
function wobble(x: Float32Array, f: number) {
  const len = Math.round((Math.round(0.02 * f) * SR) / f), levels: number[] = [];
  for (let i = SR; i + len <= N; i += len) {
    let s = 0;
    for (let j = 0; j < len; j++) s += x[i + j] ** 2;
    levels.push(Math.sqrt(s / len));
  }
  const mean = levels.reduce((a, b) => a + b) / levels.length;
  return (100 * Math.sqrt(levels.reduce((a, b) => a + (b - mean) ** 2, 0) / levels.length)) / mean;
}
const CHORD = [82.41, 123.47, 164.81, 207.65, 246.94, 329.63];

describe("Pitch Shift", () => {
  for (const [name, mode] of [["Studio", 1], ["Live", 0]] as const) {
    it(`${name}: a held note lands exactly on the new pitch, steady`, () => {
      for (const pitch of [-2, -12, 7]) {
        const f = 233.1 * 2 ** (pitch / 12);
        const out = run({ mode, pitch }, tones([233.1]));
        // Nearly all the sound is the new note, and its level holds.
        expect(purity(out, [f]), `${pitch}`).toBeGreaterThan(-0.1);
        expect(amp(out, f * 1.003), `${pitch}`).toBeLessThan(amp(out, f) * 0.95);
        expect(wobble(out, f), `${pitch}`).toBeLessThan(0.5);
      }
    });
  }

  it("Studio keeps a low chord's notes apart: every note moves, nothing in between", () => {
    for (const pitch of [-2, -5, -12, 12]) {
      const r = 2 ** (pitch / 12);
      expect(purity(run({ mode: 1, pitch }, tones(CHORD)), CHORD.map((f) => f * r)), `${pitch}`).toBeGreaterThan(-0.2);
    }
  });

  it("Live keeps a chord nearly as clean", () => {
    const r = 2 ** (-2 / 12);
    expect(purity(run({ mode: 0, pitch: -2 }, tones(CHORD)), CHORD.map((f) => f * r))).toBeGreaterThan(-0.5);
  });

  it("an attack comes out on time, with nothing ahead of it", () => {
    // A plucked note at 0.5 s.
    const x = new Float32Array(N);
    let seed = 7;
    const L = Math.round(SR / 110), buf = new Float32Array(L).map(() => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1);
    for (let t = SR / 2, i = 0; t < N; t++, i++) {
      const a = buf[i % L];
      buf[i % L] = 0.498 * (a + buf[(i + 1) % L]);
      x[t] = 0.4 * a;
    }
    for (const mode of [0, 1]) {
      for (const pitch of [-2, -12]) {
        const out = run({ mode, pitch }, x);
        const at = SR / 2 + pitchLatency({ mode }, SR);
        let before = 0, after = 0, peak = 0;
        for (let i = at - 0.08 * SR; i < at - 0.003 * SR; i++) before += out[i] ** 2;
        for (let i = at; i < at + 0.05 * SR; i++) {
          after += out[i] ** 2;
          peak = Math.max(peak, Math.abs(out[i]));
        }
        expect(10 * Math.log10(before / after + 1e-12), `mode ${mode}, ${pitch}`).toBeLessThan(-40);
        // Half its height within 5 ms of where it should be.
        let rise = at - 0.01 * SR;
        while (Math.abs(out[rise]) < 0.5 * peak) rise++;
        expect(Math.abs(rise - at) / SR, `mode ${mode}, ${pitch}`).toBeLessThan(0.005);
      }
    }
  });

  it("dry comes out as late as wet, and Dry/Wet is equal-power", () => {
    for (const mode of [0, 1]) {
      const impulse = new Float32Array(SR / 4);
      impulse[100] = 1;
      const dry = run({ mode, pitch: -2, wet: 0 }, impulse);
      const hits = [...dry.keys()].filter((i) => Math.abs(dry[i]) > 1e-6);
      expect(hits).toEqual([100 + pitchLatency({ mode }, SR)]);
      const wet = run({ mode, pitch: -2, wet: 1 }, impulse);
      const half = run({ mode, pitch: -2, wet: 0.5 }, impulse);
      for (let i = 0; i < half.length; i += 7) expect(half[i]).toBeCloseTo(Math.SQRT1_2 * (dry[i] + wet[i]), 6);
    }
  });

  it("is silent on silence, and finite with feedback at full", () => {
    for (const mode of [0, 1]) {
      expect(run({ mode, pitch: 7 }, new Float32Array(SR / 2)).every((v) => v === 0)).toBe(true);
      expect(run({ mode, pitch: 12, feedback: 0.9 }, tones([440])).every(Number.isFinite)).toBe(true);
    }
  });

  it("a Pitch Shift from before the Mode switch plays in Studio", () => {
    expect(pitchMode(undefined)).toBe("studio");
    expect(pitchSettingsFromParams({ pitch: 3 }).mode).toBe(1);
    expect(pitchLatency({ mode: 1 }, SR)).toBe(4096);
    expect(pitchLatency({ mode: 0 }, SR)).toBe(148);
  });

  it("names the tuning a guitar in E standard ends up in", () => {
    expect(guitarTuning(-2, 0)).toBe("D standard (whole step down)");
    expect(guitarTuning(-1, 0)).toBe("E♭ standard (half step down)");
    expect(guitarTuning(-2, 30)).toBeNull();
    expect(guitarTuning(3, 0)).toBeNull();
    expect(intervalLabel(-12)).toBe("-12 st · Octave down");
  });
});
