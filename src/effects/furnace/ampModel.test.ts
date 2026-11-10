import { describe, expect, it } from "vitest";
import { AMP_SOURCE, type AmpSettings } from "./ampKernel";
import { AMP_MODELS, AMP_MODES, ampMatchingCab, ampSettingsFromParams, ampToneCurve } from "./ampModel";
import { paramSpecs } from "../registry";
import { FACTORY_PRESETS, findPreset } from "../presets";
import { factoryCab } from "../ir-loader/cabIrs";

const SR = 48000;
const Kernel = new Function(`${AMP_SOURCE}; return AmpKernel;`)() as new (sr: number) => {
  set(s: AmpSettings): void;
  process(input: Float32Array | null, output: Float32Array, n: number): void;
};
const defaults = () => Object.fromEntries(paramSpecs("tubeAmp").map((s) => [s.key, s.default]));
function rms(params: Record<string, number>, input: Float32Array) {
  const k = new Kernel(SR);
  k.set(ampSettingsFromParams(params));
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 128) k.process(input.subarray(i, i + 128), out.subarray(i, i + 128), Math.min(128, input.length - i));
  let s = 0;
  for (let i = input.length / 2; i < input.length; i++) s += out[i] * out[i];
  return 10 * Math.log10(s / (input.length / 2));
}
/** How much a 10 dB louder input comes out less than 10 dB louder: the
 * amp's compression, which grows as it breaks up. */
function compression(params: Record<string, number>) {
  const sine = (db: number) => new Float32Array(SR / 2).map((_, i) => Math.pow(10, db / 20) * Math.sin((2 * Math.PI * 200 * i) / SR));
  return 10 - (rms(params, sine(-20)) - rms(params, sine(-30)));
}
/** The level of harmonic k of 200 Hz relative to the fundamental (dB), over
 * the second half. */
function harmonic(s: AmpSettings, k: number) {
  const kernel = new Kernel(SR);
  kernel.set(s);
  const input = new Float32Array(SR / 2).map((_, i) => 0.1 * Math.sin((2 * Math.PI * 200 * i) / SR));
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 128) kernel.process(input.subarray(i, i + 128), out.subarray(i, i + 128), 128);
  const bin = (f: number) => {
    let re = 0, im = 0;
    for (let i = input.length / 2; i < input.length; i++) {
      re += out[i] * Math.cos((2 * Math.PI * f * i) / SR);
      im += out[i] * Math.sin((2 * Math.PI * f * i) / SR);
    }
    return Math.hypot(re, im);
  };
  return 20 * Math.log10(bin(200 * k) / bin(200));
}
const chord = new Float32Array(SR / 2).map((_, i) => 0.05 * [82.4, 123.5, 164.8].reduce((a, f) => a + Math.sin((2 * Math.PI * f * i) / SR), 0));

describe("Furnace params", () => {
  it("every amp and mode gives the kernel a consistent voicing", () => {
    const voicings = [...AMP_MODES.map((_, mode) => ({ mode })), ...AMP_MODELS.map((_, amp) => ({ amp }))];
    for (const p of voicings) {
      const s = ampSettingsFromParams({ ...defaults(), ...p });
      const n = s.stageGains.length;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(4);
      expect(s.stackAt).toBeGreaterThanOrEqual(1);
      expect(s.stackAt).toBeLessThanOrEqual(n);
      [s.shelfHz, s.shelfKeep, s.couplingHz, s.millerHz].forEach((a) => expect(a).toHaveLength(n));
    }
  });

  it("a Furnace from before the Amp selector is still the High Gain head", () => {
    expect(defaults().amp).toBe(AMP_MODELS.indexOf("highGain"));
    expect(ampSettingsFromParams({ gain: 6, mode: 1 })).toEqual(ampSettingsFromParams({ gain: 6, mode: 1, amp: AMP_MODELS.indexOf("highGain") }));
  });

  it("the amps break up in order: Clean American last, British Lead first", () => {
    const at = (model: string, gain: number) => compression({ ...defaults(), amp: AMP_MODELS.indexOf(model as never), gain });
    // Clean American stays clean at 4 and breaks up by 10.
    expect(at("clean", 4)).toBeLessThan(0.5);
    expect(at("clean", 10)).toBeGreaterThan(3);
    const order = ["clean", "chime", "crunch", "lead"].map((m) => at(m, 5));
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    expect(at("lead", 7)).toBeGreaterThan(8);
  });

  it("the Chime's class A power amp adds even harmonics", () => {
    const s = ampSettingsFromParams({ ...defaults(), amp: AMP_MODELS.indexOf("chime"), gain: 6, master: 8 });
    expect(harmonic(s, 2)).toBeGreaterThan(harmonic({ ...s, powerBias: 0 }, 2) + 6);
  });

  it("Presence is Cut on the Chime: turning it up darkens", () => {
    const at = (amp: number, presence: number) => ampToneCurve({ ...defaults(), amp, presence }, [5000])[0];
    const chime = AMP_MODELS.indexOf("chime");
    expect(at(chime, 10)).toBeLessThan(at(chime, 0) - 6);
    expect(at(AMP_MODELS.indexOf("crunch"), 10)).toBeGreaterThan(at(AMP_MODELS.indexOf("crunch"), 0) + 3);
  });

  it("every amp has a factory cabinet to go with it", () => {
    for (const m of AMP_MODELS) expect(factoryCab(ampMatchingCab(m))?.use, m).toBe("guitar");
  });

  it("maps the 0-10 knobs to positions and the rectifier to sag", () => {
    const s = ampSettingsFromParams({ ...defaults(), gain: 10, bass: 0, master: 5 });
    expect(s.gain).toBe(1);
    expect(s.bass).toBe(0);
    expect(s.master).toBe(0.5);
    expect(ampSettingsFromParams({ rectifier: 0 }).sag).toBeGreaterThan(ampSettingsFromParams({ rectifier: 1 }).sag);
  });

  it("the tone curve follows the knobs", () => {
    const at = (p: Record<string, number>, f: number) => ampToneCurve({ ...defaults(), ...p }, [f])[0];
    expect(at({ bass: 10 }, 80)).toBeGreaterThan(at({ bass: 0 }, 80) + 3);
    expect(at({ mid: 10 }, 600)).toBeGreaterThan(at({ mid: 0 }, 600) + 3);
    expect(at({ presence: 10 }, 5000)).toBeGreaterThan(at({ presence: 0 }, 5000) + 3);
  });

  it("the modes, amps and presets stay within a sensible level of each other", () => {
    const base = rms(defaults(), chord);
    expect(Number.isFinite(base)).toBe(true);
    for (const mode of [0, 1]) expect(Math.abs(rms({ ...defaults(), mode }, chord) - base)).toBeLessThan(8);
    for (const amp of AMP_MODELS.keys()) expect(Math.abs(rms({ ...defaults(), amp }, chord) - base)).toBeLessThan(3);
    for (const preset of FACTORY_PRESETS.filter((p) => p.type === "tubeAmp" && p.params.amp !== undefined)) {
      expect(Math.abs(rms({ ...defaults(), ...preset.params }, chord) - base), preset.name).toBeLessThan(5);
    }
    for (const id of ["modern-lead", "tube-rectifier-bloom", "vintage-crunch", "raw-edge"]) {
      const preset = findPreset(`factory:tubeAmp:${id}`);
      expect(preset).toBeTruthy();
      expect(Math.abs(rms({ ...defaults(), ...preset!.params }, chord) - base)).toBeLessThan(10);
    }
  });
});
