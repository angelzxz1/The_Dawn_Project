"use client";

// The one frame every device window shares: the effects, the instruments
// (Drum Rack, synth) and the Keys window. A dark panel in either theme
// (.device-skin), a title row (the device's mark, its name, the track it's
// on, its own tools, then bypass and close), Escape to close, and focus
// kept inside while it's open. The Keys window floats instead (`floating`):
// no backdrop, dragged by its title row, and the studio stays usable.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Power, X } from "lucide-react";
import { fraunces, spaceGrotesk } from "./pluginFonts";
import { withKeys } from "./keyLabel";
import { useShortcuts } from "./shortcuts";

/** The frame's colors. A device's own controls keep theirs. */
export const DEVICE = {
  bg: "#1B1C22",
  raised: "#23242B",
  border: "#2E2F37",
  text: "#F4EDE2",
  muted: "#9A9AA4",
  off: "#5A5B64",
  accent: "#E6AD5E",
};

const PADDING = "18px 22px 20px";

/** The close button's tooltip, with its key. */
export const CLOSE_TITLE = withKeys("Close", "escape");

type FloatingOptions = {
  /** Shown or hidden: a floating window stays mounted while closed. */
  open: boolean;
  /** Where its position is remembered (localStorage). */
  posKey: string;
};

export function DeviceWindow({
  title,
  heading,
  subtitle,
  mark,
  tools,
  actions,
  bypass,
  onClose,
  width,
  fit,
  gap = 16,
  background = DEVICE.bg,
  panelRef,
  onPanelKeyDown,
  onPanelClick,
  onBackdropPointerDown,
  floating,
  children,
}: {
  /** The device's name: the heading, and the window's name with `subtitle`. */
  title: string;
  /** Drawn in place of the plain heading (the synth's gradient). */
  heading?: ReactNode;
  /** The track, bus or master the device is on. */
  subtitle?: string;
  /** The device's mark, before its name. */
  mark?: ReactNode;
  /** After the name: presets, kits, tabs. */
  tools?: ReactNode;
  /** On the right, before bypass and close: readouts, a volume knob. */
  actions?: ReactNode;
  /** Effects can be bypassed from the title row. */
  bypass?: { on: boolean; toggle: () => void };
  onClose: () => void;
  width?: number | string;
  /** A fixed-size window (the synth) shrinks to fit small screens. */
  fit?: { width: number; height: number };
  /** Space between the title row and what follows, and between those. */
  gap?: number;
  /** A device with its own colors (the synth's night blue) sets its panel's. */
  background?: string;
  panelRef?: React.RefObject<HTMLDivElement | null>;
  onPanelKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onPanelClick?: () => void;
  onBackdropPointerDown?: () => void;
  floating?: FloatingOptions;
  children: ReactNode;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? ownRef;
  const name = subtitle ? `${title} — ${subtitle}` : title;
  const modal = !floating;
  const scale = useFitScale(fit);

  // Escape closes a modal window (not while typing in one of its fields; a
  // menu open in it closes first). The floating Keys window leaves Escape
  // to the studio, since it stays open while you work.
  useShortcuts("window", [{ keys: "escape", label: "Close", run: onClose }], { enabled: modal });

  // Focus goes into a modal window when it opens, unless something in it
  // took it already, and back to where it was when it closes.
  useEffect(() => {
    if (!modal) return;
    const before = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    return () => {
      if (before?.isConnected && before !== document.body) before.focus({ preventScroll: true });
    };
  }, [modal, ref]);

  const keyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    onPanelKeyDown?.(e);
    if (modal && !e.defaultPrevented && e.key === "Tab") trapTab(e, ref.current);
  };

  const drag = useDrag(ref, floating);

  const header = (
    <div
      className={`flex min-h-[30px] shrink-0 items-center gap-3 ${floating ? "cursor-grab touch-none select-none active:cursor-grabbing" : ""}`}
      onPointerDown={floating ? drag.start : undefined}
    >
      <div className="flex min-w-0 items-center gap-2">
        {mark}
        {heading ?? (
          <h2 className={`${fraunces.className} whitespace-nowrap text-[19px] font-semibold`} style={{ color: DEVICE.text, letterSpacing: "-0.2px" }}>
            {title}
          </h2>
        )}
        {subtitle && <span className="truncate text-xs text-muted">— {subtitle}</span>}
      </div>
      {tools && <div className="ml-1 flex items-center gap-3">{tools}</div>}
      <div className="ml-auto flex items-center gap-3">
        {actions}
        <div className="flex items-center gap-1">
          {bypass && (
            <button
              type="button"
              title={bypass.on ? "Enable effect" : "Bypass effect"}
              aria-pressed={!bypass.on}
              onClick={bypass.toggle}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-lg"
              style={{ background: DEVICE.raised, border: `1px solid ${DEVICE.border}` }}
            >
              <Power size={16} color={bypass.on ? DEVICE.off : DEVICE.accent} />
            </button>
          )}
          <button
            type="button"
            title={floating ? "Close" : CLOSE_TITLE}
            aria-label={`Close ${title}`}
            onClick={onClose}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg hover:bg-white/5"
          >
            <X size={14} color={DEVICE.muted} />
          </button>
        </div>
      </div>
    </div>
  );

  const panelStyle: React.CSSProperties = { background, border: `1px solid ${DEVICE.border}`, color: DEVICE.text, padding: PADDING, gap };
  const panelClass = `${spaceGrotesk.className} device-skin flex flex-col rounded-2xl shadow-2xl outline-none`;

  if (floating) {
    return (
      <div
        ref={ref}
        role="dialog"
        aria-label={name}
        hidden={!floating.open}
        tabIndex={-1}
        onKeyDown={keyDown}
        className={`${panelClass} fixed z-40`}
        style={{
          ...panelStyle,
          width: width ?? "min(1100px, calc(100vw - 32px))",
          ...(drag.pos ? { left: drag.pos.x, top: drag.pos.y } : { left: "50%", bottom: 24, transform: "translateX(-50%)" }),
        }}
      >
        {header}
        {children}
      </div>
    );
  }

  const panel = (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      tabIndex={-1}
      onKeyDown={keyDown}
      onClick={onPanelClick}
      className={`${panelClass} max-h-full max-w-full ${fit ? "" : "overflow-auto"}`}
      style={fit ? { ...panelStyle, width: fit.width, height: fit.height, transform: `scale(${scale})`, transformOrigin: "top left" } : { ...panelStyle, width }}
    >
      {header}
      {children}
    </div>
  );

  return (
    <div
      className={`device-skin fixed inset-0 z-50 flex items-center justify-center bg-black/60 ${fit ? "" : "p-4"}`}
      onPointerDown={onBackdropPointerDown ? (e) => e.target === e.currentTarget && onBackdropPointerDown() : undefined}
    >
      {fit ? <div style={{ width: fit.width * scale, height: fit.height * scale }}>{panel}</div> : panel}
    </div>
  );
}

/** Tab and Shift+Tab go round the window's controls, not out of it. */
function trapTab(e: React.KeyboardEvent, panel: HTMLElement | null) {
  if (!panel) return;
  const items = Array.from(
    panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  ).filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0);
  if (!items.length) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const at = document.activeElement;
  if (e.shiftKey && (at === first || at === panel)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && at === last) {
    e.preventDefault();
    first.focus();
  }
}

/** How much a fixed-size window shrinks to fit the screen (1 when it fits). */
function useFitScale(fit?: { width: number; height: number }): number {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("resize", cb);
      return () => window.removeEventListener("resize", cb);
    },
    () => (fit ? Math.min(1, (window.innerWidth - 24) / fit.width, (window.innerHeight - 24) / fit.height) : 1),
    () => 1
  );
}

type Pos = { x: number; y: number };

function readPos(key: string): Pos | null {
  try {
    const p = JSON.parse(localStorage.getItem(key) ?? "null");
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch {
    return null;
  }
}

/** Keeps a window this wide on screen, with its title row reachable. */
function clampPos(p: Pos, w: number): Pos {
  return {
    x: Math.max(8, Math.min(window.innerWidth - Math.min(w, window.innerWidth - 16) - 8, p.x)),
    y: Math.max(8, Math.min(window.innerHeight - 40, p.y)),
  };
}

/** A floating window's position: centered near the bottom until it's
 * dragged, then where it was left. */
function useDrag(ref: React.RefObject<HTMLDivElement | null>, floating?: FloatingOptions) {
  const key = floating?.posKey;
  const open = !!floating?.open;
  const [pos, setPos] = useState<Pos | null>(() => (key ? readPos(key) : null));

  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      const el = ref.current;
      if (el && pos) setPos(clampPos(pos, el.offsetWidth));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, pos, ref]);

  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, select, [role=slider]")) return;
    const el = ref.current;
    if (!el || !key) return;
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that's already gone: the drag still follows the events.
    }
    let last: Pos = { x: rect.left, y: rect.top };
    const onMove = (ev: PointerEvent) => {
      last = clampPos({ x: ev.clientX - dx, y: ev.clientY - dy }, rect.width);
      setPos(last);
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      try {
        localStorage.setItem(key, JSON.stringify(last));
      } catch {
        // Not remembered in a private window.
      }
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  return { pos, start };
}
