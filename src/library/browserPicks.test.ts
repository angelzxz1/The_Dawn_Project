import { beforeEach, describe, expect, it } from "vitest";
import { getPicks, isFavorite, MAX_RECENT, noteUsed, parsePick, pickKey, resetPicks, toggleFavorite } from "./browserPicks";

beforeEach(() => resetPicks());

describe("browser picks", () => {
  it("keys an item by its kind and id, ids with colons and all", () => {
    expect(pickKey("preset", "factory:reverb:hall")).toBe("preset:factory:reverb:hall");
    expect(parsePick("preset:factory:reverb:hall")).toEqual({ kind: "preset", id: "factory:reverb:hall" });
    expect(parsePick("planet:mars")).toBeNull();
    expect(parsePick("nothing")).toBeNull();
  });

  it("stars and unstars", () => {
    toggleFavorite("effect:reverb");
    toggleFavorite("groove:rock-verse");
    expect(isFavorite("effect:reverb")).toBe(true);
    toggleFavorite("effect:reverb");
    expect(getPicks().favorites).toEqual(["groove:rock-verse"]);
  });

  it("keeps the last items used, most recent first, each once", () => {
    for (let i = 0; i < MAX_RECENT + 2; i++) noteUsed(`effect:fx${i}`);
    noteUsed("effect:fx5");
    const { recent } = getPicks();
    expect(recent).toHaveLength(MAX_RECENT);
    expect(recent[0]).toBe("effect:fx5");
    expect(recent.filter((k) => k === "effect:fx5")).toHaveLength(1);
    expect(recent).not.toContain("effect:fx0");
  });
});
