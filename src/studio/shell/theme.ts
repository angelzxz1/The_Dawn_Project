// The studio's theme and size (Preferences > Appearance): the theme is an
// attribute on the page (globals.css retunes the colors for it), and the
// size, in the desktop app, is the window's zoom - a true zoom, so where
// the pointer is still matches where things are drawn. A browser keeps its
// own zoom (Ctrl + and Ctrl -), which a page can't set.

import { useEffect } from "react";
import type { ThemeChoice } from "@/state/studioPrefs";
import { isDesktopApp } from "@/services/desktop";
import { noteIssue } from "@/services/issues";
import { LIGHT_QUERY } from "./themeBoot";

export type Theme = "dark" | "light";

export function resolveTheme(choice: ThemeChoice, systemLight: boolean): Theme {
  return choice === "system" ? (systemLight ? "light" : "dark") : choice;
}

/** Puts the chosen theme on the page while the studio is open (following
 * the system's when that's the choice), and takes it off after, so the
 * website keeps its own. */
export function useStudioTheme(choice: ThemeChoice): void {
  useEffect(() => {
    const root = document.documentElement;
    const query = window.matchMedia?.(LIGHT_QUERY);
    const apply = () => {
      root.dataset.theme = resolveTheme(choice, !!query?.matches);
    };
    apply();
    if (choice !== "system" || !query) return;
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [choice]);
  useEffect(() => () => void delete document.documentElement.dataset.theme, []);
}

/** Zooms the desktop app's window to the chosen size. */
export function useUiScale(scale: number): void {
  useEffect(() => {
    if (!isDesktopApp()) return;
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) => getCurrentWebview().setZoom(scale))
      .catch((error) => noteIssue("ui.zoom", error, { report: false }));
  }, [scale]);
}
