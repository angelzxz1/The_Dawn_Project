// The song as the desktop app's native engine takes it
// (src-tauri/src/audio/song.rs): every track with its level, pan, whether
// it's heard (mute and solo, worked out as the browser's engine does,
// mixGraph.ts), where it goes, its sends, its audio clips, a MIDI track's
// notes and instrument, and its effects; the buses with theirs; the master
// with its, and the sidechains connected (the keys that make no loop, as
// the browser's engine connects them: sidechainRouting.ts); the tempo map;
// delay compensation's setting and the tracks played live; each track's
// automation lanes. The engine only renders what it's told (and lines the
// paths and the keys up itself, from its effects' latencies). Pure.
//
// So far the native engine plays audio clips, every instrument's notes (the
// piano, the Drum Rack, the synth), most of the effects (NATIVE_EFFECTS,
// an IR Loader with its file, sidechains included) and the tracks'
// automation through the mix; a chain plays without the others
// (unsupported() names what a project uses of them).

import { audibleTracks } from "../mixGraph";
import { inputMap, routeMap } from "../routing";
import { resolveSidechains, type RoutingSnapshot, type SidechainRequest } from "../../effects/sidechain/sidechainRouting";
import type { SidechainTap } from "../../effects/sidechain/sidechainModel";
import { notesWithinClip, type ProjectState } from "../../project/project";
import { makeTempoMap } from "../../project/tempoMap";
import type { AudioClipInstance, AutomationLane, ChannelConfig } from "../../project/types";
import { compileDrumKit, defaultDrumKit } from "../../instruments/drum-rack/drumParams";
import { PIANO_SAMPLE_URLS, noteNameToMidi } from "../../instruments/piano/piano";
import { tableKey } from "../../instruments/synth/synth";
import { compileSynth, initSynthParams } from "../../instruments/synth/synthParams";
import type { InstrumentType } from "../../instruments/registry";
import { EFFECT_LABELS, hasSidechain, type EffectInstance, type EffectType } from "../../effects/registry";

/** The instruments the native engine plays. */
export const NATIVE_INSTRUMENTS: readonly InstrumentType[] = ["piano", "drums", "synth"];

/** What the synth's sub oscillator plays (its shapes' wavetable), next to
 * the oscillators' tables (synth.ts tableKey). */
export const SUB_TABLE = "sub";

/** The effects the native engine plays; a chain plays without the others. */
export const NATIVE_EFFECTS: readonly EffectType[] = ["chorus", "compressor", "delay", "distortion", "eq3", "filter", "gate", "glue", "irLoader", "limiter", "mbDynamics", "multiband", "paramEq", "pitchShift", "reverb", "tubeAmp", "tuner", "utility"];

/** The shortest a note plays (as the browser's engine, audioEngine.ts). */
const MIN_NOTE_DURATION = 0.05;

export interface NativeClip {
  /** The audio file it plays (sent to the engine under this id). */
  audio: string;
  offset: number;
  length: number;
  sourceOffset: number;
  loopLength: number | null;
  gainDb: number;
  fadeIn: number;
  fadeOut: number;
}

/** A note on the timeline (s). */
export interface NativeNote {
  key: number;
  start: number;
  end: number;
  velocity: number;
}

export type NativeInstrument =
  | { type: "drums"; kit: ReturnType<typeof compileDrumKit>; samples: (string | null)[] }
  | { type: "piano"; samples: { note: number; audio: string }[] }
  /** Its tables: oscillator 1's, oscillator 2's, the sub's. */
  | { type: "synth"; settings: ReturnType<typeof compileSynth>; tables: string[] };

/** An effect in a chain, with its parameters as the project keeps them. */
export interface NativeEffect {
  id: string;
  type: EffectType;
  params: Record<string, number>;
  /** Skipped, as if unplugged (it keeps its place, and its state). */
  bypass: boolean;
  /** The file it plays (an IR Loader's impulse response), sent to the
   * engine under this id; left out when it has none. */
  file?: string;
  /** Where its detector listens, for an effect keyed by another track or
   * bus (a track's or bus's id); left out when it listens to its own
   * input. */
  sidechain?: { source: string; tap: SidechainTap };
  /** A plugin effect's plugin, and the state it starts from. */
  plugin?: { format: "clap" | "vst3"; id: string; path: string; state?: string };
}

/** An automation lane with points: a track's fader (dB), its pan, or a
 * parameter of one of its effects the engine plays. Its points are sorted
 * by time (s on the timeline), each with its bend to the next. */
export interface NativeLane {
  target: "volume" | "pan" | "effect";
  /** The effect's id and the parameter's key, for an effect's. */
  effect?: string;
  param?: string;
  points: { time: number; value: number; curve: number }[];
}

export interface NativeTrack {
  id: string;
  /** Played live (the armed MIDI track, or a track it plays through):
   * delay compensation doesn't hold it back. */
  live: boolean;
  volumeDb: number;
  pan: number;
  audible: boolean;
  /** The track it feeds, or null for the master. */
  output: string | null;
  /** `pre`: before the fader (and its pan). */
  sends: { bus: string; db: number; pre: boolean }[];
  clips: NativeClip[];
  /** What plays its notes, if the native engine has it. */
  instrument: NativeInstrument | null;
  notes: NativeNote[];
  effects: NativeEffect[];
  automation: NativeLane[];
}

/** The ids the engine knows what's played by: a clip's file (or its
 * rendering), a sample pad's file, one of the piano's samples, a synth's
 * wavetable (by its tableKey, or SUB_TABLE), an effect's file (an IR). */
export interface NativeAudioIds {
  clip(clip: AudioClipInstance): string;
  drumSample(fileId: string): string;
  pianoSample(name: string): string;
  wavetable(key: string): string;
  effectFile(fileId: string): string;
}

export interface NativeSong {
  tracks: NativeTrack[];
  /** `audible`: false while it's muted. */
  buses: { id: string; volumeDb: number; pan: number; audible: boolean; effects: NativeEffect[] }[];
  master: { volumeDb: number; pan: number; limiterDb: number };
  masterEffects: NativeEffect[];
  tempo: { beat: number; seconds: number; bpm: number }[];
  beatsPerBar: number;
  /** Delay compensation (the Audio panel's setting). */
  compensation: boolean;
}

/** What the song needs from the browser engine's session: the limiter's
 * ceiling, the bar, and delay compensation (on or off, and the tracks
 * played live). */
export interface NativeSession {
  limiterDb: number;
  beatsPerBar: number;
  compensation: boolean;
  live: string[];
}

/** What a clip plays: its file, or for a warped clip the rendering of its
 * stretch of the file (which starts at the clip and doesn't loop - the
 * rendering plays its loop out). `audio` names what it plays. */
function nativeClip(clip: AudioClipInstance, audio: string): NativeClip {
  const warped = !!clip.warp;
  return {
    audio,
    offset: clip.offset,
    length: clip.length,
    sourceOffset: warped ? 0 : clip.sourceOffset,
    loopLength: warped ? null : (clip.loopLength ?? null),
    gainDb: clip.gainDb,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
  };
}

function nativeInstrument(channel: ChannelConfig, ids: NativeAudioIds): NativeInstrument | null {
  if (channel.type !== "midi") return null;
  if (channel.instrument === "drums") {
    const kit = channel.drumParams ?? defaultDrumKit();
    return {
      type: "drums",
      kit: compileDrumKit(kit),
      samples: kit.pads.map((p) => (p.source === "sample" && p.sample ? ids.drumSample(p.sample.id) : null)),
    };
  }
  if (channel.instrument === "piano") {
    return {
      type: "piano",
      samples: Object.keys(PIANO_SAMPLE_URLS).map((name) => ({ note: noteNameToMidi(name) ?? 60, audio: ids.pianoSample(name) })),
    };
  }
  if (channel.instrument === "synth") {
    const params = channel.synthParams ?? initSynthParams();
    return {
      type: "synth",
      settings: compileSynth(params),
      tables: [tableKey(params.osc1), tableKey(params.osc2), SUB_TABLE].map(ids.wavetable),
    };
  }
  return null;
}

/** Whether the engine plays an effect (of plugins, the CLAP ones so far). */
const plays = (fx: EffectInstance) =>
  fx.type === "plugin" ? fx.plugin?.format === "clap" : NATIVE_EFFECTS.includes(fx.type);

/** The sidechains to connect: effect id -> its source's id. As the
 * browser's engine connects them (mixGraph.ts): in order, leaving out a
 * key that's off, from nothing there, or that would make a loop through
 * the routing (a track's route, its sends, its input from another track,
 * the other keys). */
function connectedKeys(doc: ProjectState, routes: Map<string, string | null>): Map<string, string> {
  const busIds = new Set(doc.buses.map((b) => b.id));
  const inputs = inputMap(doc.channels, routes);
  const snapshot: RoutingSnapshot = {
    channels: doc.channels.map((c) => ({
      id: c.id,
      sends: Object.keys(c.sends ?? {}).filter((bus) => busIds.has(bus)),
      chain: 0,
      pdc: 0,
      toMaster: 0,
      dest: routes.get(c.id) ?? null,
      inputFrom: inputs.get(c.id)?.track ?? null,
    })),
    buses: doc.buses.map((b) => ({ id: b.id, chain: 0, pdc: 0 })),
  };
  const hosts: [string, EffectInstance[] | undefined][] = [
    ...doc.channels.map((c): [string, EffectInstance[] | undefined] => [c.id, doc.channelEffects[c.id]]),
    ...doc.buses.map((b): [string, EffectInstance[] | undefined] => [b.id, doc.busEffects[b.id]]),
    ["master", doc.masterEffects],
  ];
  const requests: SidechainRequest[] = hosts.flatMap(([hostId, chain]) =>
    (chain ?? []).filter((fx) => hasSidechain(fx.type) && fx.sidechain).map((fx) => ({ hostId, effectId: fx.id, routing: fx.sidechain }))
  );
  return resolveSidechains(snapshot, requests);
}

/** A chain's effects the engine plays, in order; `keys` the sidechains
 * connected (connectedKeys). */
function nativeEffects(chain: EffectInstance[] | undefined, ids: NativeAudioIds, keys: Map<string, string>): NativeEffect[] {
  return (chain ?? []).filter(plays).map((fx) => {
    const source = keys.get(fx.id);
    return {
      id: fx.id,
      type: fx.type,
      params: fx.params,
      bypass: !!fx.bypass,
      ...(fx.file ? { file: ids.effectFile(fx.file.id) } : {}),
      ...(source ? { sidechain: { source, tap: fx.sidechain?.tap ?? "postFx" } } : {}),
      ...(fx.plugin
        ? { plugin: { format: fx.plugin.format, id: fx.plugin.id, path: fx.plugin.path, ...(fx.plugin.state ? { state: fx.plugin.state } : {}) } }
        : {}),
    };
  });
}

/** A MIDI track's notes on the timeline: each clip's, clamped or tiled
 * to its box (as the browser's engine plays them, engineSync.ts). */
function nativeNotes(doc: ProjectState, channel: ChannelConfig): NativeNote[] {
  if (channel.type !== "midi") return [];
  return (doc.clipsByChannel[channel.id] ?? []).flatMap((clip) =>
    clip.kind !== "midi"
      ? []
      : notesWithinClip(clip).flatMap((n) => {
          const key = noteNameToMidi(n.note);
          if (key === null) return [];
          const start = clip.offset + n.time;
          return [{ key, start, end: start + Math.max(n.duration, MIN_NOTE_DURATION), velocity: n.velocity }];
        })
  );
}

/** A track's lanes with points; an effect's only for one the engine plays
 * in its chain (`effects`). */
function nativeLanes(lanes: AutomationLane[] | undefined, effects: NativeEffect[]): NativeLane[] {
  return (lanes ?? []).flatMap((lane): NativeLane[] => {
    if (lane.points.length === 0) return [];
    const points = [...lane.points].sort((a, b) => a.time - b.time).map((p) => ({ time: p.time, value: p.value, curve: p.curve ?? 0 }));
    const t = lane.target;
    if (t.kind !== "effect") return [{ target: t.kind, points }];
    if (!effects.some((fx) => fx.id === t.effectId)) return [];
    return [{ target: "effect", effect: t.effectId, param: t.paramKey, points }];
  });
}

export function describeSong(doc: ProjectState, session: NativeSession, ids: NativeAudioIds): NativeSong {
  const routes = routeMap(doc.channels);
  const heard = audibleTracks(doc.channels, routes);
  const busIds = new Set(doc.buses.map((b) => b.id));
  const keys = connectedKeys(doc, routes);
  return {
    tracks: doc.channels.map((c) => {
      const effects = nativeEffects(doc.channelEffects[c.id], ids, keys);
      return {
        id: c.id,
        live: session.live.includes(c.id),
        volumeDb: c.volume,
        pan: c.pan,
        audible: heard.has(c.id),
        output: routes.get(c.id) ?? null,
        sends: Object.entries(c.sends ?? {})
          .filter(([bus]) => busIds.has(bus))
          .map(([bus, db]) => ({ bus, db, pre: !!c.preSends?.includes(bus) })),
        clips: (doc.clipsByChannel[c.id] ?? []).flatMap((clip) => (clip.kind === "audio" ? [nativeClip(clip, ids.clip(clip))] : [])),
        instrument: nativeInstrument(c, ids),
        notes: nativeNotes(doc, c),
        effects,
        automation: nativeLanes(c.automationLanes, effects),
      };
    }),
    buses: doc.buses.map((b) => ({ id: b.id, volumeDb: b.volume ?? 0, pan: b.pan ?? 0, audible: !b.muted, effects: nativeEffects(doc.busEffects[b.id], ids, keys) })),
    master: { volumeDb: doc.masterVolume, pan: doc.masterPan, limiterDb: session.limiterDb },
    masterEffects: nativeEffects(doc.masterEffects, ids, keys),
    tempo: makeTempoMap(doc.bpm, doc.tempoChanges).segments.map((s) => ({ beat: s.beat, seconds: s.seconds, bpm: s.bpm })),
    beatsPerBar: session.beatsPerBar,
    compensation: session.compensation,
  };
}

/** What the project uses that the native engine doesn't play yet: the
 * tracks with instruments it doesn't have, and the effects it plays their
 * chains without ("NAM Amp on Gtr"). */
export function unsupported(doc: ProjectState): { instruments: string[]; effects: string[] } {
  const named = (ids: string[]) => doc.channels.filter((c) => ids.includes(c.id)).map((c) => c.name);
  const instruments = doc.channels.filter((c) => c.type === "midi" && c.instrument !== null && !NATIVE_INSTRUMENTS.includes(c.instrument)).map((c) => c.id);
  const hosts: { name: string; chain: EffectInstance[] }[] = [
    ...doc.channels.map((c) => ({ name: c.name, chain: doc.channelEffects[c.id] ?? [] })),
    ...doc.buses.map((b) => ({ name: b.name, chain: doc.busEffects[b.id] ?? [] })),
    { name: doc.masterName, chain: doc.masterEffects },
  ];
  const effects = hosts.flatMap((h) =>
    h.chain
      .filter((fx) => !fx.bypass && !plays(fx))
      .map((fx) => `${fx.plugin?.name ?? EFFECT_LABELS[fx.type]} on ${h.name}`)
  );
  return { instruments: named(instruments), effects };
}
