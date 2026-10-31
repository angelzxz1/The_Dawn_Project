// The arrangement's right-click menus as lists: what a track's header menu
// offers for each kind of track, what its items ask of the studio, and the
// shortcuts the menus show.

import { describe, expect, test, vi } from "vitest";
import { contextMenuItems, type MenuActions, type MenuContext } from "./contextMenus";
import { makeTempoMap } from "@/project/tempoMap";
import type { ChannelConfig, ClipInstance } from "@/project/types";
import type { ContextMenuEntry, ContextMenuItem, ContextMenuRow } from "@/studio/shell/ContextMenu";

vi.mock("@/engine/audioEngine", () => ({ audioEngine: { getTransportSeconds: () => 0 } }));

const track = (id: string, overrides: Partial<ChannelConfig> = {}): ChannelConfig => ({
  id,
  name: id,
  volume: 0,
  pan: 0,
  colorIndex: 0,
  type: "midi",
  instrument: "synth",
  muted: false,
  solo: false,
  armed: false,
  ...overrides,
});

function menu(id: string, channels: ChannelConfig[], ctx: Partial<MenuContext> = {}) {
  const actions = new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
    get: (target, name: string) => (target[name] ??= vi.fn()),
  });
  const entries = contextMenuItems(
    { kind: "header", channelId: id, x: 0, y: 0 },
    {
      channels,
      clipsOf: () => [] as ClipInstance[],
      selectedClips: 0,
      trackPicks: new Set(),
      takeCount: () => 0,
      monitored: new Set(),
      automationChannelId: null,
      tempo: makeTempoMap(120),
      beatsPerBar: 4,
      ...ctx,
    },
    actions as unknown as MenuActions
  );
  const items = entries.filter((e): e is ContextMenuItem => e !== "separator" && !("row" in e));
  const item = (label: string) => {
    const found = items.find((i) => i.label === label);
    if (!found) throw new Error(`no "${label}" in ${items.map((i) => i.label).join(", ")}`);
    return found;
  };
  return { entries, items, item, actions };
}

const labels = (entries: ContextMenuEntry[]) => entries.map((e) => (e === "separator" ? "-" : "row" in e ? `[${e.row}]` : e.label));

describe("a track's header menu", () => {
  test("a MIDI track's: its name, states, views, clips, grouping, order and removal", () => {
    const { entries } = menu("a", [track("a"), track("b")]);
    expect(labels(entries)).toEqual([
      "Rename…",
      "[Color]",
      "-",
      "Mute",
      "Solo",
      "Arm for recording",
      "-",
      "Instrument and effects",
      "Show automation",
      "-",
      "Add empty MIDI clip",
      "Import .mid…",
      "Export .mid",
      "-",
      "Group this track",
      "Fold track",
      "Move up",
      "Move down",
      "-",
      "Clear all clips",
      "Remove track",
    ]);
  });

  test("each item asks for its action, for this track", () => {
    const { item, actions } = menu("b", [track("a"), track("b", { type: "audio", instrument: undefined })], { monitored: new Set(["b"]) });
    for (const [label, action, args] of [
      ["Rename…", "renameTrack", ["b"]],
      ["Mute", "toggleMute", ["b"]],
      ["Solo", "toggleSolo", ["b"]],
      ["Arm for recording", "toggleArm", ["b"]],
      ["Stop monitoring", "toggleMonitor", ["b"]],
      ["Effects", "openFx", ["b"]],
      ["Show automation", "toggleAutomation", ["b"]],
      ["Move up", "moveTrack", ["b", -1]],
      ["Remove track", "removeTrack", ["b"]],
    ] as const) {
      item(label).onSelect();
      expect(actions[action], label).toHaveBeenCalledWith(...args);
    }
  });

  test("it says what's on: muted, soloed, armed, the automation showing", () => {
    const { items } = menu("a", [track("a", { muted: true, solo: true, armed: true })], { automationChannelId: "a" });
    expect(items.map((i) => i.label)).toEqual(expect.arrayContaining(["Unmute", "Unsolo", "Disarm", "Hide automation"]));
  });

  test("what can't be done is greyed out: moving past the ends, clearing an empty track, exporting no notes", () => {
    const { item } = menu("a", [track("a"), track("b")]);
    expect(item("Move up").disabled).toBe(true);
    expect(item("Move down").disabled).toBe(false);
    expect(item("Clear all clips").disabled).toBe(true);
    expect(item("Export .mid").disabled).toBe(true);
  });

  test("a group's has no arming, clips or removal of its own: it ungroups", () => {
    const { items } = menu("g", [track("g", { type: "group", instrument: undefined }), track("a", { groupId: "g" })]);
    const names = items.map((i) => i.label);
    expect(names).toContain("Ungroup (keep the tracks)");
    expect(names).not.toContain("Arm for recording");
    expect(names).not.toContain("Clear all clips");
    expect(names).not.toContain("Remove track");
  });

  test("the color row recolors the track, and shows its color picked", () => {
    const { entries, actions } = menu("a", [track("a", { colorIndex: 2 })]);
    const row = entries.find((e): e is ContextMenuRow => e !== "separator" && "row" in e);
    if (!row) throw new Error("no color row");
    expect(row.options.findIndex((o) => o.selected)).toBe(2);
    row.options[4].onSelect();
    expect(actions.recolorTrack).toHaveBeenCalledWith("a", { colorIndex: 4 });
  });

  test("grouping shows its shortcut", () => {
    expect(menu("a", [track("a")]).item("Group this track").shortcut).toBe("mod+g");
  });
});

describe("the time selection's menu", () => {
  test("each edit shows its shortcut beside it, not in its name", () => {
    const { entries } = (() => {
      const time = new Proxy({}, { get: () => vi.fn() });
      return {
        entries: contextMenuItems(
          { kind: "range", x: 0, y: 0 },
          {} as MenuContext,
          { time } as unknown as MenuActions
        ),
      };
    })();
    const shortcuts = entries.filter((e): e is ContextMenuItem => e !== "separator" && !("row" in e)).map((i) => [i.label, i.shortcut]);
    expect(shortcuts).toEqual([
      ["Cut", "mod+x"],
      ["Copy", "mod+c"],
      ["Paste copied time here", "mod+v"],
      ["Duplicate", "mod+d"],
      ["Consolidate", "mod+j"],
      ["Loop the selection", "mod+l"],
      ["Insert silence", "mod+i"],
      ["Delete time", "shift+delete"],
      ["Empty the selection", "delete"],
    ]);
  });
});
