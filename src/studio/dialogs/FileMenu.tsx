"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { RecentProject } from "@/project/projectFiles";
import { keyLabel } from "@/ui/keyLabel";
import type { Menu, MenuEntry } from "@/studio/shell/MenuBar";

/** The menu bar's File menu: New, Open, recent projects, Save, Save As,
 * exporting the song, a single project file to import or export, and the
 * sound packs. `overlays` is what it shows besides (the Save As dialog, the
 * file picker): render it with the studio. */
export function useFileMenu({
  name,
  folders,
  brave,
  busy,
  onNew,
  onOpen,
  onOpenRecent,
  listRecent,
  onSave,
  onSaveAs,
  onExportAudio,
  onImport,
  onExport,
  onPacks,
  saveAsRequest,
}: {
  name: string;
  /** Whether this browser can save to folders. */
  folders: boolean;
  /** Brave, which can save to folders once a setting is turned on. */
  brave: boolean;
  busy: boolean;
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (r: RecentProject) => void;
  listRecent: () => Promise<RecentProject[]>;
  onSave: () => void;
  onSaveAs: (name: string) => void;
  /** Exports the song as audio (WAV, MP3, stems). */
  onExportAudio: () => void;
  onImport: (file: File) => void;
  onExport: () => void;
  /** Opens the sound packs window. */
  onPacks?: () => void;
  /** Bumped to open the Save As dialog from outside (a shortcut). */
  saveAsRequest: number;
}): { menu: Menu; overlays: ReactNode } {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [asking, setAsking] = useState(false);
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null);
  const lastRequest = useRef(saveAsRequest);
  useEffect(() => {
    if (saveAsRequest === lastRequest.current) return;
    lastRequest.current = saveAsRequest;
    // Opening a dialog in answer to a shortcut.
    setAsking(true);
  }, [saveAsRequest]);

  const item = (label: string, onSelect: () => void, shortcut?: string): MenuEntry => ({ label, onSelect, shortcut, disabled: busy });
  const entries: MenuEntry[] = [
    item("New Project", onNew),
    item(folders ? "Open Project…" : "Open Project File…", folders ? onOpen : () => fileInput?.click(), keyLabel("mod+o")),
    ...(folders && recent.length > 0
      ? [
          { kind: "heading", label: "Recent" } as const,
          ...recent.map((r) => ({ ...item(r.name, () => onOpenRecent(r)), title: `Folder: ${r.folder.name}` })),
        ]
      : []),
    { kind: "separator" },
    item("Save", onSave, keyLabel("mod+s")),
    item("Save As…", () => setAsking(true), keyLabel("mod+shift+s")),
    { kind: "separator" },
    item("Export Audio…", onExportAudio),
    item("Export Project File…", onExport),
    item("Import Project File…", () => fileInput?.click()),
    ...(onPacks ? [{ kind: "separator" } as const, item("Sound Packs…", onPacks)] : []),
    {
      kind: "note",
      text: folders ? (
        "Projects are saved to a folder on your computer: the song, its samples and its undo history."
      ) : brave ? (
        <>
          Brave has saving to folders turned off, so projects are saved as one .dawnproject file. To save to folders, open{" "}
          <span className="select-all font-mono text-foreground/80">brave://flags/#file-system-access-api</span>, set it to Enabled and restart Brave.
        </>
      ) : (
        "This browser can't save to folders, so projects are saved as one .dawnproject file (use Chrome or Edge for folders)."
      ),
    },
  ];

  const overlays = (
    <>
      <input
        ref={setFileInput}
        type="file"
        accept=".dawnproject,application/octet-stream"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onImport(file);
        }}
      />
      {asking && (
        <NameDialog
          initial={name === "Untitled" ? "" : name}
          folders={folders}
          onCancel={() => setAsking(false)}
          onConfirm={(n) => {
            setAsking(false);
            onSaveAs(n);
          }}
        />
      )}
    </>
  );

  return {
    menu: { label: "File", entries, onOpen: () => void (folders && listRecent().then(setRecent)) },
    overlays,
  };
}

/** The project's name in the menu bar, with a dot while there are unsaved
 * changes. */
export function ProjectName({ name, dirty, folderName }: { name: string; dirty: boolean; folderName: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        className="truncate text-[12px] font-medium text-foreground/90"
        title={folderName ? `Saved in the folder "${folderName}"${dirty ? " - unsaved changes" : ""}` : "Not saved to your computer yet"}
      >
        {name}
      </span>
      {dirty && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" title="Unsaved changes" aria-label="Unsaved changes" />}
    </span>
  );
}

function NameDialog({ initial, folders, onCancel, onConfirm }: { initial: string; folders: boolean; onCancel: () => void; onConfirm: (name: string) => void }) {
  const [value, setValue] = useState(initial);
  const clean = value.trim();
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        role="dialog"
        aria-label="Save project as"
        className="flex w-[380px] flex-col gap-3 rounded-xl border border-border bg-surface-raised p-4 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (clean) onConfirm(clean);
        }}
      >
        <h2 className="text-sm font-semibold">Save project as</h2>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="Project name"
          aria-label="Project name"
          maxLength={80}
          className="rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
        <p className="text-[11px] text-muted">
          {folders
            ? "Next, choose where to put it - a folder with this name is created there for the song, its samples and its history."
            : "It's saved as one .dawnproject file in your downloads."}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-xs text-muted hover:bg-surface">
            Cancel
          </button>
          <button type="submit" disabled={!clean} className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-40">
            {folders ? "Choose Location…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
