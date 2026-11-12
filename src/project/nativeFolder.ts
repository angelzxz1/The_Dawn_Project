// A project folder in the desktop app: a folder on disk, read and written
// by the app (src-tauri/src/files.rs) and shaped like the File System
// Access API's folder handle, so projectFiles.ts saves and opens it the
// same way. Picked with the system's folder dialog, it works on macOS and
// Linux too, and never asks for permission again.

import { nativeFiles } from "@/services/files";

/** A file's type from its name, as a browser gives it (projectFiles.ts
 * names samples by their type, so a reopened project keeps their names). */
const TYPES: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  m4a: "audio/mp4",
  webm: "audio/webm",
  json: "application/json",
};

export function typeForFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : (TYPES[name.slice(dot + 1).toLowerCase()] ?? "");
}

function separator(path: string): string {
  return path.includes("\\") ? "\\" : "/";
}

function join(folder: string, name: string): string {
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) throw new TypeError(`"${name}" isn't a name in a folder.`);
  const sep = separator(folder);
  return folder.endsWith(sep) ? folder + name : folder + sep + name;
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function notFound(name: string): DOMException {
  return new DOMException(`"${name}" isn't there.`, "NotFoundError");
}

class NativeFile {
  readonly kind = "file" as const;
  constructor(
    readonly nativePath: string,
    readonly name: string
  ) {}

  async getFile(): Promise<File> {
    const bytes = await nativeFiles.read(this.nativePath);
    return new File([bytes], this.name, { type: typeForFileName(this.name) });
  }

  /** Written whole when closed (files.rs puts it in place in one go). */
  async createWritable() {
    const parts: (Blob | string)[] = [];
    return {
      write: async (data: Blob | string) => void parts.push(data),
      close: () => nativeFiles.write(this.nativePath, new Blob(parts)),
    };
  }
}

export class NativeFolder {
  readonly kind = "directory" as const;
  readonly name: string;

  constructor(readonly nativePath: string) {
    this.name = baseName(nativePath);
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<NativeFolder> {
    const path = join(this.nativePath, name);
    const kind = await nativeFiles.kind(path);
    if (kind === "file") throw new DOMException(`"${name}" is a file.`, "TypeMismatchError");
    if (!kind) {
      if (!options?.create) throw notFound(name);
      await nativeFiles.makeFolder(path);
    }
    return new NativeFolder(path);
  }

  /** A file in it; with `create`, one that's written when its writable
   * closes. */
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<NativeFile> {
    const path = join(this.nativePath, name);
    const kind = await nativeFiles.kind(path);
    if (kind === "folder") throw new DOMException(`"${name}" is a folder.`, "TypeMismatchError");
    if (!kind && !options?.create) throw notFound(name);
    return new NativeFile(path, name);
  }

  removeEntry(name: string): Promise<void> {
    return nativeFiles.remove(join(this.nativePath, name));
  }

  async *keys(): AsyncIterable<string> {
    for (const entry of await nativeFiles.list(this.nativePath)) yield entry.name;
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    if (!(other instanceof NativeFolder)) return false;
    // Windows' paths don't care about case.
    const windows = separator(this.nativePath) === "\\";
    const a = windows ? this.nativePath.toLowerCase() : this.nativePath;
    const b = windows ? other.nativePath.toLowerCase() : other.nativePath;
    return a.replace(/[\\/]+$/, "") === b.replace(/[\\/]+$/, "");
  }
}

/** A folder as IndexedDB gave it back: a NativeFolder comes back as a
 * plain object (its path), so it's made one again. */
export function revive<T>(folder: T): T | NativeFolder {
  if (folder && typeof folder === "object" && !(folder instanceof NativeFolder) && "nativePath" in folder && typeof folder.nativePath === "string") {
    return new NativeFolder(folder.nativePath);
  }
  return folder;
}
