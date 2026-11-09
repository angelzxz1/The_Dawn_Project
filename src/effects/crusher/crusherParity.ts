// The Crusher's parity fixture for its Rust port
// (crates/dawn-engine/src/effects/crusher.rs): the cases, rendered with the
// worklet's own kernel (crusherModel.ts) the way the worklet runs it
// (crusher.ts), as a generated Rust file and the rendered samples and
// meters. crusherParity.test.ts checks the stored fixture still matches;
// the Rust side's tests/crusher_parity.rs compares the port against it.
// See src/test/kernelParity.ts.

import { CRUSHER_SOURCE, crusherSettingsFromParams, type CrusherSettings } from "./crusherModel";
import { FixtureData, PARITY_BLOCK, PARITY_FRAMES, PARITY_SAMPLE_RATE, PARITY_STRIDE, fnv1a, paritySignal, rustF64, rustHex, type ParitySignal } from "../../test/kernelParity";

interface Meters {
  gainReduction: number;
  output: number;
  input: number;
}

interface Kernel {
  set(s: CrusherSettings): void;
  process(inL: Float32Array | null, inR: Float32Array | null, outL: Float32Array, outR: Float32Array | null, n: number): void;
  takeMeters(): Meters;
}

const Crusher = new Function(`${CRUSHER_SOURCE}; return CrusherKernel;`)() as new (sr: number) => Kernel;

/** How often (frames) the worklet reads the meters (crusher.ts). */
export const CRUSHER_PARITY_METER_INTERVAL = 512;

export interface CrusherParityCase {
  name: string;
  /** Over BASE_PARAMS. */
  params: Record<string, number>;
  input: "mono" | "stereo";
  /** New parameters (over the case's) from this frame on - a block start. */
  change?: { at: number; params: Record<string, number> };
}

/** The Crusher's defaults when the fixture was made. */
const BASE_PARAMS: Record<string, number> = {
  input: 5,
  attack: 5,
  release: 5,
  output: 5,
  ratio: 3,
  dist: 0,
  detHp: 0,
  detBand: 0,
  british: 0,
  mix: 1,
};

const base = { params: {}, input: "stereo" } as const;

export const CRUSHER_PARITY_CASES: CrusherParityCase[] = [
  { ...base, name: "defaults" },
  { ...base, name: "driven-6-to-1", params: { input: 8, attack: 2, release: 1, ratio: 4 } },
  { ...base, name: "nuke-fastest", params: { input: 9, attack: 0, release: 0, ratio: 7, output: 3 } },
  { ...base, name: "opto-2-to-1", params: { input: 8, attack: 4, release: 3, ratio: 1 } },
  { ...base, name: "british", params: { input: 8.5, attack: 3, release: 2, british: 1, output: 3 } },
  { ...base, name: "dist-2", params: { input: 7, ratio: 0, dist: 1, output: 3 } },
  { ...base, name: "dist-3-parallel", params: { input: 7.5, ratio: 5, dist: 2, mix: 0.4 } },
  { ...base, name: "detector-filters", params: { input: 7, ratio: 6, detHp: 1, detBand: 1, attack: 1 } },
  { ...base, name: "mono-in", params: { input: 7, ratio: 2 }, input: "mono" },
  {
    ...base,
    name: "switched-midway",
    params: { input: 6 },
    change: { at: 64 * PARITY_BLOCK, params: { input: 8, output: 3, ratio: 6, dist: 1, mix: 0.6, british: 1 } },
  },
];

const caseParams = (c: CrusherParityCase) => ({ ...BASE_PARAMS, ...c.params });
const changeParams = (c: CrusherParityCase) => (c.change ? { ...caseParams(c), ...c.change.params } : null);

function renderCase(c: CrusherParityCase, sig: ParitySignal) {
  const k = new Crusher(PARITY_SAMPLE_RATE);
  k.set(crusherSettingsFromParams(caseParams(c)));
  const changed = changeParams(c);
  const outL = new Float32Array(PARITY_FRAMES);
  const outR = new Float32Array(PARITY_FRAMES);
  const meters: Meters[] = [];
  let count = 0;
  for (let start = 0; start < PARITY_FRAMES; start += PARITY_BLOCK) {
    if (c.change && changed && start === c.change.at) k.set(crusherSettingsFromParams(changed));
    const n = Math.min(PARITY_BLOCK, PARITY_FRAMES - start);
    const part = (a: Float32Array) => a.subarray(start, start + n);
    k.process(part(sig.inL), c.input === "stereo" ? part(sig.inR) : null, part(outL), part(outR), n);
    count += n;
    if (count >= CRUSHER_PARITY_METER_INTERVAL) {
      count = 0;
      meters.push(k.takeMeters());
    }
  }
  return { outL, outR, meters };
}

const rustParams = (p: Record<string, number>) => `&[${Object.entries(p).map(([k, v]) => `("${k}", ${rustF64(v)})`).join(", ")}]`;

function rustCase(c: CrusherParityCase): string {
  const changed = changeParams(c);
  return [
    "    Case {",
    `        name: "${c.name}",`,
    `        params: ${rustParams(caseParams(c))},`,
    `        stereo: ${c.input === "stereo"},`,
    `        change: ${c.change && changed ? `Some((${c.change.at}, ${rustParams(changed)}))` : "None"},`,
    "    },",
  ].join("\n");
}

/** The fixture as it should be now: the Rust file's text, and the data
 * (per case: the kept left and right samples, then each meter reading's
 * gain reduction, output and input). */
export function renderCrusherParity(): { rust: string; data: FixtureData } {
  const sig = paritySignal();
  const data = new FixtureData();
  for (const c of CRUSHER_PARITY_CASES) {
    const { outL, outR, meters } = renderCase(c, sig);
    for (const out of [outL, outR]) data.f32(out.filter((_, i) => i % PARITY_STRIDE === 0));
    data.f64(meters.flatMap((m) => [m.gainReduction, m.output, m.input]));
  }
  const rust = [
    "// @generated by src/effects/crusher/crusherParity.test.ts from the",
    "// JavaScript kernel (crusherModel.ts). Don't edit it: to remake it,",
    "// run UPDATE_ENGINE_FIXTURES=1 npx vitest run --project unit crusherParity",
    "",
    `const SAMPLE_RATE: f64 = ${rustF64(PARITY_SAMPLE_RATE)};`,
    `const FRAMES: usize = ${PARITY_FRAMES};`,
    `const BLOCK: usize = ${PARITY_BLOCK};`,
    `const STRIDE: usize = ${PARITY_STRIDE};`,
    `const METER_INTERVAL: usize = ${CRUSHER_PARITY_METER_INTERVAL};`,
    `const SIGNAL_HASH: u32 = ${rustHex(fnv1a([sig.inL, sig.inR, sig.keyL, sig.keyR]))};`,
    "",
    "const CASES: &[Case] = &[",
    ...CRUSHER_PARITY_CASES.map(rustCase),
    "];",
    "",
  ].join("\n");
  return { rust, data };
}
