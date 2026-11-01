import * as Tone from "tone";
import { loadWorklet } from "./workletLoader";
import { LOUDNESS_KERNEL_SOURCE } from "./loudnessKernel";

// The master's loudness meter: an AudioWorklet running loudnessKernel.ts on
// what reaches the speakers, telling the page its figures ten times a
// second. It only listens (no output).

const PROCESSOR_NAME = "dawn-loudness-v1";

const PROCESSOR_CODE = `
${LOUDNESS_KERNEL_SOURCE}
class DawnLoudness extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kernel = new LoudnessKernel(sampleRate);
    this.since = 0;
    this.every = Math.round(sampleRate / 10);
    this.port.onmessage = (e) => {
      if (e.data === "reset") this.kernel.reset();
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      this.kernel.process(input[0], input[1]);
      this.since += input[0].length;
      if (this.since >= this.every) {
        this.since = 0;
        this.port.postMessage(this.kernel.reading());
      }
    }
    return true;
  }
}
registerProcessor("${PROCESSOR_NAME}", DawnLoudness);
`;

/** LUFS figures (-Infinity: nothing heard yet) and the loudest sample
 * since the last reset, 0-1. */
export interface LoudnessReading {
  momentary: number;
  shortTerm: number;
  integrated: number;
  peak: number;
}

export const SILENT_LOUDNESS: LoudnessReading = { momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity, peak: 0 };

export class LoudnessMeter {
  private node: AudioWorkletNode | null = null;
  private latest: LoudnessReading = SILENT_LOUDNESS;
  private loading: Promise<void> | null = null;

  /** Starts listening to `source` (loads the worklet, once). */
  listen(source: Tone.ToneAudioNode): Promise<void> {
    this.loading ??= (async () => {
      const context = Tone.getContext();
      await loadWorklet(context, PROCESSOR_NAME, PROCESSOR_CODE);
      const node = context.createAudioWorkletNode(PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 2,
        channelCountMode: "explicit",
      });
      node.port.onmessage = (e: MessageEvent<LoudnessReading>) => {
        this.latest = e.data;
      };
      Tone.connect(source, node);
      this.node = node;
    })();
    return this.loading;
  }

  get reading(): LoudnessReading {
    return this.latest;
  }

  /** Starts the integrated loudness and the peak afresh. */
  reset(): void {
    this.latest = { ...this.latest, integrated: -Infinity, peak: 0 };
    this.node?.port.postMessage("reset");
  }
}
