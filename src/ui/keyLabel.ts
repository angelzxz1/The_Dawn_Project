// How a shortcut's keys (shortcuts.ts: "mod+shift+z", "space", "f2") read on
// a button's tooltip or in a menu: "Ctrl+Shift+Z", or "⌘⇧Z" on a Mac.

const NAMES: Record<string, string> = {
  space: "Space",
  delete: "Delete",
  escape: "Esc",
  enter: "Enter",
  tab: "Tab",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
};

/** Whether this is a Mac (or an iPad), where Ctrl is Cmd. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** "Ctrl+Shift+Z" for "mod+shift+z" ("⌘⇧Z" on a Mac); "Space", "F2", "←". */
export function keyLabel(keys: string, mac = isMac()): string {
  const parts = keys.toLowerCase().split("+");
  const key = parts.pop()!;
  const name = NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));
  if (mac) {
    const mods = (parts.includes("alt") ? "⌥" : "") + (parts.includes("shift") ? "⇧" : "") + (parts.includes("mod") ? "⌘" : "");
    return mods + name;
  }
  const mods = [parts.includes("mod") && "Ctrl", parts.includes("alt") && "Alt", parts.includes("shift") && "Shift"].filter(Boolean);
  return [...mods, name].join("+");
}

/** A tooltip with its shortcut after it: "Undo (Ctrl+Z)". `rest` follows
 * the shortcut: "Zoom in (=) · Ctrl+wheel zooms around the pointer". */
export function withKeys(title: string, keys: string | string[], rest?: string): string {
  const list = (Array.isArray(keys) ? keys : [keys]).map((k) => keyLabel(k));
  return `${title} (${list.join(" or ")})${rest ? ` · ${rest}` : ""}`;
}
