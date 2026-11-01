// The loudness kernel, run as the worklet runs it, against the figures in
// ITU-R BS.1770-4 and the EBU Tech 3341 compliance cases.

import { describe, expect, it } from "vitest";
import { LOUDNESS_KERNEL_SOURCE } from "./loudnessKernel";

interface Kernel {
  process(left: Float32Array, right?: Float32Array): void;
  reset(): void;
  reading(): { momentary: number; shortTerm: number; integrated: number; peak: number };
}
const load = new Function(`${LOUDNESS_KERNEL_SOURCE}; return { LoudnessKernel, kWeighting };`) as () => {
  LoudnessKernel: new (rate: number) => Kernel;
  kWeighting: (rate: number) => { b: number[]; a: number[] }[];
};
const { LoudnessKernel, kWeighting } = load();

const RATE = 48000;
const QUANTUM = 128;

/** Feeds `seconds` of a 1 kHz sine at `dbfs` to both sides. */
function sine(kernel: Kernel, dbfs: number, seconds: number, phase = { n: 0 }) {
  const amp = Math.pow(10, dbfs / 20);
  const total = Math.round(seconds * RATE);
  for (let done = 0; done < total; done += QUANTUM) {
    const block = new Float32Array(QUANTUM);
    for (let i = 0; i < QUANTUM; i++) block[i] = amp * Math.sin((2 * Math.PI * 1000 * phase.n++) / RATE);
    kernel.process(block, block);
  }
}

describe("the loudness kernel", () => {
  it("K-weights with BS.1770's coefficients at 48 kHz", () => {
    const [shelf, highPass] = kWeighting(RATE);
    const close = (got: number[], want: number[]) => got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 8));
    close(shelf.b, [1.53512485958697, -2.69169618940638, 1.19839281085285]);
    close(shelf.a, [-1.69065929318241, 0.73248077421585]);
    close(highPass.a, [-1.99004745483398, 0.99007225036621]);
  });

  it("reads a stereo 1 kHz sine at -23 dBFS as -23 LUFS (Tech 3341, case 1)", () => {
    const kernel = new LoudnessKernel(RATE);
    sine(kernel, -23, 20);
    const r = kernel.reading();
    expect(r.momentary).toBeCloseTo(-23, 1);
    expect(r.shortTerm).toBeCloseTo(-23, 1);
    expect(r.integrated).toBeCloseTo(-23, 1);
    expect(20 * Math.log10(r.peak)).toBeCloseTo(-23, 1);
  });

  it("gates out what's much quieter than the rest (Tech 3341, case 3)", () => {
    const kernel = new LoudnessKernel(RATE);
    const phase = { n: 0 };
    sine(kernel, -36, 10, phase);
    sine(kernel, -23, 60, phase);
    sine(kernel, -36, 10, phase);
    expect(kernel.reading().integrated).toBeCloseTo(-23, 1);
  });

  it("is silent at first and after a reset", () => {
    const kernel = new LoudnessKernel(RATE);
    expect(kernel.reading()).toEqual({ momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity, peak: 0 });
    sine(kernel, -10, 1);
    kernel.reset();
    expect(kernel.reading().integrated).toBe(-Infinity);
  });
});
