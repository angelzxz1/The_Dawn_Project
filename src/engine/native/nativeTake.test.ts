import { describe, expect, test } from "vitest";
import { PROBE_CLICKS, probeClick, TakeBuckets } from "./nativeTake";
import { detectRoundTrip } from "../latency";
import { WAVE_BUCKET } from "../waveform";

describe("a native take, from the studio's side", () => {
  test("its waveform grows with each status, and starts where the take does", () => {
    const take = new TakeBuckets(48000);
    take.add([-0.1, -0.2], [0.1, 0.2]);
    const v = take.version;
    take.add(new Array(5000).fill(-0.5), new Array(5000).fill(0.5));
    expect(take.version).toBeGreaterThan(v);
    const all = take.waveform(0);
    expect(all.length).toBe(5002);
    expect(all.max[1]).toBeCloseTo(0.2);
    expect(all.bucketSeconds).toBeCloseTo(WAVE_BUCKET / 48000);
    // From two buckets in.
    const later = take.waveform(2 * WAVE_BUCKET);
    expect(later.length).toBe(5000);
    expect(later.max[0]).toBeCloseTo(0.5);
    // Past what's come in, nothing yet.
    expect(take.waveform(10_000 * WAVE_BUCKET).length).toBe(0);
  });

  test("the probe's clicks, heard back late, give the round trip", () => {
    const sr = 48000;
    const click = probeClick(sr);
    expect(click.length).toBe(192);
    const late = Math.round(0.0123 * sr);
    const samples = new Float32Array(3.3 * sr);
    for (const at of PROBE_CLICKS) samples.set(click.map((v) => v * 0.3), Math.round(at * sr) + late);
    const rt = detectRoundTrip(samples, sr, PROBE_CLICKS.map((t) => Math.round(t * sr)), click);
    expect(rt).toBeCloseTo(late / sr, 4);
  });
});
