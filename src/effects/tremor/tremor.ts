import * as Tone from "tone";
import { TREMOR_LATENCY, TREMOR_SOURCE, tremorSettingsFromParams } from "./tremorModel";
import { loadWorklet } from "../../engine/workletLoader";

// The Tremor bass amp: tremorModel.ts's kernel in an AudioWorklet. Mono like a
// bass amp (a stereo input is summed); the output feeds both sides.

const PROCESSOR_NAME = "dawn-tremor-v1";

const PROCESSOR_CODE = `
${TREMOR_SOURCE}
class DawnTremor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.kernel = new TremorKernel(sampleRate);
    this.kernel.set(options.processorOptions);
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === "dispose") this.alive = false;
      else this.kernel.set(e.data);
    };
  }
  process(inputs, outputs) {
    const input = inputs[0] || [];
    const out = outputs[0][0];
    this.kernel.process(input[0] || null, out, out.length);
    return this.alive;
  }
}
registerProcessor("${PROCESSOR_NAME}", DawnTremor);
`;

export class TremorChain extends Tone.ToneAudioNode {
  readonly name = "TremorChain";
  readonly input = new Tone.Gain();
  readonly output = new Tone.Gain();
  private worklet: AudioWorkletNode | null = null;
  private params: Record<string, number>;
  private pending = false;
  private isDisposed = false;

  constructor(params: Record<string, number>) {
    super();
    this.params = { ...params };
    loadWorklet(this.context, PROCESSOR_NAME, PROCESSOR_CODE).then(() => {
      if (this.isDisposed) return;
      const node = this.context.createAudioWorkletNode(PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: tremorSettingsFromParams(this.params),
      });
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
      this.worklet?.port.postMessage(tremorSettingsFromParams(this.params));
    });
  }

  /** Seconds the oversampling filters delay the audio. */
  get latency(): number {
    return TREMOR_LATENCY / this.context.sampleRate;
  }

  dispose(): this {
    super.dispose();
    this.isDisposed = true;
    if (this.worklet) {
      this.worklet.port.postMessage("dispose");
      this.worklet.disconnect();
    }
    this.input.dispose();
    this.output.dispose();
    return this;
  }
}
