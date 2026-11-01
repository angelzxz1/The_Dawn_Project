// The Preferences window: opening it (the gear, Ctrl+,, the CPU panel),
// and a setting that reaches the studio - the count-in a new project
// starts with, which stays after a reload.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type { Studio } from "./studio";

/** Reloads once the browser has kept the project, so it comes back (and the
 * start screen doesn't open, as it does for a first visit). */
async function reloadKeepingTheProject(page: Page, studio: Studio) {
  await expect(page.getByText("autosaved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(studio.trackNames).toHaveText(["MIDI 1", "MIDI 2", "Audio 1"]);
  await expect(page.getByRole("dialog", { name: "Start" })).toHaveCount(0);
}

test.beforeEach(async ({ studio }) => {
  await studio.open("Empty Project");
});

test("the gear, Ctrl+, and the CPU panel open Preferences", async ({ page }) => {
  const prefs = page.getByRole("dialog", { name: "Preferences" });
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await expect(prefs.getByRole("tabpanel", { name: "Audio" })).toContainText("Delay compensation");
  await page.keyboard.press("Escape");
  await expect(prefs).toHaveCount(0);

  await page.keyboard.press("Control+,");
  await expect(prefs).toBeVisible();
  await prefs.getByRole("tab", { name: "Metronome" }).click();
  await page.keyboard.press("Escape");

  await page.getByTitle("Audio engine load and latency").click();
  await page.getByRole("button", { name: "Audio preferences…" }).click();
  await expect(prefs.getByRole("tabpanel", { name: "Audio" })).toBeVisible();
});

test("a new project starts with the count-in chosen in Preferences, unless its template has its own", async ({ page, studio }) => {
  await page.keyboard.press("Control+,");
  const prefs = page.getByRole("dialog", { name: "Preferences" });
  await prefs.getByRole("tab", { name: "Projects" }).click();
  await prefs.getByRole("combobox", { name: "Count-in for new projects" }).selectOption({ label: "2 bars" });
  await page.keyboard.press("Escape");

  // Kept after a reload (which brings back the project the browser kept).
  await reloadKeepingTheProject(page, studio);
  const countIn = page.getByTitle(/^Bars of audible pre-roll/);
  const start = async (template: RegExp) => {
    await studio.fileMenu(/^New Project/);
    await page.getByRole("dialog", { name: "Start" }).getByRole("button", { name: template }).click();
  };
  page.on("dialog", (d) => void d.accept());
  await start(/^Empty Project/);
  await expect(countIn).toHaveValue("2");
  // The podcast has none, by design.
  await start(/^Podcast/);
  await expect(countIn).toHaveValue("0");
});

test("the light theme colors the studio, stays after a reload, and leaves the effect windows dark", async ({ page, studio }) => {
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = await background();
  await page.keyboard.press("Control+,");
  const prefs = page.getByRole("dialog", { name: "Preferences" });
  await prefs.getByRole("tab", { name: "Appearance" }).click();
  await prefs.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(background).not.toBe(dark);
  await page.keyboard.press("Escape");

  // Set before the page draws, so there's no dark flash.
  await reloadKeepingTheProject(page, studio);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await studio.select("Audio 1");
  await studio.addEffect("Reverb");
  await studio.openLastEffect();
  // The window's panel, over its backdrop.
  const window = page.locator(".device-skin > .fixed > div").first();
  const panel = await window.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(panel).toBe("rgb(27, 28, 34)");

  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+,");
  await prefs.getByRole("tab", { name: "Appearance" }).click();
  await prefs.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
  await expect.poll(background).toBe(dark);
});
