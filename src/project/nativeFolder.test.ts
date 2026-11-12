// The desktop app's project folders (nativeFolder.ts) and Save As
// (services/files.ts), with the app's file commands (src-tauri/src/files.rs)
// stood in for by a disk in memory: a project saves into and opens from a
// folder on disk exactly as from a browser's folder handle.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Paths to bytes; folders are the paths that end in one. */
const disk = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), folders: new Set<string>(), saveAs: null as string | null }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> | Uint8Array, options?: { headers: Record<string, string> }) => {
    const a = args as Record<string, string>;
    const parentOf = (p: string) => p.slice(0, p.lastIndexOf("\\"));
    switch (cmd) {
      case "files_kind":
        return disk.folders.has(a.path) ? "folder" : disk.files.has(a.path) ? "file" : null;
      case "files_make_folder":
        disk.folders.add(a.path);
        return;
      case "files_list":
        return [
          ...[...disk.folders].filter((p) => parentOf(p) === a.path).map((p) => ({ name: p.slice(a.path.length + 1), folder: true })),
          ...[...disk.files.keys()].filter((p) => parentOf(p) === a.path).map((p) => ({ name: p.slice(a.path.length + 1), folder: false })),
        ];
      case "files_read": {
        const bytes = disk.files.get(a.path);
        if (!bytes) throw new Error("not found");
        return bytes.slice().buffer;
      }
      case "files_write":
        disk.files.set(decodeURIComponent(options!.headers["dawn-path"]), args as Uint8Array);
        return;
      case "files_remove":
        disk.files.delete(a.path);
        return;
      case "files_save_dialog":
        return disk.saveAs;
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { NativeFolder, revive, typeForFileName } from "./nativeFolder";
import { fileNameFor, HISTORY_FILE, loadFromFolder, PROJECT_FILE, SAMPLES_DIR, saveToFolder, type ProjectFolder } from "./projectFiles";
import { normalizeProject } from "./projectSchema";
import { saveFile, kindOf } from "@/services/files";

const ROOT = "C:\\Users\\Zuñiga\\Music\\My Song";

const wav = (bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: "audio/wav" });

function doc() {
  const project = normalizeProject({ version: 1, bpm: 97, channels: [{ id: "c1", name: "Guitar" }] })!;
  return {
    name: "My Song",
    project,
    history: null,
    blobs: new Map([
      ["clip-1", wav([1, 2, 3])],
      ["clip-2", wav([4, 5, 6, 7])],
    ]),
  };
}

beforeEach(() => {
  disk.files.clear();
  disk.folders.clear();
  disk.folders.add(ROOT);
  disk.saveAs = null;
  vi.mocked(invoke).mockClear();
});

describe("a project folder on disk", () => {
  it("saves and opens a project, its samples keeping their type", async () => {
    const folder = new NativeFolder(ROOT);
    expect(folder.name).toBe("My Song");
    await saveToFolder(folder as unknown as ProjectFolder, doc());
    expect(disk.files.has(`${ROOT}\\${PROJECT_FILE}`)).toBe(true);
    expect(disk.files.has(`${ROOT}\\${HISTORY_FILE}`)).toBe(true);
    expect(disk.folders.has(`${ROOT}\\${SAMPLES_DIR}`)).toBe(true);
    expect([...disk.files.keys()].filter((p) => p.includes(SAMPLES_DIR)).sort()).toEqual([`${ROOT}\\Samples\\clip-1.wav`, `${ROOT}\\Samples\\clip-2.wav`]);

    const opened = await loadFromFolder(new NativeFolder(ROOT) as unknown as ProjectFolder);
    expect(opened.project.bpm).toBe(97);
    expect(opened.project.channels[0].name).toBe("Guitar");
    const clip = opened.blobs.get("clip-2")!;
    expect([...new Uint8Array(await clip.arrayBuffer())]).toEqual([4, 5, 6, 7]);
    // Saved again, a sample keeps its name (named by its type).
    expect(clip.type).toBe("audio/wav");
    expect(fileNameFor("clip-2", clip)).toBe("clip-2.wav");
  });

  it("removes samples nothing plays any more, and writes unchanged ones only once", async () => {
    const folder = new NativeFolder(ROOT) as unknown as ProjectFolder;
    await saveToFolder(folder, doc());
    const d = doc();
    d.blobs.delete("clip-1");
    vi.mocked(invoke).mockClear();
    await saveToFolder(folder, d);
    expect(disk.files.has(`${ROOT}\\Samples\\clip-1.wav`)).toBe(false);
    const writes = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "files_write").map(([, , o]) => decodeURIComponent((o as { headers: Record<string, string> }).headers["dawn-path"]));
    expect(writes.some((p) => p.includes(SAMPLES_DIR))).toBe(false);
  });

  it("says what isn't there the way a browser's folder does", async () => {
    const folder = new NativeFolder(ROOT);
    await expect(folder.getFileHandle(PROJECT_FILE)).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(folder.getDirectoryHandle(SAMPLES_DIR)).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(folder.getFileHandle("..\\elsewhere.txt")).rejects.toThrow(TypeError);
    await expect(folder.getFileHandle("..")).rejects.toThrow(TypeError);
  });

  it("is the same folder whatever the case of its path on Windows, and comes back from IndexedDB", async () => {
    const folder = new NativeFolder(ROOT);
    expect(await folder.isSameEntry(new NativeFolder(ROOT.toUpperCase() + "\\"))).toBe(true);
    expect(await folder.isSameEntry(new NativeFolder(`${ROOT} 2`))).toBe(false);
    expect(await new NativeFolder("/home/a/Song").isSameEntry(new NativeFolder("/home/a/song"))).toBe(false);
    // IndexedDB keeps a copy without its methods.
    const stored = structuredClone(folder);
    expect(stored).not.toBeInstanceOf(NativeFolder);
    const back = revive(stored);
    expect(back).toBeInstanceOf(NativeFolder);
    expect((back as NativeFolder).nativePath).toBe(ROOT);
    // A browser's handle is left as it is.
    const handle = { kind: "directory", name: "x" };
    expect(revive(handle)).toBe(handle);
  });

  it("gives files their type by name", () => {
    expect(typeForFileName("a.WAV")).toBe("audio/wav");
    expect(typeForFileName("a.mp3")).toBe("audio/mpeg");
    expect(typeForFileName("history.json")).toBe("application/json");
    expect(typeForFileName("model.nam")).toBe("");
    expect(typeForFileName("noext")).toBe("");
  });
});

describe("Save As in the desktop app", () => {
  // The desktop app is the page with Tauri's bridge on it.
  beforeEach(() => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes where the dialog says, and nothing when it's cancelled", async () => {
    disk.saveAs = "D:\\Exports\\Mix.wav";
    expect(await saveFile(wav([9, 8]), "My Song.wav", "Export")).toBe(true);
    expect([...disk.files.get("D:\\Exports\\Mix.wav")!]).toEqual([9, 8]);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("files_save_dialog", { title: "Export", fileName: "My Song.wav", filterName: "WAV audio", extensions: ["wav"] });

    disk.saveAs = null;
    vi.mocked(invoke).mockClear();
    expect(await saveFile(wav([1]), "Other.wav", "Export")).toBe(false);
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "files_write")).toBe(false);
  });

  it("names the kind of file for the dialog", () => {
    expect(kindOf("My Song - Stems.zip")).toEqual({ name: "ZIP archive", extensions: ["zip"] });
    expect(kindOf("track.mid")).toEqual({ name: "MIDI file", extensions: ["mid"] });
    expect(kindOf("Presets.dawnpack")).toEqual({ name: "Dawn pack", extensions: ["dawnpack"] });
    expect(kindOf("song.aiff")).toEqual({ name: "AIFF file", extensions: ["aiff"] });
  });
});
