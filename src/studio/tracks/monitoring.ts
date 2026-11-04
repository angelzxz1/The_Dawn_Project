// Monitoring modes per audio track, as in Ableton:
//
//   In    the input is always heard, through the track's effects.
//   Auto  it's heard while the track is armed, except during playback:
//         stopped (setting a level, rehearsing) or recording onto it, you
//         hear what you play; playing back, you hear the track's clips.
//   Off   never heard.
//
// The track's clips play in every mode. A track listening to another
// track's audio ("Audio from") monitors that the same way.

import type { ChannelConfig } from "@/project/types";

export type MonitorMode = "in" | "auto" | "off";

/** The modes other than Off, by track id (Off is absent). */
export type MonitorModes = ReadonlyMap<string, Exclude<MonitorMode, "off">>;

export const MONITOR_MODES: readonly MonitorMode[] = ["in", "auto", "off"];

export const MONITOR_LABELS: Record<MonitorMode, string> = { in: "In", auto: "Auto", off: "Off" };

export const MONITOR_TITLES: Record<MonitorMode, string> = {
  in: "In: always hear this track's input live, through its effects",
  auto: "Auto: hear the input while the track is armed, stopped or recording; its clips while playing back",
  off: "Off: never hear the input",
};

export function monitorModeOf(modes: MonitorModes, id: string): MonitorMode {
  return modes.get(id) ?? "off";
}

/** A track's mode after its button is clicked: Off → In → Auto → Off. */
export function nextMonitorMode(mode: MonitorMode): MonitorMode {
  return mode === "off" ? "in" : mode === "in" ? "auto" : "off";
}

export function withMonitorMode(modes: MonitorModes, id: string, mode: MonitorMode): MonitorModes {
  if (monitorModeOf(modes, id) === mode) return modes;
  const next = new Map(modes);
  if (mode === "off") next.delete(id);
  else next.set(id, mode);
  return next;
}

export interface TransportNow {
  state: "stopped" | "playing" | "paused" | "recording";
  /** The track being recorded onto, while recording. */
  recordingId: string | null;
}

/** Whether a track in Auto hears its input now. */
function autoHears(channel: ChannelConfig, transport: TransportNow): boolean {
  if (!channel.armed) return false;
  if (transport.state === "recording") return transport.recordingId === channel.id;
  return transport.state !== "playing";
}

/** The audio tracks hearing their input now. */
export function monitoredNow(modes: MonitorModes, channels: readonly ChannelConfig[], transport: TransportNow): Set<string> {
  const ids = new Set<string>();
  for (const channel of channels) {
    if (channel.type !== "audio") continue;
    const mode = monitorModeOf(modes, channel.id);
    if (mode === "in" || (mode === "auto" && autoHears(channel, transport))) ids.add(channel.id);
  }
  return ids;
}

/** The modes a project saves: the tracks in In (`monitoredTracks`, as
 * before modes, so an older version still hears them) and those in Auto,
 * each sorted. */
export function savedMonitorModes(modes: MonitorModes): { monitoredTracks: string[]; autoMonitoredTracks: string[] } {
  const of = (mode: MonitorMode) => [...modes].filter(([, m]) => m === mode).map(([id]) => id).sort();
  return { monitoredTracks: of("in"), autoMonitoredTracks: of("auto") };
}
