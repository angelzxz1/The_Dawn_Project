import * as Tone from "tone";
import { loadWorklet } from "../../engine/workletLoader";
import { PITCH_SHIFT_SOURCE, pitchLatency, pitchSettingsFromParams } from "./pitchShiftKernel";

// The Pitch Shift's audio node: pitchShiftKernel.ts's kernel (the shifter,
// the dry path waiting as long, and the Dry/Wet blend) in an AudioWorklet.
// Silent until its module has loaded (a few ms, once per audio context).

const PROCESSOR_NAME = "dawn-pitch-shift-v2";

const PROCESSOR_CODE = `
${PITCH_SHIFT_SOURCE}
class DawnPitchShift extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.kernel = new PitchKernel(sampleRate);
    this.kernel.set(options.processorOptions);
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === "dispose") this.alive = false;
      else this.kernel.set(e.data);
    };
  }
  process(inputs, outputs) {
    const input = inputs[0] || [];
    const out = outputs[0];
    this.kernel.process(input[0] || null, input[1] || null, out[0], out[1] || null, out[0].length);
    return this.alive;
  }
}
registerProcessor("${PROCESSOR_NAME}", DawnPitchShift);
`;

export class PitchShifter extends Tone.ToneAudioNode {
  readonly name = "PitchShifter";
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
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: pitchSettingsFromParams(this.params),
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
      this.worklet?.port.postMessage(pitchSettingsFromParams(this.params));
    });
  }

  /** Seconds the shifted signal (and the dry one, to match) lags. */
  get latency(): number {
    return pitchLatency(pitchSettingsFromParams(this.params), this.context.sampleRate) / this.context.sampleRate;
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
