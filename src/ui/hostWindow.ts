"use client";

// The window a piece of UI is showing in. The studio can render part of
// itself (the mixer, the piano roll) into a window of its own - one React
// tree, so the project, undo and the engine are the same - and what that
// part listens to (drags, animation frames, sizes, keys) has to be that
// window's, not the main one's: a minimized main window stops its frames.

import { createContext, useContext } from "react";

/** A window, with its own constructors (ResizeObserver...). */
export type HostWindow = Window & typeof globalThis;

/** null: the main window. */
export const HostWindowContext = createContext<HostWindow | null>(null);

/** The window this component is in: a detached one, or the main window. */
export function useHostWindow(): HostWindow {
  return useContext(HostWindowContext) ?? window;
}

/** The detached window this component is in, or null in the main window. */
export function useDetachedWindow(): HostWindow | null {
  return useContext(HostWindowContext);
}
