import { describe, expect, it } from "vitest";
import { keyLabel, withKeys } from "./keyLabel";

describe("keyLabel", () => {
  it("names the keys and modifiers, Ctrl first and Shift last", () => {
    expect(keyLabel("mod+shift+z", false)).toBe("Ctrl+Shift+Z");
    expect(keyLabel("space", false)).toBe("Space");
    expect(keyLabel("shift+delete", false)).toBe("Shift+Delete");
    expect(keyLabel("f2", false)).toBe("F2");
    expect(keyLabel("shift+arrowleft", false)).toBe("Shift+←");
    expect(keyLabel("=", false)).toBe("=");
    expect(keyLabel("alt+mod+1", false)).toBe("Ctrl+Alt+1");
  });

  it("uses the Mac's symbols on a Mac", () => {
    expect(keyLabel("mod+shift+z", true)).toBe("⇧⌘Z");
    expect(keyLabel("mod+l", true)).toBe("⌘L");
    expect(keyLabel("space", true)).toBe("Space");
  });
});

describe("withKeys", () => {
  it("puts the shortcut after the title, and anything else after that", () => {
    // Node has no navigator: not a Mac.
    expect(withKeys("Undo", "mod+z")).toBe("Undo (Ctrl+Z)");
    expect(withKeys("Redo", ["mod+shift+z", "mod+y"])).toBe("Redo (Ctrl+Shift+Z or Ctrl+Y)");
    expect(withKeys("Zoom in", "=", "Ctrl+wheel zooms")).toBe("Zoom in (=) · Ctrl+wheel zooms");
  });
});
