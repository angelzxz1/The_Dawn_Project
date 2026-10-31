// Finding things: the command palette (Ctrl+K) and the `?` cheat sheet,
// each listing what works where you are.

import { test, expect } from "./fixtures";

test.beforeEach(async ({ studio }) => {
  await studio.open("Beat");
});

test("the command palette runs a command found by name", async ({ page, studio }) => {
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("audio track");
  await page.keyboard.press("Enter");
  await expect(palette).toHaveCount(0);
  await expect(studio.trackNames).toHaveText(["808 Drums", "Bass", "Pad", "Lead", "Audio 1"]);

  // It runs a shortcut's command too: Undo takes the track back.
  await page.keyboard.press("Control+k");
  await page.keyboard.type("undo");
  await page.keyboard.press("Enter");
  await expect(studio.trackNames).toHaveText(["808 Drums", "Bass", "Pad", "Lead"]);
});

test("a command with nothing to act on says so", async ({ page }) => {
  await page.keyboard.press("Control+k");
  await page.keyboard.type("delete the selected clips");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Nothing to delete the selected clips right now")).toBeVisible();
});

test("? lists the shortcuts; Esc closes it; the Help menu opens both", async ({ page }) => {
  await page.keyboard.press("Shift+?");
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(sheet.getByRole("region", { name: "Arrangement" })).toContainText("Undo");
  await expect(sheet.getByRole("region", { name: "Anywhere" })).toContainText("Save");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: /Find a command/ }).click();
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: /Keyboard shortcuts/ }).click();
  await expect(sheet).toBeVisible();
});
