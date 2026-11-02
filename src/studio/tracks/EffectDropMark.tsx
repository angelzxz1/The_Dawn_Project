// The mark on a track's header, a bus or the master while effects are
// dragged over it, saying what dropping them does.

import { RACK_EFFECTS_MIME, wantsCopy } from "@/studio/rack/effectDrag";

/** "move" and "copy": a rack's cards (copy with Ctrl held); "add": the
 * browser's effects and chains. */
export type EffectDropHint = "add" | "move" | "copy";

export function effectDropHint(e: React.DragEvent): EffectDropHint {
  if (!e.dataTransfer.types.includes(RACK_EFFECTS_MIME)) return "add";
  return wantsCopy(e) ? "copy" : "move";
}

const LABELS: Record<EffectDropHint, string> = { add: "add here", move: "move here", copy: "copy here" };

export function EffectDropMark({ hint }: { hint: EffectDropHint }) {
  return (
    <div data-effect-drop={hint} className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded border-2 border-dashed border-accent bg-accent/15">
      <span className="rounded bg-accent px-1.5 text-[9px] font-semibold uppercase leading-[14px] tracking-wide text-on-accent">FX: {LABELS[hint]}</span>
    </div>
  );
}
