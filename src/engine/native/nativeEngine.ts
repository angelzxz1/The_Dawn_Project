// The native engine in the desktop app, from the studio's side: turned
// on, it opens the audio device, plays the song (describe.ts) and follows
// the browser engine's transport (follower.ts), while the browser engine
// runs on silently - the playhead takes the native engine's position.
//
// It sends the song again whenever the project changes, and each audio
// file once, decoded at the device's rate: a clip's (a warped clip: its
// rendering, warpRender.ts), a sample pad's, the piano's samples, an IR
// Loader's impulse response (and a synth's wavetables, as one run of
// samples). What's still on its way is
// silent until it arrives. Keys played live, the sustain pedal, pitch bend
// and mod wheel go straight to it.
//
// It opens the audio interface's input with its output: the tracks
// monitoring it hear it live through the engine, and takes are recorded
// there, onto disk, and handed back when they end (nativeTake.ts).
//
// It runs the project's plugin effects (CLAP so far): the engine says
// whose state changed, and their states are kept in the project as they do.

import * as Tone from "tone";
import { audioEngine } from "../audioEngine";
import type { EngineFollower } from "../follower";
import { warpedBuffer, warpKey } from "../warpRender";
import { nativeBridge, type NativeStatus } from "./bridge";
import { PROBE_CLICKS, probeClick, TakeBuckets } from "./nativeTake";
import { detectRoundTrip } from "../latency";
import { noteNativeLoad } from "../cpuMeter";
import { describeSong, SUB_TABLE, type NativeAudioIds, type NativeSession } from "./describe";
import { decodeEffectFileAudio } from "../../effects/effectFiles";
import { loadDrumSample } from "../../instruments/drum-rack/drumRack";
import { PIANO_SAMPLE_BASE_URL, PIANO_SAMPLE_URLS } from "../../instruments/piano/piano";
import { synthBend, tableFor, tableKey } from "../../instruments/synth/synth";
import { initSynthParams, type SynthOscParams } from "../../instruments/synth/synthParams";
import { flatWavetable, subWavetable } from "../../instruments/synth/wavetableModel";
import { currentTempo, projectStore } from "../../state/projectStore";
import { warpPieces } from "../../project/warp";
import type { AudioClipInstance } from "../../project/types";
import { noteIssue } from "../../services/issues";
import { effectActions } from "../../state/effectActions";
import { trackActions } from "../../state/trackActions";
import { routeMap, upstreamOf } from "../routing";
import type { RenderedAudio, RenderOptions } from "../../export/bounce";

/** 32-bit FNV-1a of a string, as hex: a short id for a long key. */
function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export interface NativeSettings {
  /** A device id (bridge.ts), or null for the system's default. */
  device: string | null;
  sampleRate: number | null;
  bufferSize: number | null;
  /** The input's id (bridge.ts), or null: the device itself if it
   * records, else its driver's default input. */
  inputDevice: string | null;
}

export interface NativeState {
  active: boolean;
  /** Opening the device. */
  starting: boolean;
  sampleRate: number;
  bufferSize: number | null;
  error: string | null;
  status: NativeStatus | null;
  /** The interface's input, open with the device, or why it isn't. */
  input: { name: string; channels: number } | null;
  inputError: string | null;
  /** The plugin effects: why any couldn't run (by effect id), and those
   * whose own window is open. */
  plugins: { errors: Record<string, string>; windows: string[] };
}

const NO_PLUGINS: NativeState["plugins"] = { errors: {}, windows: [] };

class NativeEngine {
  private state: NativeState = { active: false, starting: false, sampleRate: 0, bufferSize: null, error: null, status: null, input: null, inputError: null, plugins: NO_PLUGINS };
  private listeners = new Set<() => void>();
  /** Files sent (or on their way), by the id the engine knows them by. */
  private sent = new Map<string, Promise<void>>();
  private unsubscribe: (() => void) | null = null;
  private songQueued = false;
  private session: NativeSession = { limiterDb: -1, beatsPerBar: 4, compensation: true, live: [] };
  private statusAt = 0;
  private polling = false;
  /** The tracks hearing the input live, as last sent. */
  private monitors: { track: string; channel: number | null }[] = [];
  /** The take being recorded: its waveform so far, and where its downbeat
   * is in its capture before the round trip (frames). */
  private take: { buckets: TakeBuckets; downbeat: number } | null = null;

  get current(): NativeState {
    return this.state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<NativeState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  /** Opens the device and takes over playing; again with other settings
   * to change them. */
  async turnOn(settings: NativeSettings): Promise<void> {
    this.set({ starting: true, error: null });
    try {
      const opened = await nativeBridge.open(settings.device, settings.sampleRate, settings.bufferSize, settings.inputDevice);
      if (opened.sampleRate !== this.state.sampleRate) this.sent.clear();
      const input = opened.inputName !== null && opened.inputChannels ? { name: opened.inputName, channels: opened.inputChannels } : null;
      this.take = null;
      this.set({ active: true, starting: false, sampleRate: opened.sampleRate, bufferSize: opened.bufferSize, input, inputError: opened.inputError });
      // The device opened anew hears what it heard before.
      if (this.monitors.length > 0) this.run("monitor", nativeBridge.monitor(this.monitors));
      Tone.getDestination().mute = true;
      audioEngine.setFollower(this.follower);
      this.unsubscribe ??= projectStore.subscribe(() => this.queueSong());
      this.queueSong();
      this.poll();
    } catch (error) {
      this.set({ starting: false, error: String(error) });
      noteIssue("native.open", error);
      if (!this.state.active) this.release();
    }
  }

  /** Back to the browser's engine. */
  async turnOff(): Promise<void> {
    this.release();
    this.take = null;
    this.set({ active: false, status: null, input: null, inputError: null, plugins: NO_PLUGINS });
    try {
      await nativeBridge.close();
    } catch (error) {
      noteIssue("native.close", error);
    }
  }

  private release(): void {
    audioEngine.setFollower(null);
    Tone.getDestination().mute = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  // --- The song ---

  private queueSong(): void {
    if (this.songQueued || !this.state.active) return;
    this.songQueued = true;
    queueMicrotask(() => {
      this.songQueued = false;
      void this.sendSong();
    });
  }

  /** The id the engine knows what a clip plays by: its file, or its
   * rendering at the tempo now. */
  private audioId(clip: AudioClipInstance): string {
    const rate = this.state.sampleRate;
    if (!clip.warp) return `${rate}:${clip.url}`;
    const key = warpKey(clip.url, clip.warp.mode, warpPieces(clip as AudioClipInstance & { warp: NonNullable<AudioClipInstance["warp"]> }, currentTempo()), clip.length);
    return `${rate}:w${hash(key)}`;
  }

  /** The ids of what's played, at the device's rate. */
  private get ids(): NativeAudioIds {
    const rate = this.state.sampleRate;
    return {
      clip: (clip) => this.audioId(clip),
      drumSample: (fileId) => `${rate}:drum:${fileId}`,
      pianoSample: (name) => `${rate}:piano:${name}`,
      wavetable: (key) => `${rate}:wavetable:${key}`,
      effectFile: (fileId) => `${rate}:file:${fileId}`,
    };
  }

  /** How to load what an id names (the song just described says which
   * clip or synth oscillator plays it), or null if nothing does. */
  private loader(id: string, clips: AudioClipInstance[], oscs: SynthOscParams[]): (() => Promise<Float32Array[]>) | null {
    const rate = this.state.sampleRate;
    const table = id.startsWith(`${rate}:wavetable:`) ? id.slice(`${rate}:wavetable:`.length) : null;
    if (table === SUB_TABLE) return async () => [flatWavetable(subWavetable())];
    if (table !== null) {
      const osc = oscs.find((o) => tableKey(o) === table);
      return osc ? async () => [flatWavetable(await tableFor(osc))] : null;
    }
    const drum = id.startsWith(`${rate}:drum:`) ? id.slice(`${rate}:drum:`.length) : null;
    if (drum) {
      return async () => {
        const channels = await loadDrumSample(drum, rate);
        if (!channels) throw new Error(`The sample ${drum} couldn't be read.`);
        return channels;
      };
    }
    const effectFile = id.startsWith(`${rate}:file:`) ? id.slice(`${rate}:file:`.length) : null;
    if (effectFile) {
      return async () => {
        const buffer = await decodeEffectFileAudio(effectFile, rate);
        if (!buffer) throw new Error(`The file ${effectFile} couldn't be read.`);
        return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
      };
    }
    const piano = id.startsWith(`${rate}:piano:`) ? id.slice(`${rate}:piano:`.length) : null;
    if (piano && PIANO_SAMPLE_URLS[piano]) {
      return () => this.decode(PIANO_SAMPLE_BASE_URL + PIANO_SAMPLE_URLS[piano]);
    }
    const clip = clips.find((c) => this.audioId(c) === id);
    if (!clip) return null;
    return async () => {
      const source = await this.decodeBuffer(clip.url);
      let buffer = source;
      if (clip.warp) {
        const pieces = warpPieces(clip as AudioClipInstance & { warp: NonNullable<AudioClipInstance["warp"]> }, currentTempo());
        // Kept apart from the browser engine's renderings, which may be at
        // another rate.
        buffer = await warpedBuffer(`${rate}|${warpKey(clip.url, clip.warp.mode, pieces, clip.length)}`, source, pieces, clip.length, clip.warp.mode);
      }
      return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    };
  }

  /** A file, decoded at the device's rate. */
  private async decodeBuffer(url: string): Promise<AudioBuffer> {
    const file = await (await fetch(url)).arrayBuffer();
    return new OfflineAudioContext(1, 1, this.state.sampleRate).decodeAudioData(file);
  }

  private async decode(url: string): Promise<Float32Array[]> {
    const buffer = await this.decodeBuffer(url);
    return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  }

  private async sendSong(): Promise<void> {
    if (!this.state.active) return;
    const doc = projectStore.get();
    const song = describeSong(doc, this.session, this.ids);
    try {
      const { missing } = await nativeBridge.setSong(song);
      if (missing.length === 0) return;
      // Sends what's missing, then the song again.
      await this.sendFiles(doc, missing);
      this.queueSong();
    } catch (error) {
      noteIssue("native.song", error);
    }
  }

  /** Sends the files `missing` names, for `doc`'s song. */
  private async sendFiles(doc: ReturnType<typeof projectStore.get>, missing: string[]): Promise<void> {
    const clips = Object.values(doc.clipsByChannel)
      .flat()
      .filter((c): c is AudioClipInstance => c.kind === "audio");
    const oscs = doc.channels
      .filter((c) => c.type === "midi" && c.instrument === "synth")
      .flatMap((c) => {
        const params = c.synthParams ?? initSynthParams();
        return [params.osc1, params.osc2];
      });
    await Promise.all(
      missing.map((id) => {
        const load = this.loader(id, clips, oscs);
        return load ? this.upload(id, load) : Promise.resolve();
      })
    );
  }

  /** The project rendered offline by the engine, for an export, as the
   * browser's renderProject renders it (bounce.ts): the song or a range of
   * it with its tail, a stem (one track and those routed into it heard,
   * the master's chain left out unless asked for), at the device's rate.
   * Nothing's played live in it. */
  async render(options: RenderOptions & { contentEnd: number }): Promise<RenderedAudio> {
    /** How the engine's error starts when files are missing (mod.rs MISSING). */
    const BOUNCE_MISSING = "missing files:";
    if (!this.state.active) throw new Error("The native engine isn't on.");
    const doc = projectStore.get();
    const masterChain = options.masterChain ?? true;
    const song = describeSong(doc, { ...this.session, live: [], ...(masterChain ? {} : { limiterDb: 120 }) }, this.ids);
    if (options.only) {
      const stem = new Set([options.only, ...upstreamOf(options.only, routeMap(doc.channels))]);
      song.tracks = song.tracks.map((t) => ({ ...t, audible: t.audible && stem.has(t.id) }));
    }
    if (!masterChain) song.masterEffects = [];
    const from = Math.max(0, options.start ?? 0);
    const length = Math.max(0, (options.end ?? options.contentEnd) - from);
    // At least a second in all, as the browser's.
    const tail = Math.max(0, options.tailSeconds ?? 2, 1 - length);
    const bounce = () => nativeBridge.bounce(song, from, length, tail);
    let bytes: ArrayBuffer;
    try {
      bytes = await bounce();
    } catch (error) {
      const text = String(error);
      if (!text.startsWith(BOUNCE_MISSING)) throw error;
      await this.sendFiles(doc, text.slice(BOUNCE_MISSING.length).split("\n").filter(Boolean));
      bytes = await bounce();
    }
    const samples = new Float32Array(bytes);
    const half = samples.length / 2;
    return { channels: [samples.slice(0, half), samples.slice(half)], sampleRate: this.state.sampleRate };
  }

  /** Sends what an id names, once. */
  private upload(id: string, load: () => Promise<Float32Array[]>): Promise<void> {
    const known = this.sent.get(id);
    if (known) return known;
    const rate = this.state.sampleRate;
    const job = (async () => {
      const channels = await load();
      await nativeBridge.loadAudio(id, channels, rate);
    })();
    // A failure is forgotten, so it's tried again with the next song.
    job.catch((error) => {
      this.sent.delete(id);
      noteIssue("native.audio", error);
    });
    this.sent.set(id, job);
    return job;
  }

  /** What's gone into a Tuner the engine plays lately (as its node in the
   * browser keeps it, tuner.ts), or null when it's not playing one. */
  async tunerInput(effectId: string): Promise<Float32Array | null> {
    if (!this.state.active) return null;
    const bytes = await nativeBridge.tuner(effectId);
    return bytes.byteLength > 0 ? new Float32Array(bytes) : null;
  }

  // --- The status: the position and meters, as often as the screen redraws ---

  private poll(): void {
    if (this.polling) return;
    this.polling = true;
    const tick = async () => {
      if (!this.state.active) {
        this.polling = false;
        return;
      }
      try {
        const status = await nativeBridge.status();
        this.statusAt = performance.now();
        noteNativeLoad(status.busyMs, status.audioMs);
        if (status.take && this.take) {
          this.take.buckets.add(status.take.min, status.take.max);
          this.take.downbeat = status.take.downbeat;
        }
        status.plugins?.dirty.forEach((id) => void this.keepPluginState(id));
        this.set({ status, plugins: this.pluginsFrom(status) });
      } catch (error) {
        noteIssue("native.status", error);
      }
      requestAnimationFrame(() => void tick());
    };
    void tick();
  }

  // --- Plugins ---

  /** The plugins' errors and windows as the status says, the same object
   * while they're the same (for the views reading it). */
  private pluginsFrom(status: NativeStatus): NativeState["plugins"] {
    const p = status.plugins;
    if (!p) return NO_PLUGINS;
    const errors = Object.fromEntries(p.errors);
    const now = this.state.plugins;
    const same =
      p.windows.length === now.windows.length &&
      p.windows.every((w, i) => w === now.windows[i]) &&
      Object.keys(errors).length === Object.keys(now.errors).length &&
      Object.entries(errors).every(([k, v]) => now.errors[k] === v);
    return same ? now : { errors, windows: p.windows };
  }

  /** Keeps a plugin's state in the project, as the plugin has it: an
   * effect's (by its id) or an instrument's (by its track's). */
  private async keepPluginState(effectId: string): Promise<void> {
    try {
      const state = await nativeBridge.pluginState(effectId);
      if (!trackActions.setPluginInstrumentState(effectId, state)) effectActions.setPluginState(effectId, state);
    } catch (error) {
      noteIssue("native.pluginState", error);
    }
  }

  /** Opens a plugin effect's own window. */
  async openPluginWindow(effectId: string, title: string): Promise<void> {
    if (!this.state.active) return;
    try {
      await nativeBridge.openPluginWindow(effectId, title);
    } catch (error) {
      noteIssue("native.pluginWindow", error);
    }
  }

  // --- Following the browser engine's transport (follower.ts) ---

  private run(name: string, call: Promise<void>): void {
    call.catch((error) => noteIssue(`native.${name}`, error));
  }

  private readonly follower: EngineFollower = {
    play: (from, countInBeats) => this.run("play", nativeBridge.play(from, countInBeats)),
    stop: () => this.run("stop", nativeBridge.stop()),
    seek: (seconds) => this.run("seek", nativeBridge.seek(seconds)),
    loop: (range) => this.run("loop", nativeBridge.loop(range)),
    metronome: (enabled, levelDb, sound) => this.run("metronome", nativeBridge.metronome(enabled, levelDb, sound)),
    limiter: (db) => {
      this.session = { ...this.session, limiterDb: db };
      this.queueSong();
    },
    beatsPerBar: (beats) => {
      this.session = { ...this.session, beatsPerBar: beats };
      this.queueSong();
    },
    compensation: (enabled, live) => {
      const s = this.session;
      if (s.compensation === enabled && s.live.length === live.length && live.every((id) => s.live.includes(id))) return;
      this.session = { ...s, compensation: enabled, live };
      this.queueSong();
    },
    position: () => {
      const s = this.state.status;
      if (!s) return null;
      return s.playing ? s.position + (performance.now() - this.statusAt) / 1000 : s.position;
    },
    noteOn: (track, key, velocity) => this.run("key", nativeBridge.key(track, key, velocity)),
    noteOff: (track, key) => this.run("key", nativeBridge.key(track, key, null)),
    sustain: (track, down) => this.run("sustain", nativeBridge.sustain(track, down)),
    pitchBend: (track, semitones) => this.run("bend", nativeBridge.bend(track, synthBend(semitones * 100))),
    modWheel: (track, amount) => this.run("wheel", nativeBridge.modWheel(track, amount)),

    hasInput: () => this.state.input !== null,
    monitor: (tracks) => {
      const same = (a: typeof tracks, b: typeof tracks) =>
        a.length === b.length && a.every((t, i) => t.track === b[i].track && t.channel === b[i].channel);
      if (same(tracks, this.monitors)) return;
      this.monitors = tracks;
      if (this.state.active) this.run("monitor", nativeBridge.monitor(tracks));
    },
    inputPeak: (channel) => {
      const peaks = this.state.status?.inputs;
      if (!this.state.input || !peaks?.length) return null;
      return channel === null ? Math.max(...peaks) : peaks[Math.min(channel, peaks.length - 1)];
    },
    roundTrip: () => this.state.status?.roundTrip ?? 0,
    record: async (channel) => {
      await nativeBridge.record(channel);
      this.take = { buckets: new TakeBuckets(this.state.sampleRate), downbeat: 0 };
    },
    takePreview: (roundTrip) => {
      const take = this.take;
      if (!take) return null;
      const from = take.downbeat + Math.round(roundTrip * take.buckets.sampleRate);
      return { waveform: take.buckets.waveform(from), version: take.buckets.version };
    },
    finishTake: async (roundTrip) => {
      this.take = null;
      const sampleRate = this.state.sampleRate;
      const samples = new Float32Array(await nativeBridge.finishTake(roundTrip));
      return samples.length > 0 ? { samples, sampleRate } : null;
    },
    cancelTake: () => {
      this.take = null;
      this.run("cancel", nativeBridge.cancelTake());
    },
    measureRoundTrip: async (channel) => {
      const sr = this.state.sampleRate;
      await nativeBridge.record(channel, true);
      const last = PROBE_CLICKS[PROBE_CLICKS.length - 1];
      await new Promise((r) => setTimeout(r, (last + 0.6) * 1000));
      const samples = new Float32Array(await nativeBridge.finishTake(null));
      return detectRoundTrip(samples, sr, PROBE_CLICKS.map((t) => Math.round(t * sr)), probeClick(sr));
    },
  };
}

export const nativeEngine = new NativeEngine();
