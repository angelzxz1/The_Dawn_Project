// The audio inputs: the audio interface's (each track picks its own device;
// a stream per device in use, opened when first needed) and other tracks
// ("Audio From"), and each audio track's monitor - its input heard live
// through its effects.
//
// A track takes its device as one mono channel, as the browser mixes it
// down, or one of the device's channels (an interface's input 2, say): those
// come from a second stream of the device, opened with all its channels and
// split, shared by every track taking a channel of it.

import * as Tone from "tone";
import type { SidechainTap } from "../effects/sidechain/sidechainModel";
import type { TrackInput } from "../project/types";
import { noteIssue } from "../services/issues";

/** What the input manager needs from the engine. */
export interface InputHost {
  hasTrack(id: string): boolean;
  /** A track's tap point, or null if the track isn't there. */
  tap(trackId: string, tap: SidechainTap): Tone.ToneAudioNode | null;
  ensureStarted(): Promise<void>;
  /** A track's sources changed (its monitor opened or closed). */
  rewireTrack(id: string): void;
}

/** Whether the browser already lets the page use the microphone (so
 * opening it won't ask). False when it would ask, or can't tell. */
export async function microphoneAllowed(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state === "granted";
  } catch {
    // No Permissions API (or no "microphone" in it): don't assume.
    return false;
  }
}

/** An open input: its graph input (mono), and the analyser its meter
 * reads; a device's own stream, or a channel of its multichannel one. */
interface OpenDevice {
  stream: MediaStream;
  source: AudioNode;
  analyser: AnalyserNode;
}

/** A device opened with all its channels, split. */
interface OpenChannels {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  splitter: ChannelSplitterNode;
  count: number;
}

/** The browser's default input, as a device key. */
const DEFAULT_DEVICE = "";

/** Where a track's interface input comes from: a device ("" for the
 * default) and, optionally, one of its channels (0 = the first). */
export interface InputPick {
  device: string | null;
  channel: number | null;
}

/** The key an input is open under: the device's id, then `#n` for its
 * channel n. */
export function inputKey(pick: InputPick): string {
  const device = pick.device ?? DEFAULT_DEVICE;
  return pick.channel === null ? device : `${device}#${pick.channel}`;
}

/** A key's device and channel (null: the device as one channel). */
export function parseInputKey(key: string): { device: string; channel: number | null } {
  const at = key.lastIndexOf("#");
  if (at < 0) return { device: key, channel: null };
  const channel = Number(key.slice(at + 1));
  return Number.isInteger(channel) && channel >= 0 ? { device: key.slice(0, at), channel } : { device: key, channel: null };
}

/** The channel of a device with `count` channels that a pick of `channel`
 * gets: the last when it asks for one past it (another interface). */
export function availableChannel(channel: number, count: number): number {
  return Math.max(0, Math.min(channel, count - 1));
}

export class InputManager {
  constructor(private readonly host: InputHost) {}

  /** Each audio track's input (setTrackDevices), as its key (inputKey); a
   * track not in it takes the browser's default. */
  private trackDevices = new Map<string, string>();
  /** The open inputs, by key (DEFAULT_DEVICE for the default), and those
   * opening. */
  private devices = new Map<string, OpenDevice>();
  private opening = new Map<string, Promise<OpenDevice>>();
  /** The devices open with all their channels, by device id, and those
   * opening. */
  private multi = new Map<string, OpenChannels>();
  private openingMulti = new Map<string, Promise<OpenChannels>>();

  /** Per-channel live input-monitor taps - open only while that channel is
   * both armed and monitoring is enabled (see `setInputMonitoring`). Each
   * is fed by its track's device, so what you hear is the same clean
   * capture (no echo cancellation, noise suppression or auto gain) that
   * gets recorded. */
  private monitorNodes = new Map<string, Tone.Gain>();
  /** What each monitor is plugged into: the interface input, or another
   * track's tap (its "Audio From"). */
  private monitorFeeds = new Map<string, Tone.OutputNode>();
  /** Audio tracks taking another track's audio as their input. */
  private trackInputs = new Map<string, TrackInput>();

  private deviceOf(channelId: string): string {
    return this.trackDevices.get(channelId) ?? DEFAULT_DEVICE;
  }

  /** A track's input when it comes from another track: that track's tap,
   * or null while it's missing. Undefined: the audio interface. */
  trackInputNode(channelId: string): Tone.ToneAudioNode | null | undefined {
    const input = this.trackInputs.get(channelId);
    if (!input) return undefined;
    return this.host.tap(input.track, input.tap);
  }

  /** Plugs a track's monitor into `feed` (unplugging what it had). */
  private plugMonitor(channelId: string, feed: Tone.OutputNode | null): void {
    const gain = this.monitorNodes.get(channelId);
    const old = this.monitorFeeds.get(channelId);
    if (!gain || old === feed) return;
    if (old) {
      try {
        Tone.disconnect(old, gain);
      } catch {
        // Already gone (a removed track's tap, a closed input device).
      }
    }
    this.monitorFeeds.delete(channelId);
    if (feed) {
      Tone.connect(feed, gain);
      this.monitorFeeds.set(channelId, feed);
    }
  }

  /** Points every monitor at its track's current input - after the routing
   * changed, or a source track was rebuilt. */
  replug(): void {
    this.monitorNodes.forEach((_, id) => {
      const node = this.trackInputNode(id);
      const device = this.deviceOf(id);
      const open = this.devices.get(device);
      if (node !== undefined) this.plugMonitor(id, node);
      else if (open) this.plugMonitor(id, open.source);
      else {
        // On an interface input that isn't open yet.
        this.plugMonitor(id, null);
        void this.ensureDevice(device)
          .then((opened) => {
            if (this.monitorNodes.has(id) && !this.trackInputs.has(id) && this.deviceOf(id) === device) this.plugMonitor(id, opened.source);
          })
          // No input (refused, unplugged): the track stays unmonitored.
          .catch((error) => noteIssue("input.monitor", error, { report: false }));
      }
    });
  }

  /** An input, open: one graph input per key, shared by every track on
   * it, every capture (see InputRecorder.start) and its meter. A device
   * as one channel has a stream of its own; a channel of it is split from
   * the device's multichannel stream. */
  private ensureDevice(key: string): Promise<OpenDevice> {
    const open = this.devices.get(key);
    if (open) return Promise.resolve(open);
    const pending = this.opening.get(key);
    if (pending) return pending;
    const opening = (async () => {
      const { device, channel } = parseInputKey(key);
      const context = Tone.getContext();
      let stream: MediaStream;
      let source: AudioNode;
      if (channel === null) {
        // `channelCount: { ideal: 1 }` asks for a single (mono) capture
        // rather than whatever multi-channel width the device natively
        // exposes - without it, some audio interfaces hand back every input
        // channel summed together regardless of which single `deviceId` was
        // requested. Recording and monitoring both use this one stream.
        stream = await openStream(device, 1);
        source = context.createMediaStreamSource(stream);
      } else {
        const all = await this.ensureChannels(device);
        stream = all.stream;
        const pick = context.createGain();
        pick.channelCount = 1;
        pick.channelCountMode = "explicit";
        all.splitter.connect(pick, availableChannel(channel, all.count));
        source = pick;
      }
      // The input meter listens to the raw input, before any effect.
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const opened = { stream, source, analyser };
      this.devices.set(key, opened);
      return opened;
    })();
    this.opening.set(key, opening);
    opening.then(
      () => this.opening.delete(key),
      () => this.opening.delete(key)
    );
    return opening;
  }

  /** A device opened with all its channels, split. */
  private ensureChannels(device: string): Promise<OpenChannels> {
    const open = this.multi.get(device);
    if (open) return Promise.resolve(open);
    const pending = this.openingMulti.get(device);
    if (pending) return pending;
    const opening = (async () => {
      const stream = await openStream(device, MOST_CHANNELS);
      const context = Tone.getContext();
      const source = context.createMediaStreamSource(stream);
      const settings = stream.getAudioTracks()[0]?.getSettings();
      const count = Math.max(1, Math.min(MOST_CHANNELS, settings?.channelCount ?? 1));
      const splitter = context.createChannelSplitter(count);
      source.connect(splitter);
      const opened = { stream, source, splitter, count };
      this.multi.set(device, opened);
      return opened;
    })();
    this.openingMulti.set(device, opening);
    opening.then(
      () => this.openingMulti.delete(device),
      () => this.openingMulti.delete(device)
    );
    return opening;
  }

  /** A track's interface input (its device's), opened if it isn't. */
  async inputSource(channelId: string): Promise<AudioNode> {
    return (await this.ensureDevice(this.deviceOf(channelId))).source;
  }

  private inputSamples: Float32Array<ArrayBuffer> | null = null;

  /** A track's input peak level (0..1, 1 = full scale) over the last ~40
   * ms, or null while its device isn't open. For its input meter. */
  getInputPeak(channelId: string): number | null {
    const analyser = this.devices.get(this.deviceOf(channelId))?.analyser;
    if (!analyser) return null;
    if (this.inputSamples?.length !== analyser.fftSize) this.inputSamples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(this.inputSamples);
    let peak = 0;
    for (const v of this.inputSamples) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  /** Opens a track's input (asking for permission the first time) so its
   * meter shows the level before recording. */
  async openInput(channelId: string): Promise<void> {
    await this.host.ensureStarted();
    await this.inputSource(channelId);
  }

  /** Requests mic permission (prompting the user the first time) without
   * starting a recording - lets a caller (e.g. a track's Input select,
   * on focus) unlock the browser's full, labeled device list ahead of
   * time, since `enumerateDevices` only returns generic/blank entries
   * until permission has been granted at least once. */
  async requestMicAccess(): Promise<void> {
    await this.ensureDevice(DEFAULT_DEVICE);
  }

  /** Each audio track's input: its device (null: the browser's default)
   * and channel (null: the device as one channel). A track whose input
   * changed reopens its monitor on the new one; an input no track uses any
   * more is closed (the default stays open once it is), and a device's
   * multichannel stream once no track takes a channel of it. */
  setTrackDevices(devices: Map<string, InputPick>): void {
    const next = new Map<string, string>();
    devices.forEach((pick, id) => {
      const key = inputKey(pick);
      if (key !== DEFAULT_DEVICE) next.set(id, key);
    });
    const ids = new Set([...this.trackDevices.keys(), ...next.keys()]);
    const changed = [...ids].filter((id) => this.trackDevices.get(id) !== next.get(id));
    this.trackDevices = next;
    if (changed.length === 0) return;
    const used = new Set([DEFAULT_DEVICE, ...next.values()]);
    this.devices.forEach((open, key) => {
      if (used.has(key)) return;
      open.source.disconnect();
      // A channel's stream is its device's multichannel one, closed below.
      if (parseInputKey(key).channel === null) open.stream.getTracks().forEach((track) => track.stop());
      this.devices.delete(key);
    });
    const split = new Set([...used].map(parseInputKey).filter((k) => k.channel !== null).map((k) => k.device));
    this.multi.forEach((open, device) => {
      if (split.has(device)) return;
      open.source.disconnect();
      open.splitter.disconnect();
      open.stream.getTracks().forEach((track) => track.stop());
      this.multi.delete(device);
    });
    // Monitors on the interface input move to their track's device.
    changed.forEach((id) => {
      if (this.monitorNodes.has(id) && !this.trackInputs.has(id)) this.plugMonitor(id, null);
    });
    this.replug();
  }

  /** Lists the browser's available audio input devices (an interface's
   * separate inputs included, once the OS exposes them), with how many
   * channels each has when the browser says. Device labels - and, on some
   * browsers, entries for anything past the first device - come back
   * blank/missing until mic permission has been granted at least once;
   * call `requestMicAccess` first (or just try recording) to unlock the
   * real list, then call this again. */
  async listInputDevices(): Promise<InputDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput")
      .map((d, i) => {
        const channels = channelsOf(d);
        return { deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}`, ...(channels ? { channels } : {}) };
      });
  }

  /** Starts or stops hearing the audio input live through an audio
   * channel - through its effects, like a clip. Resolves false if the input
   * couldn't be opened (no permission, no device). */
  async setInputMonitoring(channelId: string, enabled: boolean): Promise<boolean> {
    if (!enabled) {
      const gain = this.monitorNodes.get(channelId);
      if (gain) {
        this.plugMonitor(channelId, null);
        gain.dispose();
        this.monitorNodes.delete(channelId);
        this.host.rewireTrack(channelId);
      }
      return true;
    }
    if (!this.host.hasTrack(channelId)) return false;
    if (this.monitorNodes.has(channelId)) return true;
    await this.host.ensureStarted();
    // Another track's audio needs no permission; the interface does.
    let device: OpenDevice | undefined;
    if (this.trackInputNode(channelId) === undefined) {
      try {
        device = await this.ensureDevice(this.deviceOf(channelId));
      } catch (error) {
        noteIssue("input.open", error, { report: false });
        return false;
      }
    }
    // The channel (or the whole engine) may have gone away while the
    // permission prompt/device open was in flight.
    if (!this.host.hasTrack(channelId) || this.monitorNodes.has(channelId)) {
      return this.monitorNodes.has(channelId);
    }
    this.monitorNodes.set(channelId, new Tone.Gain(1));
    const node = this.trackInputNode(channelId);
    this.plugMonitor(channelId, node !== undefined ? node : (device?.source ?? null));
    this.host.rewireTrack(channelId);
    return true;
  }

  isMonitoring(channelId: string): boolean {
    return this.monitorNodes.has(channelId);
  }

  /** The tracks whose monitors are open. */
  monitoredIds(): string[] {
    return [...this.monitorNodes.keys()];
  }

  /** The channel of its device a track takes (null: the device as one). */
  channelOf(channelId: string): number | null {
    return parseInputKey(this.deviceOf(channelId)).channel;
  }

  /** Which audio tracks take another track's audio (routing.ts), as the
   * mix plan accepted them. Monitors follow. */
  setTrackInputs(inputs: Map<string, TrackInput>): void {
    this.trackInputs = inputs;
    this.replug();
  }

  /** A track's input, when it's another track. */
  trackInput(channelId: string): TrackInput | undefined {
    return this.trackInputs.get(channelId);
  }

  /** The gain a monitored track's input arrives through (a source of the
   * track, like a clip), if it's monitoring. */
  monitor(channelId: string): Tone.Gain | undefined {
    return this.monitorNodes.get(channelId);
  }

  /** An open interface stream's settings (latency, sample rate): a
   * track's device's when it's given and open, else the default's, else
   * any open one's. */
  inputSettings(channelId?: string): (MediaTrackSettings & { latency?: number }) | null {
    const open =
      (channelId !== undefined ? this.devices.get(this.deviceOf(channelId)) : undefined) ??
      this.devices.get(DEFAULT_DEVICE) ??
      this.devices.values().next().value;
    return (open?.stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number }) ?? null;
  }
}

/** An input device the browser lists. */
export interface InputDevice {
  deviceId: string;
  label: string;
  /** How many channels it has (an interface's inputs), when known. */
  channels?: number;
}

/** The most channels a device is opened with. */
const MOST_CHANNELS = 32;

/** A device's stream: mono (`channels` 1), or with all its channels. Echo
 * cancellation, noise suppression and auto gain are made for calls: they
 * pump, gate and dull an instrument (and echo cancellation makes it mono),
 * so they're off. */
function openStream(device: string, channels: number): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      ...(device ? { deviceId: { exact: device } } : {}),
      channelCount: { ideal: channels },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
}

/** How many channels a listed device has, as the browser says (Chrome
 * and Edge, once the microphone is allowed); undefined when it doesn't. */
function channelsOf(device: MediaDeviceInfo): number | undefined {
  const capabilities = (device as MediaDeviceInfo & { getCapabilities?: () => MediaTrackCapabilities }).getCapabilities?.();
  const max = capabilities?.channelCount?.max;
  return typeof max === "number" && Number.isFinite(max) && max >= 1 ? Math.min(MOST_CHANNELS, Math.floor(max)) : undefined;
}
