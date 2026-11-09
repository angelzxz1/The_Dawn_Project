import * as Tone from "tone";
import { CRUSHER_LATENCY, CRUSHER_SOURCE, crusherSettingsFromParams } from "./crusherModel";
import { loadWorklet } from "../../engine/workletLoader";

// The Crusher effect: crusherModel.ts's kernel in an AudioWorklet.

const PROCESSOR_NAME = "dawn-crusher-v1";
const METER_INTERVAL = 512;

const PROCESSOR_CODE = `
${CRUSHER_SOURCE}
class DawnCrusher extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.kernel = new CrusherKernel(sampleRate);
    this.kernel.set(options.processorOptions);
    this.count = 0;
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === "dispose") this.alive = false;
      else this.kernel.set(e.data);
    };
  }
  process(inputs, outputs) {
    const input = inputs[0] || [];
    const out = outputs[0];
    const n = out[0].length;
    this.kernel.process(input[0] || null, input[1] || null, out[0], out[1] || null, n);
    this.count += n;
    if (this.count >= ${METER_INTERVAL}) {
      this.count = 0;
      this.port.postMessage(this.kernel.takeMeters());
    }
    return this.alive;
  }
}
registerProcessor("${PROCESSOR_NAME}", DawnCrusher);
`;

export interface CrusherMeterReading {
  /** dB of gain reduction, >= 0. */
  gainReduction: number;
  /** Input and output peaks, dBFS. */
  input: number;
  output: number;
}

const SILENT: CrusherMeterReading = { gainReduction: 0, input: -Infinity, output: -Infinity };

export class CrusherChain extends Tone.ToneAudioNode {
  readonly name = "CrusherChain";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  private worklet: AudioWorkletNode | null = null;
  private params: Record<string, number>;
  private pending = false;
  private reading: CrusherMeterReading = SILENT;
  private readingAt = 0;
  private isDisposed = false;

  constructor(params: Record<string, number>) {
    super();
    this.params = { ...params };
    loadWorklet(this.context, PROCESSOR_NAME, PROCESSOR_CODE).then(() => {
      if (this.isDisposed) return;
      const node = this.context.createAudioWorkletNode(PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: crusherSettingsFromParams(this.params),
      });
      node.port.onmessage = (e: MessageEvent<{ gainReduction: number; input: number; output: number }>) => {
        this.reading = { gainReduction: e.data.gainReduction, input: Tone.gainToDb(e.data.input), output: Tone.gainToDb(e.data.output) };
        this.readingAt = performance.now();
      };
      this.worklet = node;
      this.input.connect(node);
      Tone.connect(node, this.output);
    });
  }

  setParam(key: string, value: number): void {
    this.params[key] = value;
    if (this.pending || !this.worklet) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.worklet?.port.postMessage(crusherSettingsFromParams(this.params));
    });
  }

  /** Seconds the oversampling delays the audio. */
  get latency(): number {
    return CRUSHER_LATENCY / this.context.sampleRate;
  }

  /** The latest meters - at rest once audio stops arriving. */
  get meters(): CrusherMeterReading {
    return performance.now() - this.readingAt > 300 ? SILENT : this.reading;
  }

  dispose(): this {
    super.dispose();
    this.isDisposed = true;
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.port.postMessage("dispose");
      this.worklet.disconnect();
    }
    this.input.dispose();
    this.output.dispose();
    return this;
  }
}
