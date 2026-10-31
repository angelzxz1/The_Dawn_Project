"use client";

import { useState } from "react";
import { Keyboard, X } from "lucide-react";
import { useShortcuts, type ActiveShortcut } from "@/ui/shortcuts";
import { searchCommands, sheetGroups } from "@/ui/commandSearch";
import { keyLabel } from "@/ui/keyLabel";

/** The `?` cheat sheet: every keyboard shortcut that works where you are,
 * grouped by where it works (the piano roll's first when it's open). */
export function ShortcutSheet({ available, onClose }: { available: ActiveShortcut[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const groups = sheetGroups(searchCommands(available, query));

  useShortcuts("dialog", [{ keys: "escape", label: "Close", run: onClose, whileTyping: true }]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Keyboard shortcuts" className="flex max-h-full w-[720px] max-w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Keyboard size={15} className="text-accent" />
          <h2 className="flex-1 text-sm font-semibold">Keyboard shortcuts</h2>
          <input
            aria-label="Find a shortcut"
            placeholder="Find…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-44 rounded border border-border bg-surface px-2 py-1 text-[12px] outline-none focus:border-accent"
          />
          <button type="button" title="Close" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded border border-border hover:bg-surface">
            <X size={13} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 sm:columns-2 sm:gap-8">
          {groups.map((group) => (
            <section key={group.layer} aria-label={group.name} className="mb-4 break-inside-avoid">
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">{group.name}</h3>
              <dl className="flex flex-col gap-1">
                {group.shortcuts.map((s) => (
                  <div key={`${s.label}|${s.keys.join(",")}`} className="flex items-baseline justify-between gap-3 text-[12px]">
                    <dt className="min-w-0 text-foreground/90">{s.label}</dt>
                    <dd className="flex shrink-0 flex-wrap justify-end gap-1">
                      {s.keys.map((k) => (
                        <kbd key={k} className="rounded border border-border bg-surface px-1.5 py-px font-sans text-[11px] text-foreground">
                          {keyLabel(k)}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          {groups.length === 0 && <p className="text-[12px] text-muted">No shortcut called that here.</p>}
        </div>
        <div className="border-t border-border px-5 py-2 text-[10.5px] text-muted">
          {keyLabel("mod+k")} finds any command, with or without a shortcut. Letters and numbers alone play notes on an armed MIDI track.
        </div>
      </div>
    </div>
  );
}
