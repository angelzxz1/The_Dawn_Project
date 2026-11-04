import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NATIVE_EFFECTS, describeSong, unsupported, type NativeInstrument } from "./describe";
import { compileDrumKit, defaultDrumKit } from "../../instruments/drum-rack/drumParams";
import { compileSynth, initSynthParams } from "../../instruments/synth/synthParams";
import type { ProjectState } from "../../project/project";
import type { AudioClipInstance, ChannelConfig, ChannelType, MidiClipInstance } from "../../project/types";

const track = (id: string, type: ChannelType, extra: Partial<ChannelConfig> = {}): ChannelConfig => ({
  id,
  name: id,
  volume: 0,
  pan: 0,
  colorIndex: 0,
  type,
  instrument: type === "midi" ? "piano" : null,
  muted: false,
  solo: false,
  armed: false,
  ...extra,
});

const audioClip = (id: string, extra: Partial<AudioClipInstance> = {}): AudioClipInstance => ({
  id,
  kind: "audio",
  offset: 1,
  length: 2,
  url: `blob:${id}`,
  fileName: `${id}.wav`,
  durationSeconds: 4,
  peaks: [],
  sourceOffset: 0.5,
  fadeIn: 0.1,
  fadeOut: 0.2,
  gainDb: -3,
  loopLength: 1,
  ...extra,
});

const midiClip: MidiClipInstance = {
  id: "m1",
  kind: "midi",
  offset: 0,
  length: 2,
  notes: [{ note: "C4", time: 0, duration: 0.5, velocity: 0.8 }],
  loopLength: null,
};

function project(): ProjectState {
  return {
    channels: [
      track("drums", "audio", { volume: -6, pan: 0.5, sends: { verb: -12, gone: 0 } }),
      track("group", "group"),
      track("gtr", "audio", { groupId: "group" }),
      track("keys", "midi"),
    ],
    clipsByChannel: { drums: [audioClip("a")], gtr: [audioClip("b", { warp: { mode: "stretch", bpm: 100, markers: [] } })], keys: [midiClip] },
    takesByChannel: {},
    channelEffects: {},
    buses: [{ id: "verb", name: "Reverb", colorIndex: 0 }],
    busEffects: {},
    bpm: 120,
    tempoChanges: [{ beat: 8, bpm: 90 }],
    markers: [],
    timeSignature: { numerator: 3, denominator: 4 },
    masterVolume: -2,
    masterPan: 0,
    masterName: "Master",
    masterEffects: [],
  };
}

const session = { limiterDb: -1, beatsPerBar: 3, compensation: true, live: [] };
const idOf = {
  clip: (clip: AudioClipInstance) => (clip.warp ? `warp:${clip.id}` : clip.url),
  drumSample: (fileId: string) => `drum:${fileId}`,
  pianoSample: (name: string) => `piano:${name}`,
  wavetable: (key: string) => `wavetable:${key}`,
  effectFile: (fileId: string) => `file:${fileId}`,
};

describe("the song for the native engine", () => {
  it("has every track's level, pan, sends to buses that exist, and audio clips", () => {
    const song = describeSong(project(), session, idOf);
    expect(song.tracks.map((t) => t.id)).toEqual(["drums", "group", "gtr", "keys"]);
    const drums = song.tracks[0];
    expect(drums).toMatchObject({ volumeDb: -6, pan: 0.5, audible: true, output: null, sends: [{ bus: "verb", db: -12 }] });
    expect(drums.clips).toEqual([
      { audio: "blob:a", offset: 1, length: 2, sourceOffset: 0.5, loopLength: 1, gainDb: -3, fadeIn: 0.1, fadeOut: 0.2 },
    ]);
    // A MIDI track's clips are its notes.
    expect(song.tracks[3].clips).toEqual([]);
    expect(song.buses).toEqual([{ id: "verb", volumeDb: 0, pan: 0, audible: true, effects: [] }]);
  });

  it("has each bus's fader and pan, and silences a muted one", () => {
    const p = project();
    p.buses = [{ ...p.buses[0], volume: -4.5, pan: -0.25, muted: true }];
    expect(describeSong(p, session, idOf).buses).toEqual([{ id: "verb", volumeDb: -4.5, pan: -0.25, audible: false, effects: [] }]);
  });

  it("has a MIDI track's notes on the timeline, clamped or tiled to their clips, with its instrument", () => {
    const p = project();
    p.clipsByChannel.keys = [
      midiClip,
      {
        ...midiClip,
        id: "m2",
        offset: 4,
        length: 1,
        loopLength: 0.5,
        notes: [
          { note: "E4", time: 0, duration: 0.01, velocity: 0.5 },
          { note: "G4", time: 0.25, duration: 1, velocity: 1 },
        ],
      },
    ];
    const keys = describeSong(p, session, idOf).tracks[3];
    expect(keys.notes).toEqual([
      { key: 60, start: 0, end: 0.5, velocity: 0.8 },
      // The shortest a note plays is 50 ms; a tiled clip repeats its notes,
      // each cut at its loop.
      { key: 64, start: 4, end: 4.05, velocity: 0.5 },
      { key: 67, start: 4.25, end: 4.5, velocity: 1 },
      { key: 64, start: 4.5, end: 4.55, velocity: 0.5 },
      { key: 67, start: 4.75, end: 5, velocity: 1 },
    ]);
    expect(keys.instrument?.type).toBe("piano");
    const piano = keys.instrument as Extract<NativeInstrument, { type: "piano" }>;
    expect(piano.samples).toContainEqual({ note: 21, audio: "piano:A0" });
    expect(piano.samples).toContainEqual({ note: 63, audio: "piano:D#4" });
    // An audio track has neither.
    expect(describeSong(p, session, idOf).tracks[0]).toMatchObject({ instrument: null, notes: [] });
  });

  it("has a drum track's kit and its sample pads' files", () => {
    const p = project();
    const kit = defaultDrumKit();
    kit.pads[2] = { ...kit.pads[2], source: "sample", sample: { id: "snare-file", name: "Snare.wav" } };
    p.channels = p.channels.map((c) => (c.id === "keys" ? { ...c, instrument: "drums", drumParams: kit } : c));
    const drums = describeSong(p, session, idOf).tracks[3].instrument as Extract<NativeInstrument, { type: "drums" }>;
    expect(drums.type).toBe("drums");
    expect(drums.kit).toEqual(compileDrumKit(kit));
    expect(drums.samples[2]).toBe("drum:snare-file");
    expect(drums.samples.filter(Boolean)).toHaveLength(1);
  });

  it("has a synth track's compiled patch and its wavetables", () => {
    const p = project();
    const params = initSynthParams();
    params.osc1.table = "vowels";
    params.osc2.userTable = { id: "my-table", name: "Mine.wav" };
    p.channels = p.channels.map((c) => (c.id === "keys" ? { ...c, instrument: "synth", synthParams: params } : c));
    const synth = describeSong(p, session, idOf).tracks[3].instrument as Extract<NativeInstrument, { type: "synth" }>;
    expect(synth.type).toBe("synth");
    expect(synth.settings).toEqual(compileSynth(params));
    // An imported table is known by its file; the sub's shapes come last.
    expect(synth.tables).toEqual(["wavetable:vowels", "wavetable:user:my-table", "wavetable:sub"]);
    // A track that hasn't saved a patch plays Init.
    p.channels = p.channels.map((c) => (c.id === "keys" ? { ...c, synthParams: undefined } : c));
    const init = describeSong(p, session, idOf).tracks[3].instrument as Extract<NativeInstrument, { type: "synth" }>;
    expect(init.settings).toEqual(compileSynth(initSynthParams()));
  });

  it("sends a group's members into the group", () => {
    const song = describeSong(project(), session, idOf);
    expect(song.tracks[2].output).toBe("group");
    expect(song.tracks[1].output).toBeNull();
  });

  it("plays a warped clip from its rendering: from the start, not looped", () => {
    const clip = describeSong(project(), session, idOf).tracks[2].clips[0];
    expect(clip).toMatchObject({ audio: "warp:b", sourceOffset: 0, loopLength: null, length: 2 });
  });

  it("works out who's heard with mute and solo", () => {
    const p = project();
    p.channels = p.channels.map((c) => (c.id === "gtr" ? { ...c, solo: true } : c.id === "keys" ? { ...c, muted: true } : c));
    const heard = describeSong(p, session, idOf).tracks.map((t) => [t.id, t.audible]);
    // Soloing the guitar keeps its group (its path to the master) heard.
    expect(heard).toEqual([
      ["drums", false],
      ["group", true],
      ["gtr", true],
      ["keys", false],
    ]);
  });

  it("has every chain's effects the engine plays, in order, bypassed ones flagged", () => {
    const p = project();
    const comp = { id: "c", type: "compressor" as const, params: { threshold: -20 } };
    p.channelEffects = {
      drums: [comp, { id: "t", type: "namAmp", params: {} }, { id: "u", type: "utility", params: { gain: -3 }, bypass: true }],
      gtr: [{ id: "ir", type: "irLoader", params: { wet: 1 }, file: { id: "file-1", name: "cab.wav" } }, { id: "ir2", type: "irLoader", params: {} }],
    };
    p.busEffects = { verb: [{ id: "l", type: "limiter", params: {} }] };
    p.masterEffects = [{ id: "m", type: "namAmp", params: {} }, { id: "u2", type: "utility", params: {} }];
    const song = describeSong(p, session, idOf);
    // NAM isn't in the engine yet: the chain plays without it.
    expect(song.tracks[0].effects).toEqual([
      { id: "c", type: "compressor", params: { threshold: -20 }, bypass: false },
      { id: "u", type: "utility", params: { gain: -3 }, bypass: true },
    ]);
    // An IR Loader names its file, sent like a clip's.
    expect(song.tracks[2].effects).toEqual([
      { id: "ir", type: "irLoader", params: { wet: 1 }, bypass: false, file: "file:file-1" },
      { id: "ir2", type: "irLoader", params: {}, bypass: false },
    ]);
    expect(song.tracks[1].effects).toEqual([]);
    expect(song.buses).toEqual([{ id: "verb", volumeDb: 0, pan: 0, audible: true, effects: [{ id: "l", type: "limiter", params: {}, bypass: false }] }]);
    expect(song.masterEffects.map((e) => e.id)).toEqual(["u2"]);
  });

  it("sends the effects the engine has ported, no more and no fewer", () => {
    const source = readFileSync("crates/dawn-engine/src/effects/mod.rs", "utf8");
    const ported = /pub const PORTED: &\[&str\] = &\[([^\]]*)\]/.exec(source)?.[1].match(/"[^"]+"/g)?.map((k) => JSON.parse(k));
    expect([...NATIVE_EFFECTS].sort()).toEqual(ported?.sort());
  });

  it("says whether delay compensation is on, and which tracks are played live", () => {
    const song = describeSong(project(), { ...session, compensation: false, live: ["keys"] }, idOf);
    expect(song.compensation).toBe(false);
    expect(song.tracks.filter((t) => t.live).map((t) => t.id)).toEqual(["keys"]);
    expect(describeSong(project(), session, idOf).compensation).toBe(true);
  });

  it("has the master, the tempo map and the bar", () => {
    const song = describeSong(project(), session, idOf);
    expect(song.master).toEqual({ volumeDb: -2, pan: 0, limiterDb: -1 });
    expect(song.tempo).toEqual([
      { beat: 0, seconds: 0, bpm: 120 },
      { beat: 8, seconds: 4, bpm: 90 },
    ]);
    expect(song.beatsPerBar).toBe(3);
  });
});

describe("sidechains", () => {
  const keyed = (source: string, extra: object = {}) => ({ type: "compressor" as const, params: {}, sidechain: { on: true, source, tap: "postFader" as const }, ...extra });
  const sidechainOf = (song: ReturnType<typeof describeSong>, id: string) =>
    [...song.tracks.flatMap((t) => t.effects), ...song.buses.flatMap((b) => b.effects), ...song.masterEffects].find((e) => e.id === id)?.sidechain;

  it("sends each keyed effect's source and tap, and nothing for one listening to itself", () => {
    const p = project();
    p.channels = [...p.channels, track("pad", "midi", { instrument: "synth" })];
    p.channelEffects = {
      keys: [{ id: "duck", ...keyed("drums") }],
      // Off, or with no source, it listens to its own input.
      pad: [
        { id: "off", ...keyed("drums"), sidechain: { on: false, source: "drums", tap: "postFx" } },
        { id: "none", ...keyed("drums"), sidechain: { on: true, source: null, tap: "postFx" } },
        { id: "plain", type: "compressor", params: {} },
      ],
    };
    p.masterEffects = [{ id: "glue", type: "glue", params: {}, sidechain: { on: true, source: "keys", tap: "preFx" } }];
    const song = describeSong(p, session, idOf);
    expect(sidechainOf(song, "duck")).toEqual({ source: "drums", tap: "postFader" });
    expect(sidechainOf(song, "glue")).toEqual({ source: "keys", tap: "preFx" });
    expect(["off", "none", "plain"].map((id) => sidechainOf(song, id))).toEqual([undefined, undefined, undefined]);
    expect(song.tracks.find((t) => t.id === "pad")?.effects.map((e) => e.id)).toEqual(["off", "none", "plain"]);
  });

  it("leaves out a key that would make a loop, as the browser's engine does", () => {
    const p = project();
    p.channels = p.channels.map((c) => (c.id === "keys" ? { ...c, sends: { verb: -6 } } : c));
    p.channelEffects = {
      // keys sends to verb: verb can't key it.
      keys: [{ id: "loop", ...keyed("verb") }],
      // Two tracks keying each other: the first is connected.
      drums: [{ id: "first", ...keyed("gtr") }],
      gtr: [{ id: "second", ...keyed("drums") }],
    };
    const song = describeSong(p, session, idOf);
    expect(sidechainOf(song, "loop")).toBeUndefined();
    expect(sidechainOf(song, "first")).toEqual({ source: "gtr", tap: "postFader" });
    expect(sidechainOf(song, "second")).toBeUndefined();
  });
});

describe("a track's automation", () => {
  it("sends the lanes with points, sorted, an effect's only for one the engine plays", () => {
    const p = project();
    p.channelEffects = {
      gtr: [
        { id: "flt", type: "filter", params: { frequency: 800 } },
        { id: "nam", type: "namAmp", params: {} },
      ],
    };
    p.channels = p.channels.map((c) =>
      c.id === "gtr"
        ? {
            ...c,
            automationLanes: [
              {
                id: "v",
                target: { kind: "volume" as const },
                points: [
                  { id: "b", time: 2, value: -12 },
                  { id: "a", time: 0, value: 0, curve: 0.5 },
                ],
              },
              { id: "p", target: { kind: "pan" as const }, points: [] },
              { id: "f", target: { kind: "effect" as const, effectId: "flt", paramKey: "frequency" }, points: [{ id: "c", time: 1, value: 300 }] },
              { id: "n", target: { kind: "effect" as const, effectId: "nam", paramKey: "gain" }, points: [{ id: "d", time: 1, value: 3 }] },
            ],
          }
        : c
    );
    const song = describeSong(p, session, idOf);
    expect(song.tracks.find((t) => t.id === "gtr")?.automation).toEqual([
      {
        target: "volume",
        points: [
          { time: 0, value: 0, curve: 0.5 },
          { time: 2, value: -12, curve: 0 },
        ],
      },
      { target: "effect", effect: "flt", param: "frequency", points: [{ time: 1, value: 300, curve: 0 }] },
    ]);
    expect(song.tracks.find((t) => t.id === "drums")?.automation).toEqual([]);
  });
});

describe("what the native engine doesn't play yet", () => {
  it("names the effects it plays chains without, not the tracks with automation", () => {
    const p = project();
    p.channels = [
      ...p.channels,
      track("pad", "midi", { instrument: "synth" }),
      track("beat", "midi", { instrument: "drums" }),
      track("empty", "midi", { instrument: null }),
    ];
    p.channelEffects = {
      drums: [
        { id: "fx1", type: "compressor", params: {} },
        { id: "fx4", type: "namAmp", params: {} },
      ],
      gtr: [{ id: "fx2", type: "tuner", params: {}, bypass: true }],
      // Ducked by the drums: the engine plays sidechains.
      keys: [{ id: "fx5", type: "compressor", params: {}, sidechain: { on: true, source: "drums", tap: "postFx" } }],
    };
    p.masterEffects = [{ id: "fx3", type: "namAmp", params: {} }];
    p.channels = p.channels.map((c) =>
      c.id === "gtr" ? { ...c, automationLanes: [{ id: "l", target: { kind: "volume" }, points: [{ id: "p", time: 0, value: 0 }] }] } : c
    );
    // Every instrument plays, every compressor, and the automation.
    expect(unsupported(p)).toEqual({ instruments: [], effects: ["NAM Amp on drums", "NAM Amp on Master"] });
  });

  it("is nothing for audio tracks played dry", () => {
    const p = project();
    p.clipsByChannel = { drums: [audioClip("a")] };
    expect(unsupported(p)).toEqual({ instruments: [], effects: [] });
  });
});
