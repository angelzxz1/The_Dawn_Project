// How the studio works and looks for you, whatever the project
// (Preferences): the count-in a new project starts with, how often a
// project saved in a folder saves itself there, the theme and the UI size.
// Kept in localStorage like the audio settings (audioPrefs.ts); without it,
// the defaults.

import { useSyncExternalStore } from "react";
import { STUDIO_PREFS_KEY } from "@/studio/shell/themeBoot";

export interface StudioPrefs {
  /** Bars of count-in for a new project from a template that doesn't
   * choose its own (Empty, Beat). */
  defaultCountInBars: 0 | 1 | 2 | 4;
  /** Minutes between saves into a project's folder while it has unsaved
   * changes; 0 is off. The browser's own working copy is kept either way. */
  autosaveMinutes: 0 | 1 | 2 | 5 | 10;
  /** The studio's colors: dark, light, or the system's. */
  theme: ThemeChoice;
  /** The whole studio's size, in the desktop app (its window's zoom);
   * 1 is 100%. */
  uiScale: number;
}

export type ThemeChoice = "dark" | "light" | "system";
export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "dark", "light"];
export const COUNT_IN_CHOICES = [0, 1, 2, 4] as const;
export const AUTOSAVE_CHOICES = [0, 1, 2, 5, 10] as const;
export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;

export const DEFAULT_STUDIO_PREFS: StudioPrefs = { defaultCountInBars: 0, autosaveMinutes: 0, theme: "dark", uiScale: 1 };

// The studio's page reads the theme from there before it draws, so it
// doesn't flash dark first (themeBoot.ts).
const KEY = STUDIO_PREFS_KEY;

export function parseStudioPrefs(raw: unknown): StudioPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof StudioPrefs, unknown>>;
  const oneOf = <T extends number>(v: unknown, choices: readonly T[], d: T): T => ((choices as readonly unknown[]).includes(v) ? (v as T) : d);
  return {
    defaultCountInBars: oneOf(r.defaultCountInBars, COUNT_IN_CHOICES, 0),
    autosaveMinutes: oneOf(r.autosaveMinutes, AUTOSAVE_CHOICES, 0),
    theme: (THEME_CHOICES as readonly unknown[]).includes(r.theme) ? (r.theme as ThemeChoice) : "dark",
    uiScale: oneOf(r.uiScale, UI_SCALES, 1),
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
