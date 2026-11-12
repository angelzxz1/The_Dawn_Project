// Saving files where the user says. In the desktop app, the system's own
// Save As and folder dialogs (src-tauri/src/files.rs); in a browser, a
// download, as before.

import { invoke } from "@tauri-apps/api/core";
import { isDesktopApp } from "./desktop";

/** A kind of file, as a Save As dialog lists it ("WAV audio", ["wav"]). */
export interface FileKind {
  name: string;
  extensions: string[];
}

/** The desktop app's file commands. The studio may only use what was
 * picked in one of these dialogs (files.rs). */
export const nativeFiles = {
  /** The folder dialog. `grant`: the studio may read and write in it. */
  pickFolder: (title: string, grant: boolean) => invoke<string | null>("files_pick_folder", { title, grant }),
  saveDialog: (title: string, fileName: string, kind: FileKind) =>
    invoke<string | null>("files_save_dialog", { title, fileName, filterName: kind.name, extensions: kind.extensions }),
  list: (path: string) => invoke<{ name: string; folder: boolean }[]>("files_list", { path }),
  kind: (path: string) => invoke<"file" | "folder" | null>("files_kind", { path }),
  makeFolder: (path: string) => invoke<void>("files_make_folder", { path }),
  read: (path: string) => invoke<ArrayBuffer>("files_read", { path }),
  remove: (path: string) => invoke<void>("files_remove", { path }),
  write: async (path: string, data: Blob) =>
    invoke<void>("files_write", new Uint8Array(await data.arrayBuffer()), { headers: { "dawn-path": encodeURIComponent(path) } }),
};

const KINDS: Record<string, string> = {
  wav: "WAV audio",
  mp3: "MP3 audio",
  flac: "FLAC audio",
  ogg: "Ogg audio",
  zip: "ZIP archive",
  mid: "MIDI file",
  json: "JSON file",
  dawnproject: "Dawn project",
  dawnpack: "Dawn pack",
};

/** The kind of file a name is, by its extension. */
export function kindOf(fileName: string): FileKind {
  const dot = fileName.lastIndexOf(".");
  const ext = dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
  return { name: KINDS[ext] ?? (ext ? `${ext.toUpperCase()} file` : "File"), extensions: ext ? [ext] : [] };
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Saves `blob`: in the desktop app, where the user picks in a Save As
 * dialog (titled `title`, suggesting `fileName`); in a browser, as a
 * download. False if the dialog was cancelled. */
export async function saveFile(blob: Blob, fileName: string, title: string): Promise<boolean> {
  if (!isDesktopApp()) {
    download(blob, fileName);
    return true;
  }
  const path = await nativeFiles.saveDialog(title, fileName, kindOf(fileName));
  if (!path) return false;
  await nativeFiles.write(path, blob);
  return true;
}
