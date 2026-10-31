import { describe, expect, it } from "vitest";
import { EFFECT_TYPES } from "@/effects/registry";
import { FACTORY_CAB_TONES } from "./tones";
import { browserTones, PREVIEW_SOURCE, previewSourceFor, toneEffect } from "./previews";

describe("previews", () => {
  it("every effect but the Tuner has something to play through it", () => {
    for (const type of EFFECT_TYPES) expect(PREVIEW_SOURCE[type] === null, type).toBe(type === "tuner");
    expect(previewSourceFor("tuner")).toBeNull();
  });

  it("dynamics hear a drum groove, at 120 BPM; amps a plucked riff", () => {
    const drums = previewSourceFor("compressor");
    if (drums?.kind !== "drums") throw new Error("expected drums");
    expect(drums.hits.length).toBeGreaterThan(8);
    expect(drums.hits.every((h) => h.time >= 0 && h.time < 8)).toBe(true);
    expect(previewSourceFor("namAmp")).toEqual({ kind: "pluck" });
  });

  it("the IR Loader lists Dawn's cabinets; tones load into their own effect", () => {
    expect(browserTones("irLoader", []).slice(0, FACTORY_CAB_TONES.length)).toEqual(FACTORY_CAB_TONES);
    expect(browserTones("reverb", [])).toEqual([]);
    const amp = { id: "a", kind: "amp" as const, name: "Amp", description: "", creator: "x", file: "tones/a.nam" };
    expect(browserTones("namAmp", [amp])).toEqual([amp]);
    expect(toneEffect(amp)).toBe("namAmp");
    expect(toneEffect(FACTORY_CAB_TONES[0])).toBe("irLoader");
  });
});
