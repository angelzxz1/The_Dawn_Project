// How the studio works for you, whatever the project (Preferences >
// Projects): the count-in a new project starts with, and how often a
// project saved in a folder saves itself there. Kept in localStorage like
// the audio settings (audioPrefs.ts); without it, the defaults.

import { useSyncExternalStore } from "react";

export interface StudioPrefs {
  /** Bars of count-in for a new project from a template that doesn't
   * choose its own (Empty, Beat). */
  defaultCountInBars: 0 | 1 | 2 | 4;
  /** Minutes between saves into a project's folder while it has unsaved
   * changes; 0 is off. The browser's own working copy is kept either way. */
  autosaveMinutes: 0 | 1 | 2 | 5 | 10;
}

export const COUNT_IN_CHOICES = [0, 1, 2, 4] as const;
export const AUTOSAVE_CHOICES = [0, 1, 2, 5, 10] as const;

export const DEFAULT_STUDIO_PREFS: StudioPrefs = { defaultCountInBars: 0, autosaveMinutes: 0 };

const KEY = "dawn.studioPrefs.v1";

export function parseStudioPrefs(raw: unknown): StudioPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof StudioPrefs, unknown>>;
  const oneOf = <T extends number>(v: unknown, choices: readonly T[], d: T): T => ((choices as readonly unknown[]).includes(v) ? (v as T) : d);
  return {
    defaultCountInBars: oneOf(r.defaultCountInBars, COUNT_IN_CHOICES, 0),
    autosaveMinutes: oneOf(r.autosaveMinutes, AUTOSAVE_CHOICES, 0),
  };
}

let current: StudioPrefs | null = null;
const listeners = new Set<() => void>();

export function getStudioPrefs(): StudioPrefs {
  if (current) return current;
  try {
    current = parseStudioPrefs(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    current = { ...DEFAULT_STUDIO_PREFS };
  }
  return current;
}

export function updateStudioPrefs(change: Partial<StudioPrefs>): void {
  current = { ...getStudioPrefs(), ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Not kept, but it works for this visit.
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useStudioPrefs(): [StudioPrefs, (change: Partial<StudioPrefs>) => void] {
  return [useSyncExternalStore(subscribe, getStudioPrefs, () => DEFAULT_STUDIO_PREFS), updateStudioPrefs];
}
