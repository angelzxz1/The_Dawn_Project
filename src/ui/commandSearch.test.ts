import { describe, expect, it } from "vitest";
import { paletteCommands, searchCommands, sheetGroups } from "./commandSearch";
import type { ActiveShortcut, ShortcutLayer } from "./shortcuts";

const s = (label: string, keys: string[], layer: ShortcutLayer = "studio", palette = true): ActiveShortcut => ({ label, keys, layer, palette, run: () => {} });

const UNDO = s("Undo", ["mod+z"]);
const REDO = s("Redo", ["mod+shift+z", "mod+y"]);
const ADD = s("Add an audio track", []);
const ZOOM = s("Zoom to fit the time selection, or the whole song", ["shift+z"]);

describe("searchCommands", () => {
  const all = [UNDO, REDO, ADD, ZOOM];

  it("finds a command by words in its name, in any order", () => {
    expect(searchCommands(all, "track audio")).toEqual([ADD]);
    expect(searchCommands(all, "")).toEqual(all);
  });

  it("finds one by its keys, as they read or as they're written", () => {
    expect(searchCommands(all, "ctrl+z")).toEqual([UNDO]);
    expect(searchCommands(all, "mod+y")).toEqual([REDO]);
  });

  it("puts names starting with the search first", () => {
    expect(searchCommands(all, "z").map((c) => c.label)).toEqual([ZOOM.label, UNDO.label, REDO.label]);
  });
});

describe("paletteCommands", () => {
  it("leaves out Close, what's kept from the palette, and repeats", () => {
    const list = [s("Close", ["escape"], "menu"), UNDO, s("Nudge", ["arrowleft"], "studio", false), s("Undo", ["mod+z"], "editor")];
    expect(paletteCommands(list)).toEqual([UNDO]);
  });
});

describe("sheetGroups", () => {
  it("groups the shortcuts with keys by where they work, top layer first, each once", () => {
    const list = [s("Quantize", ["q"], "editor"), UNDO, ADD, s("Save", ["mod+s"], "global"), UNDO];
    expect(sheetGroups(list).map((g) => [g.name, g.shortcuts.map((x) => x.label)])).toEqual([
      ["Piano roll", ["Quantize"]],
      ["Arrangement", ["Undo"]],
      ["Anywhere", ["Save"]],
    ]);
  });
});
