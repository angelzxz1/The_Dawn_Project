// A take recorded by the native engine, from the studio's side: its live
// waveform, built from the buckets each status brings (the engine sends each
// 64 frames' lowest and highest, waveform.ts's WAVE_BUCKET), and the clicks
// it plays to measure the round trip (src-tauri/src/audio/take.rs).

import { WAVE_BUCKET, type Waveform } from "../waveform";

/** Where the engine plays the clicks measuring the round trip, from the
 * capture's start (s): take.rs's PROBE_CLICKS. */
export const PROBE_CLICKS = [0.3, 0.9, 1.5, 2.1, 2.7];

/** The click it plays: 4 ms of 2.5 kHz, faded in and out (take.rs's
 * probe_click). */
export function probeClick(sampleRate: number): Float32Array {
  const n = Math.round(0.004 * sampleRate);
  const click = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    click[i] = 0.5 * Math.sin((2 * Math.PI * 2500 * i) / sampleRate) * Math.sin((Math.PI * i) / n);
  }
  return click;
}

/** A take's waveform as it comes in, from the start of its capture. */
export class TakeBuckets {
  private min = new Float32Array(4096);
  private max = new Float32Array(4096);
  private used = 0;
  /** Bumped on every change, so a view knows to redraw. */
  version = 0;

  constructor(readonly sampleRate: number) {}

  /** The buckets one status brought, after those before. */
  add(min: number[], max: number[]): void {
    const n = Math.min(min.length, max.length);
    if (n === 0) return;
    if (this.used + n > this.min.length) {
      let size = this.min.length;
      while (size < this.used + n) size *= 2;
      const [lo, hi] = [new Float32Array(size), new Float32Array(size)];
      lo.set(this.min);
      hi.set(this.max);
      [this.min, this.max] = [lo, hi];
    }
    this.min.set(min.slice(0, n), this.used);
    this.max.set(max.slice(0, n), this.used);
    this.used += n;
    this.version++;
  }

  /** The waveform from frame `from` of the capture on (where the take
   * starts), to the nearest bucket. */
  waveform(from: number): Waveform {
    const skip = Math.max(0, Math.min(this.used, Math.round(from / WAVE_BUCKET)));
    return {
      min: this.min.subarray(skip),
      max: this.max.subarray(skip),
      length: this.used - skip,
      bucketSeconds: WAVE_BUCKET / this.sampleRate,
    };
  }
}
