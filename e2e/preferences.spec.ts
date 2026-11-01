// The Preferences window: opening it (the gear, Ctrl+,, the CPU panel),
// and a setting that reaches the studio - the count-in a new project
// starts with, which stays after a reload.

import { test, expect } from "./fixtures";

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

  // Kept after a reload, which opens the start screen.
  await page.reload();
  const pick = (template: RegExp) => page.getByRole("dialog", { name: "Start" }).getByRole("button", { name: template }).click();
  const countIn = page.getByTitle(/^Bars of audible pre-roll/);
  await pick(/^Empty Project/);
  await expect(countIn).toHaveValue("2");
  // The podcast has none, by design.
  page.on("dialog", (d) => void d.accept());
  await studio.fileMenu(/^New Project/);
  await pick(/^Podcast/);
  await expect(countIn).toHaveValue("0");
});
