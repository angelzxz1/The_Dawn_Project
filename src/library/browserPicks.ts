// The browser's favorites (starred) and recent items (the last ones added
// to a track): effects, presets, tones, grooves and samples, each by a key
// like "preset:factory:reverb:hall". Kept in this browser only, as a
// convenience: without storage they last as long as the page.

import { useSyncExternalStore } from "react";

export type PickKind = "effect" | "preset" | "tone" | "groove" | "sample";

/** A browser item's key: its kind and id ("effect:reverb"). */
export const pickKey = (kind: PickKind, id: string) => `${kind}:${id}`;

/** A key's kind and id. */
export function parsePick(key: string): { kind: PickKind; id: string } | null {
  const at = key.indexOf(":");
  const kind = key.slice(0, at) as PickKind;
  if (at < 1 || !["effect", "preset", "tone", "groove", "sample"].includes(kind)) return null;
  return { kind, id: key.slice(at + 1) };
}

export interface Picks {
  favorites: string[];
  /** Most recent first. */
  recent: string[];
}

const STORAGE_KEY = "dawn.browserPicks";
export const MAX_RECENT = 8;
const EMPTY: Picks = { favorites: [], recent: [] };

function load(): Picks {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Picks> | null;
    const keys = (list: unknown) => (Array.isArray(list) ? list.filter((k): k is string => typeof k === "string" && !!parsePick(k)) : []);
    return raw ? { favorites: keys(raw.favorites), recent: keys(raw.recent).slice(0, MAX_RECENT) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

let picks: Picks | null = null;
const listeners = new Set<() => void>();

function current(): Picks {
  return (picks ??= typeof localStorage === "undefined" ? EMPTY : load());
}

function change(next: Picks): void {
  picks = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Not kept, but still works for this visit.
  }
  listeners.forEach((fn) => fn());
}

export function getPicks(): Picks {
  return current();
}

export function isFavorite(key: string): boolean {
  return current().favorites.includes(key);
}

/** Stars an item, or unstars it. */
export function toggleFavorite(key: string): void {
  const { favorites, recent } = current();
  change({ recent, favorites: favorites.includes(key) ? favorites.filter((k) => k !== key) : [...favorites, key] });
}

/** An item was added to a track: it's the most recent. */
export function noteUsed(key: string): void {
  const { favorites, recent } = current();
  change({ favorites, recent: [key, ...recent.filter((k) => k !== key)].slice(0, MAX_RECENT) });
}

/** Forgets every pick (for tests). */
export function resetPicks(): void {
  change(EMPTY);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The favorites and recent items, kept up to date. */
export function usePicks(): Picks {
  return useSyncExternalStore(subscribe, current, () => EMPTY);
}
