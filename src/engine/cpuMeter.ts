import * as Tone from "tone";
import { loadWorklet } from "./workletLoader";
import { noteIssue } from "../services/issues";

// A CPU meter for the audio engine, like a DAW's: the share of each audio
// block's real-time budget that rendering it takes. Browsers don't report
// this, so it's measured: a "start" probe runs first in every render
// quantum and stamps the time, and an "end" probe - between the whole mix
// and the speakers, pulling the start probe as its first input so it runs
// before everything else - reads how long the rest took. Both live in one
// worklet module, so they share that timestamp. Worklets only have a
// millisecond clock, but the ticks land at random points within each
// quantum, so summed over a few hundred quanta the tick counts average out
// to the true time.
//
// In the desktop app, with the native engine on, the meter shows that
// engine's load instead: its status says how long its callbacks took and
// how much audio they made since the last status (noteNativeLoad), summed
// here into readings of the same length.

const MODULE_KEY = "dawn-cpu-meter-v1";
const START = "dawn-cpu-start";
const END = "dawn-cpu-end";
/** How often the end probe reports (seconds of audio). */
const REPORT_SECONDS = 0.25;

const CODE = `
let quantumStart = 0;
class DawnCpuStart extends AudioWorkletProcessor {
  process() {
    quantumStart = Date.now();
    return true;
  }
}
class DawnCpuEnd extends AudioWorkletProcessor {
  constructor() {
    super();
    this.busy = 0;
    this.frames = 0;
  }
  process(inputs, outputs) {
    const mix = inputs[1] || [];
    const out = outputs[0];
    for (let ch = 0; ch < out.length; ch++) {
      const src = mix[ch] || mix[0];
      if (src) out[ch].set(src);
      else out[ch].fill(0);
    }
    this.busy += Date.now() - quantumStart;
    this.frames += out[0].length;
    if (this.frames >= sampleRate * ${REPORT_SECONDS}) {
      this.port.postMessage({ busy: this.busy, audio: (this.frames / sampleRate) * 1000 });
      this.busy = 0;
      this.frames = 0;
    }
    return true;
  }
}
registerProcessor("${START}", DawnCpuStart);
registerProcessor("${END}", DawnCpuEnd);
`;

export interface CpuReading {
  /** Which engine it measures. */
  source: "browser" | "native";
  /** Average share of real time spent rendering, 0..1+, over ~1 s. */
  average: number;
  /** Highest 0.25 s reading in the last few seconds. */
  peak: number;
}

let installed: Promise<void> | null = null;
type Reading = { load: number; at: number };
const readings: Reading[] = [];
const native = { busy: 0, audio: 0, readings: [] as Reading[] };

function keep(list: Reading[], load: number): void {
  list.push({ load, at: performance.now() });
  while (list.length > 16) list.shift();
}

/** Puts the probes in front of the speakers (once). */
export function installCpuMeter(): Promise<void> {
  if (installed) return installed;
  const ctx = Tone.getContext();
  installed = loadWorklet(ctx, MODULE_KEY, CODE)
    .then(() => {
      const start = ctx.createAudioWorkletNode(START, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      const end = ctx.createAudioWorkletNode(END, {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });
      end.port.onmessage = (e: MessageEvent<{ busy: number; audio: number }>) => {
        keep(readings, e.data.busy / e.data.audio);
      };
      const destination = Tone.getDestination();
      // Tone's master output normally goes straight to the speakers; route
      // it through the end probe instead.
      destination.output.disconnect();
      Tone.connect(destination.output, end, 0, 1);
      Tone.connect(start, end, 0, 0);
      Tone.connect(end, ctx.rawContext.destination);
    })
    .catch((error) => {
      // No worklets: no meter (the mix keeps its normal route).
      noteIssue("cpumeter", error);
    });
  return installed;
}

/** The native engine's time since its last status: how long its
 * callbacks took and how much audio they made (ms). */
export function noteNativeLoad(busyMs: number, audioMs: number): void {
  if (!(busyMs >= 0 && audioMs > 0)) return;
  native.busy += busyMs;
  native.audio += audioMs;
  if (native.audio >= REPORT_SECONDS * 1000) {
    keep(native.readings, native.busy / native.audio);
    native.busy = 0;
    native.audio = 0;
  }
}

function readingOf(list: Reading[], source: CpuReading["source"]): CpuReading | null {
  const now = performance.now();
  const recent = list.filter((r) => now - r.at < 3000);
  if (!recent.length || now - recent[recent.length - 1].at > 1000) return null;
  const last = recent.slice(-4);
  return {
    source,
    average: last.reduce((sum, r) => sum + r.load, 0) / last.length,
    peak: Math.max(...recent.map((r) => r.load)),
  };
}

/** The latest load: the native engine's while it's playing the song, else
 * the browser's; null when neither is running or the audio has been idle
 * (the browser suspends rendering). */
export function cpuReading(): CpuReading | null {
  return readingOf(native.readings, "native") ?? readingOf(readings, "browser");
}
