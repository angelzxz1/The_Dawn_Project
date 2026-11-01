import { describe, expect, it } from "vitest";
import { DEFAULT_STUDIO_PREFS, parseStudioPrefs } from "./studioPrefs";

describe("parseStudioPrefs", () => {
  it("keeps the choices there are, and defaults the rest", () => {
    expect(parseStudioPrefs(null)).toEqual(DEFAULT_STUDIO_PREFS);
    expect(parseStudioPrefs({ defaultCountInBars: 2, autosaveMinutes: 5, theme: "light", uiScale: 1.25 })).toEqual({
      defaultCountInBars: 2,
      autosaveMinutes: 5,
      theme: "light",
      uiScale: 1.25,
    });
    expect(parseStudioPrefs({ defaultCountInBars: 3, autosaveMinutes: -1, theme: "neon", uiScale: 7 })).toEqual(DEFAULT_STUDIO_PREFS);
  });
});
