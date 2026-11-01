import * as Tone from "tone";

// A track's, bus's or the master's level meter: the left and right sides
// apart, each side's sample peak and RMS over the last ~21 ms (1024
// samples at 48 kHz). The meters read it once a frame, so every sample is
// seen - a frame is shorter than that - and a peak a frame misses can't
// slip past the clip light. It passes its input through unchanged (the
// master's meter sits between the limiter and the speakers).

export interface MeterReading {
  /** Each side's sample peak and RMS, 0-1 (1 = full scale; more is over). */
  peak: [left: number, right: number];
  rms: [left: number, right: number];
}

export const SILENT_READING: MeterReading = { peak: [0, 0], rms: [0, 0] };

const WINDOW = 1024;

/** A block's sample peak and RMS. */
export function measureBlock(samples: ArrayLike<number>): { peak: number; rms: number } {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  return { peak, rms: samples.length ? Math.sqrt(sum / samples.length) : 0 };
}

export class LevelMeter extends Tone.ToneAudioNode {
  readonly name = "LevelMeter";
  readonly input: Tone.Gain;
  readonly output: Tone.Gain;
  private readonly split: Tone.Split;
  private readonly analysers: AnalyserNode[];
  private readonly buffer = new Float32Array(WINDOW);

  constructor() {
    super();
    this.input = this.output = new Tone.Gain();
    this.split = new Tone.Split(2);
    this.input.connect(this.split);
    this.analysers = [0, 1].map((side) => {
      const analyser = this.context.createAnalyser();
      analyser.fftSize = WINDOW;
      analyser.smoothingTimeConstant = 0;
      this.split.connect(analyser, side, 0);
      return analyser;
    });
  }

  read(): MeterReading {
    const [left, right] = this.analysers.map((analyser) => {
      analyser.getFloatTimeDomainData(this.buffer);
      return measureBlock(this.buffer);
    });
    return { peak: [left.peak, right.peak], rms: [left.rms, right.rms] };
  }

  dispose(): this {
    super.dispose();
    this.analysers.forEach((a) => a.disconnect());
    this.split.dispose();
    this.input.dispose();
    return this;
  }
}
