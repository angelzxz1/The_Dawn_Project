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
    removeEffect: (host: string, id: string) => engine.calls.push(`remove ${id} from ${host}`),
    setEffectFile: (_host: string, id: string, file: string | null) => {
      engine.calls.push(`file ${id} ${file}`);
      return Promise.resolve(null);
    },
  },
}));

import { effectActions } from "./effectActions";
import { copyEffects } from "./effectClipboard";
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
  projectStore.load(
    { ...doc, channels: [{ ...doc.channels[0], id: "vox" }, { ...doc.channels[0], id: "kick" }], channelEffects: { vox: [compressor, eq], kick: [] } },
    [],
    []
  );
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

  it("moves effects to another track, in their order, as one undo step", () => {
    projectStore.set("channelEffects", (prev) => ({ ...prev, kick: [{ id: "fx-k", type: "gate", params: {}, bypass: false }] }));
    expect(effectActions.transfer("vox", ["fx-b", "fx-a"], "kick", 0)).toBe(2);
    const { vox, kick } = projectStore.get().channelEffects;
    expect(vox).toEqual([]);
    expect(kick.map((e) => e.type)).toEqual(["compressor", "eq3", "gate"]);
    // Its sidechain listened to the kick: on the kick it can't.
    expect(kick[0].sidechain).toBeUndefined();
    expect(kick[0].params).toEqual(compressor.params);
    expect(engine.calls).toContain("remove fx-a from vox");

    projectStore.undo();
    expect(projectStore.get().channelEffects.vox.map((e) => e.id)).toEqual(["fx-a", "fx-b"]);
    expect(projectStore.get().channelEffects.kick.map((e) => e.id)).toEqual(["fx-k"]);
  });

  it("copies effects to another track, leaving them where they were", () => {
    projectStore.set("channelEffects", (prev) => ({ ...prev, kick: [] }));
    effectActions.transfer("vox", ["fx-a"], "master", undefined, true);
    expect(projectStore.get().channelEffects.vox).toHaveLength(2);
    expect(projectStore.get().masterEffects.at(-1)).toEqual({ ...compressor, id: expect.stringMatching(/^fx-new-/) });
    expect(engine.calls).not.toContain("remove fx-a from vox");
  });

  it("moving onto its own chain does nothing (that's reordering)", () => {
    expect(effectActions.transfer("vox", ["fx-a"], "vox")).toBe(0);
    expect(engine.calls).toEqual([]);
  });

  it("pastes what was copied, where it's asked", () => {
    copyEffects([compressor, eq]);
    expect(effectActions.paste("vox", 1)).toBe(2);
    expect(projectStore.get().channelEffects.vox.map((e) => e.type)).toEqual(["compressor", "compressor", "eq3", "eq3"]);
    expect(engine.calls.filter((c) => c.startsWith("add"))).toEqual(["add compressor at 1", "add eq3 at 2"]);
  });

  it("adds a chain where it's dropped, bypassed steps bypassed", () => {
    effectActions.addChain("vox", { id: "c", name: "C", description: "", steps: [{ type: "gate" }, { type: "reverb", bypass: true }] }, 1);
    const list = projectStore.get().channelEffects.vox;
    expect(list.map((e) => e.type)).toEqual(["compressor", "gate", "reverb", "eq3"]);
    expect(list[2].bypass).toBe(true);
    expect(engine.calls.filter((c) => c.startsWith("add"))).toEqual(["add gate at 1", "add reverb at 2"]);
  });
});
