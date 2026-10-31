import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EffectInstance } from "@/effects/registry";

const engine = vi.hoisted(() => ({
  calls: [] as string[],
  next: 0,
}));
vi.mock("@/engine/audioEngine", () => ({
  audioEngine: {
    addEffect: (_host: string, type: string, _id?: string, at?: number) => {
      engine.calls.push(`add ${type} at ${at}`);
      return { id: `fx-new-${++engine.next}`, type, params: { threshold: -24, ratio: 4 }, bypass: false };
    },
    setEffectParam: (_host: string, id: string, key: string, value: number) => engine.calls.push(`param ${id} ${key}=${value}`),
    setEffectBypass: (_host: string, id: string, bypass: boolean) => engine.calls.push(`bypass ${id} ${bypass}`),
    setEffectSidechain: (_host: string, id: string) => engine.calls.push(`sidechain ${id}`),
    setEffectFile: (_host: string, id: string, file: string | null) => {
      engine.calls.push(`file ${id} ${file}`);
      return Promise.resolve(null);
    },
  },
}));

import { effectActions } from "./effectActions";
import { projectStore } from "./projectStore";

const compressor: EffectInstance = {
  id: "fx-a",
  type: "compressor",
  params: { threshold: -30, ratio: 4 },
  bypass: true,
  preset: { id: "factory:compressor:vocal", name: "Vocal" },
  sidechain: { on: true, source: "kick", tap: "postFx" },
};
const eq: EffectInstance = { id: "fx-b", type: "eq3", params: {}, bypass: false };

beforeEach(() => {
  engine.calls = [];
  const doc = projectStore.get();
  projectStore.load({ ...doc, channels: [{ ...doc.channels[0], id: "vox" }], channelEffects: { vox: [compressor, eq] } }, [], []);
});

describe("effect actions", () => {
  it("duplicates an effect right after it, settings and all, as one undo step", () => {
    effectActions.duplicate("vox", "fx-a");
    const list = projectStore.get().channelEffects.vox;
    expect(list.map((e) => e.id)).toEqual(["fx-a", "fx-new-1", "fx-b"]);
    expect(list[1]).toEqual({ ...compressor, id: "fx-new-1" });
    // The engine's copy is set up the same: only the params that differ.
    expect(engine.calls).toEqual(["add compressor at 1", "param fx-new-1 threshold=-30", "bypass fx-new-1 true", "sidechain fx-new-1"]);

    projectStore.undo();
    expect(projectStore.get().channelEffects.vox.map((e) => e.id)).toEqual(["fx-a", "fx-b"]);
  });

  it("does nothing for an effect that isn't there", () => {
    effectActions.duplicate("vox", "fx-gone");
    expect(engine.calls).toEqual([]);
    expect(projectStore.get().channelEffects.vox).toHaveLength(2);
  });
});
