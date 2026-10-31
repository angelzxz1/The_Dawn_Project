// The right-click menu on an effect's card in the rack: everything the card
// and its window do, in one place.

import { ArrowLeft, ArrowRight, CopyPlus, Maximize2, Power, RotateCcw, Trash2 } from "lucide-react";
import { defaultParams, EFFECT_LABELS, type EffectInstance } from "@/effects/registry";
import type { ContextMenuEntry } from "@/studio/shell/ContextMenu";

export interface EffectMenuActions {
  open: (effectId: string) => void;
  toggleBypass: (effectId: string) => void;
  move: (effectId: string, toIndex: number) => void;
  duplicate: (effectId: string) => void;
  /** Back to the effect's default settings; omitted where presets can't
   * be loaded. */
  reset?: (effectId: string, params: Record<string, number>) => void;
  remove: (effectId: string) => void;
}

export function effectMenuItems(effects: EffectInstance[], effectId: string, actions: EffectMenuActions): ContextMenuEntry[] {
  const index = effects.findIndex((e) => e.id === effectId);
  if (index === -1) return [];
  const fx = effects[index];
  const label = EFFECT_LABELS[fx.type];
  return [
    { label: `Open ${label}`, icon: <Maximize2 size={13} />, onSelect: () => actions.open(effectId) },
    { label: fx.bypass ? "Turn back on" : "Bypass", icon: <Power size={13} />, onSelect: () => actions.toggleBypass(effectId) },
    "separator",
    { label: "Move left", icon: <ArrowLeft size={13} />, disabled: index === 0, onSelect: () => actions.move(effectId, index - 1) },
    { label: "Move right", icon: <ArrowRight size={13} />, disabled: index === effects.length - 1, onSelect: () => actions.move(effectId, index + 1) },
    { label: "Duplicate", icon: <CopyPlus size={13} />, onSelect: () => actions.duplicate(effectId) },
    ...(actions.reset
      ? [{ label: "Reset to the defaults", icon: <RotateCcw size={13} />, onSelect: () => actions.reset!(effectId, defaultParams(fx.type)) }]
      : []),
    "separator",
    { label: "Remove", icon: <Trash2 size={13} />, danger: true, onSelect: () => actions.remove(effectId) },
  ];
}
