// The effects: every one goes on a track and its window opens; presets,
// and the sidechain's loop check.

import { test, expect } from "./fixtures";
import { EFFECT_LABELS, EFFECT_TYPES, effectDefinition } from "../src/effects/registry";
import { FACTORY_CABS } from "../src/effects/ir-loader/cabIrs";

// A plugin is added from the desktop app's Plugins tab, not the browser.
for (const type of EFFECT_TYPES.filter((t) => !effectDefinition(t).hidden)) {
  const label = EFFECT_LABELS[type];
  test(`${label}: added from the browser, its window opens and closes`, async ({ page, studio }) => {
    await studio.open("Empty Project");
    await studio.select("Audio 1");
    await studio.addEffect(label);
    const close = page.getByTitle("Close (Esc)", { exact: true });
    await studio.openLastEffect();
    await expect(close).toHaveCount(1);
    await close.click();
    await expect(close).toHaveCount(0);
  });
}

test("an effect's card menu duplicates it, settings and all, and removes it", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await studio.select("Audio 1");
  await studio.addEffect("Delay");
  await studio.addEffect("Chorus");
  const handles = page.getByTitle("Drag to reorder");
  await expect(handles).toHaveCount(2);
  await handles.first().click({ button: "right" });
  await page.getByRole("button", { name: "Bypass", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Bypassed" })).toHaveCount(1);

  await handles.first().click({ button: "right" });
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(handles).toHaveCount(3);
  // The copy is right after it, bypassed too.
  await expect(page.getByRole("status").filter({ hasText: "Bypassed" })).toHaveCount(2);

  await handles.nth(1).click({ button: "right" });
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(handles).toHaveCount(2);
  await studio.undo();
  await expect(handles).toHaveCount(3);
});

test("a preset changes the multiband compressor's curve", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await studio.select("Audio 1");
  await studio.addEffect("Multiband Compressor");
  await studio.openLastEffect();
  const curve = page.locator('svg[aria-label="Transfer curve"] path').first();
  const before = await curve.getAttribute("d");
  await page.getByRole("button", { name: "Next preset" }).last().click();
  await expect(curve).not.toHaveAttribute("d", before!);
});

test("the IR loader loads one of Dawn's cabinets from its browser", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await studio.select("Audio 1");
  await studio.addEffect("IR Loader");
  await studio.openLastEffect();
  const [first, second] = FACTORY_CABS;
  await page.getByRole("button", { name: "Browse cabinets" }).click();
  await page.getByRole("button", { name: new RegExp(`^${second.name}`) }).click();
  // The list closes, and the window shows the cabinet loaded.
  await expect(page.getByRole("button", { name: new RegExp(`^${first.name}`) })).toHaveCount(0);
  await expect(page.getByText(second.name).first()).toBeVisible();
});

test("a sidechain source that would make a loop is marked, until the routing changes", async ({ page, studio }) => {
  await studio.open("Beat");
  await studio.addTrack("Audio");
  // Lead plays into Audio 1, so Audio 1 can't key a compressor on Lead.
  await studio.select("Lead");
  const output = page.locator('label:has-text("Audio to") select').first();
  await output.selectOption({ label: "Track: Audio 1" });
  await studio.addEffect("Compressor");
  await studio.openLastEffect();
  const source = page.locator('select:has(optgroup[label="Tracks"]) option', { hasText: "Audio 1" });
  await expect(source).toHaveText(/loop/);

  await output.selectOption({ index: 0 });
  await expect(source).not.toHaveText(/loop/);
});

test("the Furnace's Amp selector changes the amp, its switches and its knobs", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await studio.select("Audio 1");
  await studio.addEffect("Furnace");
  await studio.openLastEffect();
  const amp = page.getByRole("radiogroup", { name: "Amp" });
  await expect(amp.getByRole("radio", { name: "High Gain" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radiogroup", { name: "Channel mode" })).toBeVisible();

  await amp.getByRole("radio", { name: "Chime" }).click();
  await expect(amp.getByRole("radio", { name: "Chime" })).toHaveAttribute("aria-checked", "true");
  // The channel and rectifier switches are the head's; Presence is Cut.
  await expect(page.getByRole("radiogroup", { name: "Channel mode" })).toHaveCount(0);
  await expect(page.getByRole("slider", { name: /^Cut,/ }).first()).toBeVisible();
  await expect(page.getByText("2x12 Alnico Chime")).toBeVisible();
  // The rack card says which amp it is.
  await page.getByTitle("Close (Esc)", { exact: true }).click();
  await expect(page.getByText("Chime", { exact: true })).toBeVisible();
});

test("the Tremor's Voice switch shows each voice's own controls", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await studio.select("Audio 1");
  await studio.addEffect("Tremor");
  await studio.openLastEffect();
  const voice = page.getByRole("radiogroup", { name: "Voice" });
  await expect(voice.getByRole("radio", { name: "Tube" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radiogroup", { name: "Ultra Lo" })).toBeVisible();

  await voice.getByRole("radio", { name: "Grind" }).click();
  await expect(page.getByRole("radiogroup", { name: "Ultra Lo" })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Grunt" })).toBeVisible();

  await voice.getByRole("radio", { name: "Split" }).click();
  await expect(page.getByRole("radiogroup", { name: "Grunt" })).toHaveCount(0);
  await expect(page.getByRole("slider", { name: /^Low Split,/ })).toBeVisible();
  await page.getByTitle("Close (Esc)", { exact: true }).click();
  await expect(page.getByText("Split", { exact: true })).toBeVisible();
});
