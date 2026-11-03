"use client";

// A part of the studio in a window of its own, to put on a second screen:
// the browser's pop-up window, or a Tauri window in the desktop app (which
// opens one for window.open; see src-tauri/src/lib.rs). It's the same React
// tree rendered into the other window's page, so it shows the same
// project, and what it changes is undone with the rest.

import { useEffect, useEffectEvent, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { isDesktopApp } from "@/services/desktop";
import { HostWindowContext, type HostWindow } from "./hostWindow";
import { shortcuts } from "./shortcuts";

export interface PopoutBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

const boundsKey = (name: string) => `dawn.popout.${name}`;

function savedBounds(name: string): PopoutBounds | null {
  try {
    const b = JSON.parse(localStorage.getItem(boundsKey(name)) ?? "null") as PopoutBounds | null;
    return b && [b.left, b.top, b.width, b.height].every(Number.isFinite) ? b : null;
  } catch {
    return null;
  }
}

function saveBounds(name: string, b: PopoutBounds): void {
  try {
    localStorage.setItem(boundsKey(name), JSON.stringify(b));
  } catch {
    // Not kept; it opens at its usual size next time.
  }
}

/** The window.open features for a window last left at `saved` (or of
 * `size`, new). */
export function popoutFeatures(size: { width: number; height: number }, saved: PopoutBounds | null): string {
  const b = saved ?? { ...size, left: NaN, top: NaN };
  const parts = ["popup=yes", `width=${Math.round(Math.max(320, b.width))}`, `height=${Math.round(Math.max(240, b.height))}`];
  if (Number.isFinite(b.left) && Number.isFinite(b.top)) parts.push(`left=${Math.round(b.left)}`, `top=${Math.round(b.top)}`);
  return parts.join(",");
}

/** The address a window is opened at: blank, and in the desktop app named
 * after the window (its fragment), which the app labels it by, to close it
 * (closeWindow). */
export function popoutAddress(name: string, desktop: boolean): string {
  return desktop ? `about:blank#dawn-${name}` : "";
}

/** Opens (or brings back) the window for `name`, where it was last left.
 * Call it from a click: browsers block pop-ups opened any other way.
 * Null when it was blocked. */
export function openPopout(name: string, size: { width: number; height: number }): HostWindow | null {
  const address = popoutAddress(name, isDesktopApp());
  const win = window.open(address, `dawn-${name}`, popoutFeatures(size, savedBounds(name))) as HostWindow | null;
  win?.focus();
  return win;
}

/** Closes the window. In the desktop app the app closes it: window.close()
 * there takes away only its page, leaving the window empty. */
function closeWindow(win: Window, name: string): void {
  if (isDesktopApp()) {
    invoke("close_studio_window", { name: `dawn-${name}` }).catch(() => win.close());
  } else {
    win.close();
  }
}

const COPIED = "data-dawn-copied";
const ROOT_ID = "dawn-popout-root";

/** Windows to close once React is done (it may unmount and mount an effect
 * again straight away, in development). */
const closing = new WeakMap<Window, number>();

/** A stylesheet's url()s (its fonts), made absolute: they're relative to
 * the sheet, which the copy in another page isn't. */
export function absoluteUrls(css: string, base: string): string {
  return css.replace(/url\((["']?)([^"')]+)\1\)/g, (whole, quote: string, url: string) => {
    if (/^(data|blob|https?|about):|^#/.test(url)) return whole;
    try {
      return `url(${quote}${new URL(url, base).href}${quote})`;
    } catch {
      return whole;
    }
  });
}

/** Gives the window the studio's stylesheets, and keeps them as the main
 * page's change (the theme, a stylesheet loaded later). */
function mirrorPage(from: Document, to: Document): () => void {
  // Each of the main page's stylesheets, as rules in a <style> of the
  // window's own: a blank window opened this way doesn't load a <link>.
  // Kept by the sheet's element, and rewritten only when its rules change.
  const copies = new Map<Node, HTMLStyleElement>();
  const copyHead = () => {
    const present = new Set<Node>();
    for (const sheet of [...from.styleSheets]) {
      const owner = sheet.ownerNode;
      if (!owner) continue;
      let text: string;
      try {
        text = absoluteUrls([...sheet.cssRules].map((r) => r.cssText).join("\n"), sheet.href ?? from.baseURI);
      } catch {
        continue; // Another site's sheet; the studio has none.
      }
      present.add(owner);
      let copy = copies.get(owner);
      if (!copy) {
        copy = to.createElement("style");
        copy.setAttribute(COPIED, "");
        if (sheet.media.mediaText) copy.media = sheet.media.mediaText;
        to.head.append(copy);
        copies.set(owner, copy);
      }
      if (copy.textContent !== text) copy.textContent = text;
    }
    for (const [owner, copy] of copies) {
      if (present.has(owner)) continue;
      copy.remove();
      copies.delete(owner);
    }
  };
  const copyAttributes = (a: Element, b: Element) => {
    for (const { name } of [...b.attributes]) if (!a.hasAttribute(name)) b.removeAttribute(name);
    for (const { name, value } of [...a.attributes]) b.setAttribute(name, value);
  };
  const copyRoot = () => {
    copyAttributes(from.documentElement, to.documentElement);
    copyAttributes(from.body, to.body);
  };
  copyHead();
  copyRoot();
  const heads = new MutationObserver(copyHead);
  heads.observe(from.head, { childList: true, subtree: true, characterData: true });
  // A stylesheet added later has its rules once it's loaded.
  from.addEventListener("load", copyHead, true);
  const roots = new MutationObserver(copyRoot);
  roots.observe(from.documentElement, { attributes: true });
  roots.observe(from.body, { attributes: true });
  return () => {
    heads.disconnect();
    from.removeEventListener("load", copyHead, true);
    roots.disconnect();
  };
}

function setTitle(win: Window, title: string): void {
  win.document.title = title;
}

interface PopoutProps {
  /** From openPopout. Key the component by it: one window per mount. */
  win: HostWindow;
  /** Where its size and place are remembered. */
  name: string;
  /** The window's title bar. */
  title: string;
  /** The window was closed (its close button, or the page in it left). */
  onClose: () => void;
  children: ReactNode;
}

/** Shows `children` in `win`. The window closes when this unmounts, and
 * the main page closing closes it too. */
export function Popout({ win, name, title, onClose, children }: PopoutProps) {
  const [host] = useState(() => {
    const doc = win.document;
    const there = doc.getElementById(ROOT_ID);
    if (there) return there;
    doc.body.replaceChildren();
    const el = doc.createElement("div");
    el.id = ROOT_ID;
    el.className = "flex h-screen flex-col overflow-hidden";
    doc.body.append(el);
    return el;
  });
  const closed = useEffectEvent(onClose);

  useLayoutEffect(() => {
    window.clearTimeout(closing.get(win));
    closing.delete(win);
    const doc = win.document;
    if (!doc.querySelector("meta[charset]")) {
      const charset = doc.createElement("meta");
      charset.setAttribute("charset", "utf-8");
      doc.head.prepend(charset);
    }
    const stopMirroring = mirrorPage(document, doc);
    const stopKeys = shortcuts.attach(win);
    let bounds: PopoutBounds | null = null;
    let gone = false;
    const measure = () => {
      if (win.closed || win.outerWidth === 0) return;
      bounds = { left: win.screenX, top: win.screenY, width: win.innerWidth, height: win.innerHeight };
    };
    const finish = () => {
      if (gone) return;
      gone = true;
      if (bounds) saveBounds(name, bounds);
      closed();
    };
    measure();
    win.addEventListener("resize", measure);
    win.addEventListener("pagehide", finish);
    // Moving a window fires nothing, and a closed one may not say so.
    const timer = window.setInterval(() => (win.closed ? finish() : measure()), 500);
    const closeWithPage = () => closeWindow(win, name);
    window.addEventListener("pagehide", closeWithPage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", closeWithPage);
      stopKeys();
      stopMirroring();
      if (!gone) {
        gone = true;
        measure();
        if (bounds) saveBounds(name, bounds);
        win.removeEventListener("pagehide", finish);
        win.removeEventListener("resize", measure);
        closing.set(
          win,
          window.setTimeout(() => {
            closing.delete(win);
            closeWindow(win, name);
          })
        );
      }
    };
  }, [win, name]);

  useEffect(() => setTitle(win, title), [win, title]);

  return createPortal(<HostWindowContext value={win}>{children}</HostWindowContext>, host);
}
