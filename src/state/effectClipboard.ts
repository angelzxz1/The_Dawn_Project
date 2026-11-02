// Effects copied from a rack (one card, or a whole chain), to paste into
// any track's, bus's or the master's: their settings, preset, file, bypass
// and sidechain. It lasts while the app runs, across projects.

import type { EffectInstance } from "@/effects/registry";

const EMPTY: EffectInstance[] = [];
let copied: EffectInstance[] = EMPTY;
const listeners = new Set<() => void>();

const clone = (fx: EffectInstance): EffectInstance => ({
  ...fx,
  params: { ...fx.params },
  ...(fx.sidechain ? { sidechain: { ...fx.sidechain } } : {}),
});

export function copyEffects(effects: EffectInstance[]): void {
  if (effects.length === 0) return;
  copied = effects.map(clone);
  listeners.forEach((fn) => fn());
}

/** What was copied last (empty: nothing yet), a stable array until the
 * next copy. */
export function copiedEffects(): EffectInstance[] {
  return copied;
}

export function subscribeCopiedEffects(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
