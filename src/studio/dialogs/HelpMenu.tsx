"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, CircleHelp, Compass, Keyboard, LifeBuoy, MessageSquare, Search, SlidersHorizontal, Wrench } from "lucide-react";
import { useShortcuts } from "@/ui/shortcuts";
import { keyLabel } from "@/ui/keyLabel";

/** Help in the header: the tour, the shortcuts and the command palette,
 * the guides on the website, and (when there's a Discord to send it to)
 * reporting a problem. */
export function HelpMenu({
  onTour,
  onShortcuts,
  onCommands,
  onFeedback,
}: {
  onTour: () => void;
  onShortcuts: () => void;
  onCommands: () => void;
  onFeedback?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);
  useShortcuts("menu", [{ keys: "escape", label: "Close", run: () => setOpen(false), whileTyping: true }], { enabled: open });

  const item = "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-surface";
  const links: [string, string, typeof BookOpen][] = [
    ["/how-it-works#setup", "Setup guide", BookOpen],
    ["/how-it-works#latency", "Latency, explained", Wrench],
    ["/how-it-works#troubleshooting", "Troubleshooting", LifeBuoy],
    ["/guides/daybreak", "Daybreak synth guide", SlidersHorizontal],
    ["/faq", "Questions and answers", CircleHelp],
  ];

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="The tour, setup guides and answers"
        className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-surface-raised hover:text-foreground"
      >
        <CircleHelp size={12} />
        Help
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface-raised py-1 shadow-xl">
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onTour();
            }}
          >
            <Compass size={13} className="text-accent" /> Take the tour
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onCommands();
            }}
          >
            <Search size={13} className="text-muted" /> <span className="flex-1">Find a command</span>
            <kbd className="font-sans text-[10px] text-muted">{keyLabel("mod+k")}</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onShortcuts();
            }}
          >
            <Keyboard size={13} className="text-muted" /> <span className="flex-1">Keyboard shortcuts</span>
            <kbd className="font-sans text-[10px] text-muted">?</kbd>
          </button>
          <div className="my-1 border-t border-border" />
          {links.map(([href, label, Icon]) => (
            <a key={href} role="menuitem" href={href} target="_blank" rel="noreferrer" className={item} onClick={() => setOpen(false)}>
              <Icon size={13} className="text-muted" /> {label}
            </a>
          ))}
          {onFeedback && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  setOpen(false);
                  onFeedback();
                }}
              >
                <MessageSquare size={13} className="text-muted" /> Report a problem
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
