import { describe, expect, it } from "vitest";
import { defaultParams } from "../registry";
import { CRUSHER_LATENCY, CRUSHER_SOURCE, crusherAttack, crusherInputDb, crusherOutputDb, crusherRelease, crusherSettingsFromParams, type CrusherSettings } from "./crusherModel";

const SR = 48000;
interface Kernel {
  set(s: CrusherSettings): void;
  process(inL: Float32Array | null, inR: Float32Array | null, outL: Float32Array, outR: Float32Array | null, n: number): void;
  takeMeters(): { gainReduction: number; output: number; input: number };
  gr: number;
  slow: number;
}
const Crusher = new Function(`${CRUSHER_SOURCE}; return CrusherKernel;`)() as new (sr: number) => Kernel;

const sine = (f: number, db: number, seconds = 0.5) =>
  new Float32Array(Math.round(seconds * SR)).map((_, i) => Math.pow(10, db / 20) * Math.sin((2 * Math.PI * f * i) / SR));
const peakDb = (d: Float32Array, from = 0.5) => 20 * Math.log10(d.subarray(Math.floor(d.length * from)).reduce((p, v) => Math.max(p, Math.abs(v)), 0) + 1e-12);

function make(params: Record<string, number>) {
  const k = new Crusher(SR);
  k.set(crusherSettingsFromParams({ ...defaultParams("crusher"), ...params }));
  return k;
}
function run(k: Kernel, input: Float32Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 128) {
    const n = Math.min(128, input.length - i);
    k.process(input.subarray(i, i + n), null, out.subarray(i, i + n), null, n);
  }
  return out;
}
/** The level (dB) of the `f` Hz part of the second half of `d`. */
function partDb(d: Float32Array, f: number): number {
  const x = d.subarray(d.length / 2);
  let re = 0;
  let im = 0;
  for (let i = 0; i < x.length; i++) {
    re += x[i] * Math.cos((2 * Math.PI * f * i) / SR);
    im += x[i] * Math.sin((2 * Math.PI * f * i) / SR);
  }
  return 20 * Math.log10((2 * Math.hypot(re, im)) / x.length + 1e-12);
}

describe("crusher", () => {
  it("the knobs read like the hardware's", () => {
    expect(crusherInputDb(5) + crusherOutputDb(5)).toBe(0);
    expect(crusherAttack(0)).toBeCloseTo(0.00005, 8);
    expect(crusherAttack(10)).toBeCloseTo(0.03, 6);
    expect(crusherRelease(0)).toBeCloseTo(0.05, 6);
    expect(crusherRelease(10)).toBeCloseTo(3.5, 6);
  });

  it("with Input and Output at 5, quiet audio comes out as it went in", () => {
    expect(peakDb(run(make({}), sine(1000, -30)))).toBeCloseTo(-30, 1);
  });

  it("compresses by the ratio past the threshold", () => {
    // -6 dB in, +10 dB of Input: 14 dB past -10 dBFS. 4:1 (with its knee
    // well under) takes 10.5 off, then Output's -10.
    expect(peakDb(run(make({ release: 8 }), sine(1000, -6)))).toBeCloseTo(-16.5, 0);
    // 10:1 takes more.
    expect(peakDb(run(make({ ratio: 5, release: 8 }), sine(1000, -6)))).toBeCloseTo(-18.6, 0);
  });

  it("1:1 doesn't compress, and Nuke holds the level at the threshold", () => {
    expect(peakDb(run(make({ ratio: 0 }), sine(1000, -6)))).toBeCloseTo(-6, 1);
    // +30 dB of Input, 0 dB of Output: whatever goes in comes out at -10.
    expect(peakDb(run(make({ ratio: 7, input: 10, output: 7.5, release: 8 }), sine(1000, -6)))).toBeCloseTo(-10, 0);
    expect(peakDb(run(make({ ratio: 7, input: 10, output: 7.5, release: 8 }), sine(1000, -20)))).toBeCloseTo(-10, 0);
  });

  it("in British Mode the louder hit comes out quieter", () => {
    const at = (db: number) => peakDb(run(make({ british: 1, input: 7.5, release: 8 }), sine(1000, db)));
    expect(at(-6)).toBeLessThan(at(-12) - 0.5);
    // The ratio switch doesn't matter then.
    expect(peakDb(run(make({ british: 1, ratio: 0, input: 7.5, release: 8 }), sine(1000, -6)))).toBeCloseTo(at(-6), 3);
  });

  it("Dist 2 adds mostly even harmonics, Dist 3 mostly odd, Clean neither", () => {
    // -6 dBFS into the distortion (after Input's +10 dB).
    const tone = sine(1000, -16, 0.4);
    const harmonics = (dist: number) => {
      const out = run(make({ ratio: 0, dist }), tone);
      const h1 = partDb(out, 1000);
      return { h2: partDb(out, 2000) - h1, h3: partDb(out, 3000) - h1 };
    };
    const clean = harmonics(0);
    const two = harmonics(1);
    const three = harmonics(2);
    expect(Math.max(clean.h2, clean.h3)).toBeLessThan(-80);
    expect(two.h2).toBeGreaterThan(-40);
    expect(two.h2).toBeGreaterThan(two.h3 + 6);
    expect(three.h3).toBeGreaterThan(-40);
    expect(three.h3).toBeGreaterThan(three.h2 + 20);
  });

  it("at 2:1 it lets go slower after a long squash than after a short hit", () => {
    const after = (ratio: number, burst: number) => {
      const k = make({ ratio, input: 8, release: 3 });
      const x = new Float32Array(Math.round(SR * (burst + 0.3)));
      x.set(sine(200, -3, burst));
      run(k, x);
      return k.takeMeters().gainReduction > 0 ? Math.max(k.gr, k.slow) : 0;
    };
    // 300 ms after: still holding more after 2 s than after 30 ms.
    expect(after(1, 2)).toBeGreaterThan(after(1, 0.03) * 2);
    // Another ratio lets go the same either way.
    expect(after(2, 2)).toBeCloseTo(after(2, 0.03), 1);
  });

  it("the detector's HP hears less low end, its Band more sibilance", () => {
    const gr = (params: Record<string, number>, f: number) => {
      const k = make({ ratio: 4, release: 8, ...params });
      run(k, sine(f, -10));
      return k.gr;
    };
    expect(gr({ detHp: 1 }, 40)).toBeLessThan(gr({}, 40) - 3);
    expect(gr({ detHp: 1 }, 2000)).toBeCloseTo(gr({}, 2000), 0);
    expect(gr({ detBand: 1 }, 6800)).toBeGreaterThan(gr({}, 6800) + 5);
    expect(gr({ detBand: 1 }, 300)).toBeCloseTo(gr({}, 300), 0);
  });

  it("Mix at 0 is the dry signal, 15 samples late", () => {
    const impulse = new Float32Array(256);
    impulse[10] = 0.5;
    const out = run(make({ mix: 0, input: 10 }), impulse);
    const at = out.reduce((best, v, i) => (Math.abs(v) > Math.abs(out[best]) ? i : best), 0);
    expect(at - 10).toBe(CRUSHER_LATENCY);
    expect(out[at]).toBeCloseTo(0.5, 1);
    // A steady tone comes through at its level.
    expect(peakDb(run(make({ mix: 0, input: 10 }), sine(1000, -6)))).toBeCloseTo(-6, 1);
  });

  it("meters the gain reduction and the levels", () => {
    const k = make({ release: 8 });
    run(k, sine(1000, -6));
    const m = k.takeMeters();
    expect(m.gainReduction).toBeGreaterThan(9);
    expect(20 * Math.log10(m.input)).toBeCloseTo(-6, 1);
    expect(k.takeMeters().gainReduction).toBe(0);
  });
});
