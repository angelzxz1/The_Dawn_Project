// What the browser plays to preview an effect, a preset or a tone: a drum
// groove for what shapes dynamics and tone (compressors, EQs), a plucked
// riff for what a guitar goes through (amps, cabinets, drive, space), and
// nothing for the Tuner, which doesn't change the sound.

import type { EffectType } from "@/effects/registry";
import type { PreviewHit } from "@/engine/audioEngine";
import type { DrumKitParams } from "@/instruments/drum-rack/drumParams";
import { allGrooves, grooveHits, grooveKit } from "./grooves";
import { FACTORY_CAB_TONES, type ToneEntry } from "./tones";
import { packTones } from "@/project/packStore";

export const PREVIEW_SOURCE: Record<EffectType, "drums" | "pluck" | null> = {
  compressor: "drums",
  glue: "drums",
  crusher: "drums",
  multiband: "drums",
  mbDynamics: "drums",
  limiter: "drums",
  gate: "drums",
  paramEq: "drums",
  eq3: "drums",
  utility: "drums",
  filter: "pluck",
  chorus: "pluck",
  pitchShift: "pluck",
  distortion: "pluck",
  reverb: "pluck",
  delay: "pluck",
  tubeAmp: "pluck",
  tremor: "pluck",
  namAmp: "pluck",
  irLoader: "pluck",
  tuner: null,
  plugin: null,
};

export type PreviewSource = { kind: "drums"; kit: DrumKitParams; hits: PreviewHit[] } | { kind: "pluck" };

/** What plays through an effect to preview it, or null if it has nothing
 * to hear. The drums are the first rock groove, at 120 BPM. */
export function previewSourceFor(type: EffectType): PreviewSource | null {
  const kind = PREVIEW_SOURCE[type];
  if (kind !== "drums") return kind === "pluck" ? { kind } : null;
  const groove = allGrooves().find((g) => g.genre.id === "rock") ?? allGrooves()[0];
  if (!groove) return { kind: "pluck" };
  return { kind: "drums", kit: grooveKit(groove), hits: grooveHits(groove).map((h) => ({ pad: h.pad, time: h.beat * 0.5, velocity: h.velocity })) };
}

/** The effect a tone loads into. */
export const toneEffect = (tone: ToneEntry): EffectType => (tone.kind === "amp" ? "namAmp" : "irLoader");

/** The tones the browser lists under an effect: Dawn's cabinets and the
 * packs' for the IR Loader, the packs' captures for the NAM Amp, then any
 * bundled with Dawn (`bundled`, from tones/manifest.json). */
export function browserTones(type: EffectType, bundled: ToneEntry[]): ToneEntry[] {
  if (type === "irLoader") return [...FACTORY_CAB_TONES, ...bundled.filter((t) => t.kind === "ir"), ...packTones("ir")];
  if (type === "namAmp") return [...bundled.filter((t) => t.kind === "amp"), ...packTones("amp")];
  return [];
}
