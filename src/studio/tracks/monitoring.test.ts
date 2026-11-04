import { describe, expect, test } from "vitest";
import type { ChannelConfig } from "@/project/types";
import { monitoredNow, nextMonitorMode, savedMonitorModes, withMonitorMode, type MonitorModes, type TransportNow } from "./monitoring";

const track = (id: string, extra: Partial<ChannelConfig> = {}): ChannelConfig =>
  ({ id, name: id, type: "audio", volume: 0, pan: 0, colorIndex: 0, instrument: null, muted: false, solo: false, armed: false, ...extra }) as ChannelConfig;

const stopped: TransportNow = { state: "stopped", recordingId: null };
const playing: TransportNow = { state: "playing", recordingId: null };

describe("monitoring modes", () => {
  test("the button goes Off, In, Auto, then Off again", () => {
    expect([nextMonitorMode("off"), nextMonitorMode("in"), nextMonitorMode("auto")]).toEqual(["in", "auto", "off"]);
  });

  test("Off leaves the modes without the track; an unchanged mode keeps them as they are", () => {
    const modes: MonitorModes = new Map([["a", "in"]]);
    expect([...withMonitorMode(modes, "a", "off")]).toEqual([]);
    expect(withMonitorMode(modes, "a", "in")).toBe(modes);
    expect([...withMonitorMode(modes, "b", "auto")]).toEqual([
      ["a", "in"],
      ["b", "auto"],
    ]);
  });

  test("In always hears the input, playing or not, armed or not", () => {
    const modes: MonitorModes = new Map([["a", "in"]]);
    for (const transport of [stopped, playing, { state: "recording", recordingId: "other" } as const]) {
      expect([...monitoredNow(modes, [track("a")], transport)]).toEqual(["a"]);
    }
  });

  test("Auto hears it while armed and stopped or paused, or recording onto it; not while playing back", () => {
    const modes: MonitorModes = new Map([["a", "auto"]]);
    const armed = [track("a", { armed: true })];
    expect(monitoredNow(modes, armed, stopped).has("a")).toBe(true);
    expect(monitoredNow(modes, armed, { state: "paused", recordingId: null }).has("a")).toBe(true);
    expect(monitoredNow(modes, armed, { state: "recording", recordingId: "a" }).has("a")).toBe(true);
    expect(monitoredNow(modes, armed, playing).has("a")).toBe(false);
    // Recording onto another track, or not armed.
    expect(monitoredNow(modes, armed, { state: "recording", recordingId: "b" }).has("a")).toBe(false);
    expect(monitoredNow(modes, [track("a")], stopped).has("a")).toBe(false);
  });

  test("only audio tracks that exist are heard", () => {
    const modes: MonitorModes = new Map([
      ["gone", "in"],
      ["keys", "in"],
    ]);
    expect([...monitoredNow(modes, [track("keys", { type: "midi" })], stopped)]).toEqual([]);
  });

  test("a project saves the tracks in In and those in Auto, sorted", () => {
    const modes: MonitorModes = new Map([
      ["c", "in"],
      ["b", "auto"],
      ["a", "in"],
    ]);
    expect(savedMonitorModes(modes)).toEqual({ monitoredTracks: ["a", "c"], autoMonitoredTracks: ["b"] });
  });
});
