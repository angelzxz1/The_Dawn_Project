// The right-click menu on an effect's card in the rack: everything the card
// and its window do, in one place.

import { ArrowLeft, ArrowRight, ClipboardPaste, Copy, CopyPlus, Layers, Maximize2, Power, RotateCcw, Trash2 } from "lucide-react";
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
  /** Copies effects (one, or the whole chain) to paste on any chain. */
  copy?: (effectIds: string[]) => void;
  /** Pastes what was copied at a place in the chain; `copied` is how many
   * effects that is (0: nothing yet). */
  paste?: (atIndex: number) => void;
  copied?: number;
}

const pasteLabel = (copied: number, where: string) => `Paste ${copied === 1 ? "the effect" : `${copied} effects`} ${where}`;

/** The menu on the rack outside its cards: pasting at the end. */
export function rackMenuItems(count: number, actions: Pick<EffectMenuActions, "paste" | "copied">): ContextMenuEntry[] {
  if (!actions.paste) return [];
  const copied = actions.copied ?? 0;
  return [
    {
      label: copied ? pasteLabel(copied, count ? "at the end" : "here") : "Paste effects (nothing copied yet)",
      icon: <ClipboardPaste size={13} />,
      disabled: copied === 0,
      onSelect: () => actions.paste!(count),
    },
  ];
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
    ...(actions.copy
      ? [
          { label: "Copy", icon: <Copy size={13} />, onSelect: () => actions.copy!([effectId]) },
          ...(effects.length > 1
            ? [{ label: `Copy the whole chain (${effects.length})`, icon: <Layers size={13} />, onSelect: () => actions.copy!(effects.map((e) => e.id)) }]
            : []),
        ]
      : []),
    ...(actions.paste
      ? [
          {
            label: actions.copied ? pasteLabel(actions.copied, "after this") : "Paste (nothing copied yet)",
            icon: <ClipboardPaste size={13} />,
            disabled: !actions.copied,
            onSelect: () => actions.paste!(index + 1),
          },
        ]
      : []),
    ...(actions.reset
      ? [{ label: "Reset to the defaults", icon: <RotateCcw size={13} />, onSelect: () => actions.reset!(effectId, defaultParams(fx.type)) }]
      : []),
    "separator",
    { label: "Remove", icon: <Trash2 size={13} />, danger: true, onSelect: () => actions.remove(effectId) },
  ];
}
