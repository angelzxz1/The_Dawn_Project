// What an effect drag carries, from the effect browser (an effect, a
// preset, a chain) or a rack's card (effects of that track, bus or the
// master), and where it can land: a gap in a rack, a track's header, a bus
// or the master. Dropped on another chain a card moves there; with Ctrl
// (or Alt, or Cmd) held, a copy goes and the card stays.

import type { EffectType } from "@/effects/registry";

/** An effect type, from the browser. */
export const EFFECT_DRAG_MIME = "application/x-dawn-effect-type";
/** Carried alongside EFFECT_DRAG_MIME when a preset is dragged: its id. */
export const PRESET_DRAG_MIME = "application/x-dawn-effect-preset";
/** A chain's id (a factory one or yours), from the browser. */
export const CHAIN_DRAG_MIME = "application/x-dawn-effect-chain";
/** A rack's cards: `{ host, ids }` as JSON. */
export const RACK_EFFECTS_MIME = "application/x-dawn-rack-effects";

export type EffectDrop =
  | { kind: "effect"; type: EffectType; preset?: string }
  | { kind: "chain"; chain: string }
  | { kind: "rack"; host: string; ids: string[]; copy: boolean };

const MIMES = [EFFECT_DRAG_MIME, CHAIN_DRAG_MIME, RACK_EFFECTS_MIME];

/** Whether a drag (while it's over something, before its data can be read)
 * carries effects. */
export const carriesEffects = (e: React.DragEvent | DragEvent) => MIMES.some((m) => e.dataTransfer?.types.includes(m));

/** Whether a drop asks for copies (Ctrl, Alt or Cmd held). */
export const wantsCopy = (e: React.DragEvent | DragEvent) => e.ctrlKey || e.altKey || e.metaKey;

/** Starts dragging a rack's cards. */
export function startRackDrag(e: React.DragEvent, host: string, ids: string[]): void {
  e.dataTransfer.setData(RACK_EFFECTS_MIME, JSON.stringify({ host, ids }));
  e.dataTransfer.effectAllowed = "copyMove";
}

/** What a drop carries, or null if it isn't effects. */
export function readEffectDrop(e: React.DragEvent | DragEvent): EffectDrop | null {
  const data = e.dataTransfer;
  if (!data) return null;
  const type = data.getData(EFFECT_DRAG_MIME) as EffectType | "";
  if (type) return { kind: "effect", type, preset: data.getData(PRESET_DRAG_MIME) || undefined };
  const chain = data.getData(CHAIN_DRAG_MIME);
  if (chain) return { kind: "chain", chain };
  try {
    const rack = JSON.parse(data.getData(RACK_EFFECTS_MIME) || "null") as { host?: unknown; ids?: unknown } | null;
    if (rack && typeof rack.host === "string" && Array.isArray(rack.ids)) {
      return { kind: "rack", host: rack.host, ids: rack.ids.filter((id): id is string => typeof id === "string"), copy: wantsCopy(e) };
    }
  } catch {
    // Not ours.
  }
  return null;
}
