import { beforeEach, describe, expect, it } from "vitest";
import { defaultParams } from "./registry";
import { deleteUserChain, findChain, resetUserChainCache, saveUserChain, userChains } from "./userChains";

const store = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis.window ?? { addEventListener: () => {} },
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
});

beforeEach(() => {
  store.clear();
  resetUserChainCache();
});

describe("your own chains", () => {
  it("keep each effect's settings, bypass and factory cabinet, not a file of yours", () => {
    const chain = saveUserChain("  Lead vox ", [
      { id: "a", type: "gate", params: { ...defaultParams("gate"), threshold: -42 }, bypass: false },
      { id: "b", type: "irLoader", params: defaultParams("irLoader"), bypass: true, file: { id: "factory-ir:4x12-closed", name: "4x12" } },
      { id: "c", type: "irLoader", params: defaultParams("irLoader"), bypass: false, file: { id: "file-mine", name: "Mine" } },
    ])!;
    expect(chain.name).toBe("Lead vox");
    expect(chain.description).toBe("Noise Gate → IR Loader → IR Loader");
    resetUserChainCache();
    const saved = findChain(chain.id)!;
    expect(saved.steps[0].params?.threshold).toBe(-42);
    expect(saved.steps[1]).toMatchObject({ bypass: true, file: { id: "factory-ir:4x12-closed" } });
    expect(saved.steps[2].file).toBeUndefined();
  });

  it("the same name replaces the chain; deleting forgets it", () => {
    const first = saveUserChain("Drums", [{ id: "a", type: "gate", params: {}, bypass: false }])!;
    const second = saveUserChain("drums", [{ id: "a", type: "reverb", params: {}, bypass: false }])!;
    expect(second.id).toBe(first.id);
    expect(userChains().map((c) => c.steps[0].type)).toEqual(["reverb"]);
    expect(saveUserChain("Empty", [])).toBeNull();
    deleteUserChain(first.id);
    expect(userChains()).toEqual([]);
  });

  it("drop what they can't use when read back", () => {
    store.set("dawn-effect-chains-v1", JSON.stringify([{ id: "user-chain:x", name: "X", steps: [{ type: "nope" }, { type: "gate", params: { threshold: -999, bogus: 1 } }] }, { id: "bad" }]));
    const [chain] = userChains();
    expect(userChains()).toHaveLength(1);
    expect(chain.steps).toHaveLength(1);
    expect(Object.keys(chain.steps[0].params!)).toEqual(["threshold"]);
  });
});
