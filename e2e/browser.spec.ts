// The left browser: hearing effects, presets and cabinets before adding
// them (checked by ear, speakers.ts), adding a cabinet, and the favorites
// and recent items it keeps.

import { test as base, expect } from "./fixtures";
import { listen, wireSpeakers, type Ear } from "./speakers";
import { FACTORY_CAB_TONES } from "../src/library/tones";

/** An empty project, listened to. */
const test = base.extend<{ ear: Ear }>({
  ear: async ({ page, studio }, use) => {
    await wireSpeakers(page);
    await studio.open("Empty Project");
    // Play once so the audio is running, then listen.
    await page.keyboard.press("Space");
    await expect(page.getByTitle("Pause (Space)")).toBeVisible();
    await page.keyboard.press("Space");
    await use(await listen(page));
  },
});

test("an effect, and a cabinet, can be heard before they're added", async ({ page, ear }) => {
  const heardSince = async (from: number) => (await ear.clicks(from)).length;

  let from = await ear.now();
  await page.getByRole("button", { name: "Preview Compressor", exact: true }).click();
  await expect.poll(() => heardSince(from), { timeout: 10_000 }).toBeGreaterThanOrEqual(4);
  await page.getByRole("button", { name: "Stop Compressor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Preview Compressor", exact: true })).toBeVisible();

  const cab = FACTORY_CAB_TONES[0];
  await page.getByRole("button", { name: "Show IR Loader presets" }).click();
  from = await ear.now();
  await page.getByRole("button", { name: `Preview ${cab.name}`, exact: true }).click();
  // The riff rings on without a gap, so it's heard as one sound.
  await expect.poll(() => heardSince(from), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  // Nothing was added by hearing it.
  await expect(page.locator('button[title="Expand"]')).toHaveCount(0);
});

test("a cabinet clicked in the browser adds an IR Loader with it loaded, and shows under Recent", async ({ page, studio }) => {
  const cab = FACTORY_CAB_TONES[1];
  await studio.open("Empty Project");
  await studio.select("Audio 1");
  await page.getByRole("button", { name: "Show IR Loader presets" }).click();
  await page.getByText(cab.name, { exact: true }).click();
  await expect(page.locator('button[title="Expand"]')).toHaveCount(1);
  await expect(page.getByText(cab.name).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Recent" })).toContainText(cab.name);
});

test("favorites stay starred after a reload", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await page.getByRole("button", { name: "Star Reverb", exact: true }).click();
  await expect(page.getByRole("region", { name: "Favorites" })).toContainText("Reverb");
  await page.getByRole("tab", { name: "Grooves" }).click();
  await page.getByRole("button", { name: /^Star / }).first().click();
  await expect(page.getByRole("region", { name: "Favorites" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("region", { name: "Favorites" })).toContainText("Reverb");
});
