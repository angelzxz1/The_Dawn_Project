// The browser's Effects tab on its own: previewing an effect, a preset or a
// cabinet before adding it, adding a cabinet, and the favorites and recent
// items it keeps.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { EffectBrowser } from "./EffectBrowser";
import { EFFECT_LABELS } from "@/effects/registry";
import { FACTORY_PRESETS } from "@/effects/presets";
import { FACTORY_CAB_TONES } from "@/library/tones";
import { noteUsed, pickKey, resetPicks } from "@/library/browserPicks";

beforeEach(() => resetPicks());

const REVERB = EFFECT_LABELS.reverb;
const reverbPreset = FACTORY_PRESETS.find((p) => p.type === "reverb")!;

function renderBrowser() {
  const props = {
    onAddEffect: vi.fn(),
    onPreviewEffect: vi.fn(() => Promise.resolve(3)),
    onPreviewTone: vi.fn(() => Promise.resolve(3)),
    onStopPreview: vi.fn(),
    onAddTone: vi.fn(),
  };
  return { screen: render(<EffectBrowser {...props} />), ...props };
}

describe("previews", () => {
  test("an effect and a preset play before they're added; pressing again stops", async () => {
    const { screen, onPreviewEffect, onStopPreview, onAddEffect } = renderBrowser();
    await screen.getByRole("button", { name: `Preview ${REVERB}`, exact: true }).click();
    expect(onPreviewEffect).toHaveBeenCalledWith("reverb", undefined);
    await screen.getByRole("button", { name: `Stop ${REVERB}`, exact: true }).click();
    expect(onStopPreview).toHaveBeenCalled();

    await screen.getByRole("button", { name: `Show ${REVERB} presets` }).click();
    await screen.getByRole("button", { name: `Preview ${reverbPreset.name}`, exact: true }).click();
    expect(onPreviewEffect).toHaveBeenLastCalledWith("reverb", reverbPreset.id);
    expect(onAddEffect).not.toHaveBeenCalled();
  });

  test("the Tuner has nothing to hear, so no preview", async () => {
    const { screen } = renderBrowser();
    await expect.element(screen.getByText(EFFECT_LABELS.tuner, { exact: true })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: `Preview ${EFFECT_LABELS.tuner}` })).not.toBeInTheDocument();
  });

  test("the IR Loader lists Dawn's cabinets, to hear and to add", async () => {
    const { screen, onPreviewTone, onAddTone } = renderBrowser();
    const cab = FACTORY_CAB_TONES[0];
    await screen.getByRole("button", { name: `Show ${EFFECT_LABELS.irLoader} presets` }).click();
    await screen.getByRole("button", { name: `Preview ${cab.name}`, exact: true }).click();
    expect(onPreviewTone).toHaveBeenCalledWith(cab);
    await screen.getByText(cab.name, { exact: true }).click();
    expect(onAddTone).toHaveBeenCalledWith(cab);
  });
});

describe("favorites and recent items", () => {
  test("a starred effect shows under Favorites, and can be unstarred there", async () => {
    const { screen, onAddEffect } = renderBrowser();
    await expect.element(screen.getByRole("region", { name: "Favorites" })).not.toBeInTheDocument();
    await screen.getByRole("button", { name: `Star ${REVERB}` }).click();
    const favorites = screen.getByRole("region", { name: "Favorites" });
    await expect.element(favorites).toHaveTextContent(REVERB);
    await favorites.getByText(REVERB).click();
    expect(onAddEffect).toHaveBeenCalledWith("reverb");
    await favorites.getByRole("button", { name: `Unstar ${REVERB}` }).click();
    await expect.element(favorites).not.toBeInTheDocument();
  });

  test("what was added last shows under Recent, a preset with its effect's name", async () => {
    noteUsed(pickKey("preset", reverbPreset.id));
    noteUsed(pickKey("effect", "delay"));
    noteUsed("preset:gone");
    const { screen } = renderBrowser();
    const recent = screen.getByRole("region", { name: "Recent" });
    await expect.element(recent).toHaveTextContent(`${EFFECT_LABELS.delay}${REVERB}: ${reverbPreset.name}`);
  });
});
