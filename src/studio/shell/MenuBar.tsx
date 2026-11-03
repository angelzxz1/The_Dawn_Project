"use client";

// The studio's menu bar, as a desktop DAW has it: File, Edit, View,
// Options, Help across the top, each a list of commands with their keys.
// Click a menu to open it; while one is open, pointing at another opens
// that one. The arrows move through the items and between the menus,
// Enter picks, Escape closes. The studio's own keys (Space...) wait while
// a menu is open; the ones that work anywhere (Save) don't.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";
import { useShortcuts } from "@/ui/shortcuts";

export type MenuEntry =
  | {
      kind?: "item";
      label: string;
      /** The key, as shown ("Ctrl+S"). */
      shortcut?: string;
      onSelect: () => void;
      disabled?: boolean;
      /** A setting that's on or off: a check when on. */
      checked?: boolean;
      /** What it does, on hover. */
      title?: string;
    }
  /** A page on the website, in a new tab. */
  | { kind: "link"; label: string; href: string }
  | { kind: "separator" }
  /** A label over the items after it ("Recent"). */
  | { kind: "heading"; label: string }
  /** A line of explanation at the end of a menu. */
  | { kind: "note"; text: ReactNode };

export interface Menu {
  label: string;
  entries: MenuEntry[];
  /** It's opening (to fetch what it lists, like recent projects). */
  onOpen?: () => void;
}

const ITEM = "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] outline-none hover:bg-surface focus-visible:bg-surface disabled:opacity-40 disabled:hover:bg-transparent";

/** The menu's items that take focus, in order. */
function items(menu: HTMLElement | null): HTMLElement[] {
  return menu ? [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])')] : [];
}

export function MenuBar({ menus, start, end }: { menus: Menu[]; start?: ReactNode; end?: ReactNode }) {
  const [open, setOpen] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const titles = useRef<(HTMLButtonElement | null)[]>([]);
  /** Opened from the keyboard: its first item takes focus. */
  const focusFirst = useRef(false);

  useEffect(() => {
    if (open === null) return;
    if (focusFirst.current) {
      focusFirst.current = false;
      items(list.current)[0]?.focus();
    }
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = (refocus: boolean) => {
    if (refocus && open !== null) titles.current[open]?.focus();
    setOpen(null);
  };
  const openMenu = (i: number, fromKeys: boolean) => {
    const at = (i + menus.length) % menus.length;
    focusFirst.current = fromKeys;
    menus[at].onOpen?.();
    setOpen(at);
  };

  useShortcuts("menu", [], {
    enabled: open !== null,
    onKeyDown: (e) => {
      if (open === null) return false;
      // Save, Undo... still work with a menu open.
      if (e.ctrlKey || e.metaKey) return false;
      const here = items(list.current);
      const at = here.indexOf(document.activeElement as HTMLElement);
      /** The next item down (or up), round the ends; from none, the first (or last). */
      const move = (by: 1 | -1) => here[at < 0 ? (by > 0 ? 0 : here.length - 1) : (at + by + here.length) % here.length]?.focus();
      switch (e.key) {
        case "Escape":
          close(true);
          break;
        case "ArrowDown":
          move(1);
          break;
        case "ArrowUp":
          move(-1);
          break;
        case "Home":
          here[0]?.focus();
          break;
        case "End":
          here[here.length - 1]?.focus();
          break;
        case "ArrowRight":
          openMenu(open + 1, true);
          break;
        case "ArrowLeft":
          openMenu(open - 1, true);
          break;
        case "Enter":
        case " ":
          if (at >= 0) here[at].click();
          break;
        case "Tab":
          setOpen(null);
          return false;
        default:
          break;
      }
      e.preventDefault();
      return true;
    },
  });

  const pick = (run: () => void) => {
    setOpen(null);
    run();
  };

  const menu = open === null ? null : menus[open];
  return (
    <div ref={root} className="relative flex h-8 shrink-0 items-center gap-1 border-b border-border bg-surface px-1.5 text-[12px]">
      {start}
      <div role="menubar" aria-label="Menu" className="flex items-center">
        {menus.map((m, i) => (
          <div key={m.label} className="relative">
            <button
              ref={(el) => {
                titles.current[i] = el;
              }}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open === i}
              onClick={() => (open === i ? setOpen(null) : openMenu(i, false))}
              onPointerEnter={() => open !== null && open !== i && openMenu(i, false)}
              onKeyDown={(e) => {
                if (open === null && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  openMenu(i, true);
                }
              }}
              className={`rounded px-2 py-1 outline-none hover:bg-surface-raised focus-visible:ring-1 focus-visible:ring-accent ${
                open === i ? "bg-surface-raised text-foreground" : "text-foreground/85"
              }`}
            >
              {m.label}
            </button>
            {open === i && menu && (
              <div
                ref={list}
                role="menu"
                aria-label={m.label}
                className="absolute left-0 top-full z-[60] mt-0.5 flex w-64 flex-col rounded-lg border border-border bg-surface-raised p-1 shadow-2xl"
              >
                {menu.entries.map((entry, k) => {
                  switch (entry.kind) {
                    case "separator":
                      return <div key={k} role="separator" className="my-1 border-t border-border" />;
                    case "heading":
                      return (
                        <div key={k} className="flex items-center gap-1 px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          <ChevronRight size={10} /> {entry.label}
                        </div>
                      );
                    case "note":
                      return (
                        <p key={k} className="px-2 pb-1 pt-1.5 text-[10.5px] leading-snug text-muted">
                          {entry.text}
                        </p>
                      );
                    case "link":
                      return (
                        <a key={k} role="menuitem" href={entry.href} target="_blank" rel="noreferrer" className={ITEM} onClick={() => setOpen(null)}>
                          <span className="w-3.5 shrink-0" />
                          <span className="flex-1">{entry.label}</span>
                        </a>
                      );
                    default:
                      return (
                        <button
                          key={k}
                          type="button"
                          role={entry.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                          aria-checked={entry.checked}
                          disabled={entry.disabled}
                          title={entry.title}
                          onClick={() => pick(entry.onSelect)}
                          className={ITEM}
                        >
                          <span className="flex w-3.5 shrink-0 justify-center text-accent">{entry.checked && <Check size={12} />}</span>
                          <span className="flex-1 truncate">{entry.label}</span>
                          {entry.shortcut && <kbd className="font-sans text-[10.5px] text-muted">{entry.shortcut}</kbd>}
                        </button>
                      );
                  }
                })}
              </div>
            )}
          </div>
        ))}
      </div>
      {end}
    </div>
  );
}
