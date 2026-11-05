// Another engine following the browser engine's transport: the desktop
// app's native engine (native/nativeEngine.ts), which then plays the song
// while the browser's engine runs on silently. The browser engine tells
// it everything the transport does, and takes its position for the
// playhead.

import type { ClickSound } from "./clickSounds";
import type { Waveform } from "./waveform";

export interface EngineFollower {
  /** Playing from `from` (s), after `countInBeats` beats of count-in. */
  play(from: number, countInBeats?: number): void;
  /** Stopped or paused, where it is. */
  stop(): void;
  seek(seconds: number): void;
  loop(range: { start: number; end: number } | null): void;
  metronome(enabled: boolean, levelDb: number, sound: ClickSound): void;
  /** The master limiter's ceiling (dB). */
  limiter(db: number): void;
  beatsPerBar(beats: number): void;
  /** Delay compensation on or off (latency.ts), and the tracks played live
   * that skip it (the armed MIDI track, and what it plays through). */
  compensation(enabled: boolean, live: string[]): void;
  /** Where it is (s), for the playhead; null to use the browser's. */
  position(): number | null;
  /** A key pressed live on a track (MIDI note number, velocity 0-1). */
  noteOn(track: string, key: number, velocity: number): void;
  /** A key let go live (the follower keeps its own sustain). */
  noteOff(track: string, key: number): void;
  /** A track's sustain pedal (CC64). */
  sustain(track: string, down: boolean): void;
  /** A track's pitch bend, in semitones (already scaled by the bend range). */
  pitchBend(track: string, semitones: number): void;
  /** A track's mod wheel, 0..1. */
  modWheel(track: string, amount: number): void;

  // --- The audio interface's input, when the follower has one ---

  /** Whether its input is open. */
  hasInput(): boolean;
  /** The tracks hearing the input live, and the channel each takes (null:
   * all of them mixed to one). */
  monitor(tracks: { track: string; channel: number | null }[]): void;
  /** An input channel's peak (0-1) lately (null: the loudest of them). */
  inputPeak(channel: number | null): number | null;
  /** The round trip its drivers report (s). */
  roundTrip(): number;
  /** Starts recording the input's `channel` (null: all mixed to one). */
  record(channel: number | null): Promise<void>;
  /** The take so far, drawn (from where its downbeat came back in,
   * `roundTrip` s after the mix played it). */
  takePreview(roundTrip: number): { waveform: Waveform; version: number } | null;
  /** Ends the take: mono, from where its downbeat came back in; null if
   * nothing came in. */
  finishTake(roundTrip: number): Promise<{ samples: Float32Array; sampleRate: number } | null>;
  cancelTake(): void;
  /** Measures the round trip on the input's `channel` with clicks (s, or
   * null if they weren't heard clearly). */
  measureRoundTrip(channel: number | null): Promise<number | null>;
}
