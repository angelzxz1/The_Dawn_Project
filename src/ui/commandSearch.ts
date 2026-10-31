// What the command palette and the cheat sheet show of the shortcut
// registry (shortcuts.ts `active()`): where each shortcut works, and
// finding a command by what it's called or by its keys.

import type { ActiveShortcut, ShortcutLayer } from "./shortcuts";
import { keyLabel } from "./keyLabel";

/** Where a layer's shortcuts work, as the cheat sheet heads them. */
export const LAYER_NAMES: Record<ShortcutLayer, string> = {
  studio: "Arrangement",
  notes: "Playing notes",
  editor: "Piano roll",
  window: "Windows",
  dialog: "Dialogs",
  menu: "Menus",
  global: "Anywhere",
  overlay: "Tour",
};

/** The palette's commands: the labeled ones that can run from it (not a
 * menu's or a window's Close, which the palette itself would be in the
 * way of), each once. */
export function paletteCommands(active: ActiveShortcut[]): ActiveShortcut[] {
  const seen = new Set<string>();
  return active.filter((s) => {
    if (!s.palette || s.label === "Close") return false;
    if (seen.has(s.label)) return false;
    seen.add(s.label);
    return true;
  });
}

/** The commands matching a search: every word in it is in the command's
 * name or its keys ("ctrl z" finds Undo). Names starting with the search
 * come first; otherwise they keep their order. */
export function searchCommands(commands: ActiveShortcut[], query: string): ActiveShortcut[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands;
  const text = (s: ActiveShortcut) => `${s.label} ${s.keys.map((k) => `${keyLabel(k)} ${k}`).join(" ")}`.toLowerCase();
  const found = commands.filter((s) => {
    const t = text(s);
    return words.every((w) => t.includes(w));
  });
  const q = query.trim().toLowerCase();
  return [...found.filter((s) => s.label.toLowerCase().startsWith(q)), ...found.filter((s) => !s.label.toLowerCase().startsWith(q))];
}

/** The cheat sheet: the shortcuts with keys, grouped by where they work,
 * top layer first, each label and key once. */
export function sheetGroups(active: ActiveShortcut[]): { layer: ShortcutLayer; name: string; shortcuts: ActiveShortcut[] }[] {
  const groups: { layer: ShortcutLayer; name: string; shortcuts: ActiveShortcut[] }[] = [];
  const seen = new Set<string>();
  active.forEach((s) => {
    if (s.keys.length === 0) return;
    const id = `${s.label}|${s.keys.join(",")}`;
    if (seen.has(id)) return;
    seen.add(id);
    let group = groups.find((g) => g.layer === s.layer);
    if (!group) groups.push((group = { layer: s.layer, name: LAYER_NAMES[s.layer], shortcuts: [] }));
    group.shortcuts.push(s);
  });
  return groups;
}
