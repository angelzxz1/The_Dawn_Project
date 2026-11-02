import { describe, expect, it } from "vitest";
import { routeMap } from "@/engine/routing";
import type { ChannelConfig } from "@/project/types";
import { routeHighlights } from "./routeHighlight";

const track = (id: string, extra: Partial<ChannelConfig> = {}): ChannelConfig => ({
  id,
  name: id,
  volume: 0,
  pan: 0,
  colorIndex: 0,
  type: "audio",
  instrument: null,
  muted: false,
  solo: false,
  armed: false,
  ...extra,
});

const channels = [
  track("g", { type: "group" }),
  track("vox", { groupId: "g", sends: { verb: -6, dly: -12 }, preSends: ["dly"] }),
  track("bgv", { groupId: "g", sends: { verb: -10 } }),
  track("tune", { input: { track: "vox", tap: "postFx" } }),
  track("keys"),
];
const routes = routeMap(channels);

describe("routeHighlights", () => {
  it("a track: its group, its buses (pre or post), and the tracks taking its audio", () => {
    const h = routeHighlights({ kind: "track", id: "vox" }, channels, routes)!;
    expect([...h.tracks]).toEqual([
      ["g", "to"],
      ["tune", "to"],
    ]);
    expect([...h.buses]).toEqual([
      ["verb", { role: "to", pre: false }],
      ["dly", { role: "to", pre: true }],
    ]);
    expect(h.master).toBe(false);
  });

  it("a group: what plays into it, and that it goes to the master", () => {
    const h = routeHighlights({ kind: "track", id: "g" }, channels, routes)!;
    expect([...h.tracks].sort()).toEqual([
      ["bgv", "from"],
      ["vox", "from"],
    ]);
    expect(h.master).toBe(true);
  });

  it("a track taking another's audio: where it comes from", () => {
    const h = routeHighlights({ kind: "track", id: "tune" }, channels, routes)!;
    expect(h.tracks.get("vox")).toBe("from");
  });

  it("a bus: the tracks sending to it", () => {
    const h = routeHighlights({ kind: "bus", id: "verb" }, channels, routes)!;
    expect([...h.tracks.keys()].sort()).toEqual(["bgv", "vox"]);
    expect(routeHighlights(null, channels, routes)).toBeNull();
  });
});
