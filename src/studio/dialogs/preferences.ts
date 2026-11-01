// Opening the Preferences window from anywhere (the CPU panel, the note
// after a take, a shortcut), at one of its tabs. The studio listens.

export type PrefsTab = "audio" | "recording" | "metronome" | "projects";

export const PREFS_TABS: { id: PrefsTab; label: string }[] = [
  { id: "audio", label: "Audio" },
  { id: "recording", label: "Recording" },
  { id: "metronome", label: "Metronome" },
  { id: "projects", label: "Projects" },
];

const listeners = new Set<(tab: PrefsTab) => void>();

export function openPreferences(tab: PrefsTab = "audio"): void {
  listeners.forEach((fn) => fn(tab));
}

/** Calls `fn` when something asks for the window. Returns an unsubscribe. */
export function onOpenPreferences(fn: (tab: PrefsTab) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
