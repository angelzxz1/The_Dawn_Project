// A plugin effect's rack card: its plugin's name and maker, and its window,
// which opens only where the plugin can run (the native engine, CLAP).

import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

const native = vi.hoisted(() => ({
  state: { active: false, plugins: { errors: {} as Record<string, string>, windows: [] as string[] } },
  open: vi.fn(async () => {}),
}));
vi.mock("@/engine/native/nativeEngine", () => ({
  nativeEngine: {
    get current() {
      return native.state;
    },
    subscribe: () => () => {},
    openPluginWindow: native.open,
  },
}));

import { PluginRackCard } from "./PluginEffectCard";
import type { PluginRef } from "@/effects/types";

const verb: PluginRef = { format: "clap", id: "com.vendor.verb", name: "Verb", vendor: "Vendor Audio", path: "C:/Verb.clap" };

const card = (plugin: PluginRef) =>
  render(
    <PluginRackCard
      effectId="pl"
      params={{}}
      bypass={false}
      bpm={120}
      file={undefined}
      sidechainName={null}
      plugin={plugin}
      onBypassToggle={() => {}}
      onRemove={() => {}}
      onExpand={() => {}}
      onParamChange={() => {}}
      onLoadFile={async () => null}
      onClearFile={() => {}}
    />
  );

describe("a plugin effect's card", () => {
  test("names the plugin; its window opens only in the native engine", async () => {
    native.state = { active: false, plugins: { errors: {}, windows: [] } };
    const off = card(verb);
    await expect.element(off.getByText("Verb")).toBeVisible();
    await expect.element(off.getByText("Vendor Audio")).toBeVisible();
    await expect.element(off.getByRole("button", { name: "Open its window" })).toBeDisabled();
    await expect.element(off.getByRole("status")).toHaveTextContent("native engine");
    off.unmount();

    native.state = { active: true, plugins: { errors: {}, windows: [] } };
    const on = card(verb);
    await on.getByRole("button", { name: "Open its window" }).click();
    expect(native.open).toHaveBeenCalledWith("pl", "Verb");
  });

  test("says why a plugin can't run: a VST3 one, or one that didn't load", async () => {
    native.state = { active: true, plugins: { errors: { pl: "It couldn't be loaded." }, windows: [] } };
    const broken = card(verb);
    await expect.element(broken.getByRole("status")).toHaveTextContent("It couldn't be loaded.");
    broken.unmount();
    const vst3 = card({ ...verb, format: "vst3" });
    await expect.element(vst3.getByRole("status")).toHaveTextContent("only CLAP");
  });
});
