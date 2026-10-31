"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { keyEventFor, useShortcuts, type ActiveShortcut } from "@/ui/shortcuts";
import { LAYER_NAMES, paletteCommands, searchCommands } from "@/ui/commandSearch";
import { keyLabel } from "@/ui/keyLabel";

interface CommandPaletteProps {
  /** What worked when it was opened (shortcuts.active(), taken before the
   * palette's own layer was there). */
  available: ActiveShortcut[];
  onClose: () => void;
  /** A command that had nothing to act on (no selection, say). */
  onNothingToDo: (label: string) => void;
}

/** "What do I want to do?": type a few words of a command, or its keys,
 * and run it with Enter. Lists what works where you are, with each one's
 * shortcut, so it also teaches them. */
export function CommandPalette({ available, onClose, onNothingToDo }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(0);
  const commands = paletteCommands(available);
  const found = searchCommands(commands, query);
  const current = Math.min(picked, Math.max(0, found.length - 1));

  useShortcuts("dialog", [{ keys: "escape", label: "Close", run: onClose, whileTyping: true }]);

  const run = (command: ActiveShortcut) => {
    onClose();
    // Once the palette is gone, so the command acts on the studio as if
    // its keys had been pressed there.
    setTimeout(() => {
      if (command.run(keyEventFor(command.keys[0] ?? "enter")) === false) onNothingToDo(command.label);
    }, 0);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Command palette" className="flex max-h-[70vh] w-[560px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search size={14} className="shrink-0 text-muted" />
          <input
            autoFocus
            role="combobox"
            aria-label="Find a command"
            aria-expanded
            aria-controls="command-palette-list"
            aria-activedescendant={found[current] ? `command-${current}` : undefined}
            placeholder="What do you want to do?"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPicked(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                setPicked((found.length + current + step) % Math.max(1, found.length));
              } else if (e.key === "Enter" && found[current]) {
                e.preventDefault();
                run(found[current]);
              }
            }}
            className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted"
          />
        </div>
        <ul id="command-palette-list" role="listbox" aria-label="Commands" className="min-h-0 flex-1 overflow-y-auto py-1">
          {found.map((command, i) => (
            <li
              key={`${command.layer}|${command.label}`}
              id={`command-${i}`}
              role="option"
              aria-selected={i === current}
              onPointerMove={() => i !== current && setPicked(i)}
              onClick={() => run(command)}
              className={`flex cursor-pointer items-center gap-3 px-3 py-1.5 text-[13px] ${i === current ? "bg-accent/15 text-foreground" : "text-foreground/90"}`}
            >
              <span className="min-w-0 flex-1 truncate">{command.label}</span>
              {command.layer !== "studio" && command.layer !== "global" && <span className="shrink-0 text-[10px] text-muted">{LAYER_NAMES[command.layer]}</span>}
              {command.keys.length > 0 && <kbd className="shrink-0 font-sans text-[11px] text-muted">{keyLabel(command.keys[0])}</kbd>}
            </li>
          ))}
          {found.length === 0 && <li className="px-3 py-3 text-[12px] text-muted">Nothing called that here.</li>}
        </ul>
        <div className="border-t border-border px-3 py-1.5 text-[10.5px] text-muted">
          ↑↓ to pick · Enter to run · Esc to close · ? lists every shortcut
        </div>
      </div>
    </div>
  );
}
