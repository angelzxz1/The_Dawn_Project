// The mixer and the piano roll in windows of their own, for a second
// screen. They're the same studio drawn into another window: what's changed
// there is the project's (and undone with it), and the main window goes on
// working beside them.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

/** Clicks `button` and returns the window it opens. */
async function popOut(page: Page, click: () => Promise<void>): Promise<Page> {
  const [popup] = await Promise.all([page.waitForEvent("popup"), click()]);
  await popup.waitForLoadState();
  return popup;
}

test("the mixer in a window of its own changes the project, takes play and undo, and comes back", async ({ page, studio }) => {
  await studio.open("Beat");
  await page.keyboard.press("F3");
  const popup = await popOut(page, () => page.getByRole("button", { name: "Pop out" }).click());
  const mixer = popup.getByRole("region", { name: "Mixer" });
  await expect(mixer).toBeVisible();
  await expect(popup).toHaveTitle(/^Mixer — /);
  // The main window shows the arrangement in its place.
  await expect(page.getByRole("region", { name: "Mixer" })).toHaveCount(0);
  await expect(studio.header("Bass")).toBeVisible();
  // With the studio's look: its stylesheets came along.
  const background = () => getComputedStyle(document.body).backgroundColor;
  expect(await popup.evaluate(background)).toBe(await page.evaluate(background));

  const fader = mixer.getByRole("slider", { name: "Bass volume" });
  const start = Number(await fader.getAttribute("aria-valuenow"));
  await fader.focus();
  await popup.keyboard.press("PageDown");
  const vol = studio.header("Bass").getByRole("slider", { name: "Vol" });
  await expect(vol).toHaveAttribute("aria-valuenow", String(start - 3));
  // Undo, pressed in the mixer's window.
  await popup.keyboard.press("Control+z");
  await expect(vol).toHaveAttribute("aria-valuenow", String(start));
  await expect(fader).toHaveAttribute("aria-valuenow", String(start));

  // The Mixer button brings its window forward rather than a second mixer.
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  await expect(page.getByRole("region", { name: "Mixer" })).toHaveCount(0);

  // Back in the main window, in place of the arrangement.
  await Promise.all([popup.waitForEvent("close"), mixer.getByRole("button", { name: "Back to the main window" }).click()]);
  await expect(page.getByRole("region", { name: "Mixer" })).toBeVisible();

  // Closing its window leaves the arrangement.
  const again = await popOut(page, () => page.getByRole("button", { name: "Pop out" }).click());
  await expect(again.getByRole("region", { name: "Mixer" })).toBeVisible();
  await again.close();
  await expect(studio.header("Bass")).toBeVisible();
  await page.keyboard.press("F3");
  await expect(page.getByRole("region", { name: "Mixer" })).toBeVisible();
});

test("the piano roll in a window of its own fills it, edits the clip, and leaves the studio free", async ({ page, studio }) => {
  await studio.open("Beat");
  await studio.clipsOn("Bass").first().dblclick({ position: { x: 30, y: 50 } });
  const docked = page.getByRole("dialog", { name: "Piano Roll — Bass" });
  await expect(docked).toBeVisible();
  const before = await docked.locator("[data-note-id]").count();
  expect(before).toBeGreaterThan(0);

  const popup = await popOut(page, () => page.getByRole("dialog", { name: "Piano Roll — Bass" }).getByRole("button", { name: "Pop out" }).click());
  const roll = popup.getByRole("dialog", { name: "Piano Roll — Bass" });
  await expect(roll).toBeVisible();
  await expect(page.getByRole("dialog", { name: /^Piano Roll/ })).toHaveCount(0);
  // Taller than the docked editor's grid (340 px).
  const grid = popup.locator("#piano-roll-grid");
  await expect.poll(async () => (await grid.boundingBox())!.height).toBeGreaterThan(400);

  // A note drawn there.
  const box = (await grid.boundingBox())!;
  await popup.mouse.move(box.x + 20, box.y + 8);
  await popup.mouse.down();
  await popup.mouse.move(box.x + 80, box.y + 8, { steps: 4 });
  await popup.mouse.up();
  await expect(roll.locator("[data-note-id]")).toHaveCount(before + 1);

  // The main window isn't held by it: its keys work.
  await page.keyboard.press("F3");
  await expect(page.getByRole("region", { name: "Mixer" })).toBeVisible();
  await page.keyboard.press("F3");

  // Back in the main window, still editing the clip - read afresh from the
  // project, so the note drawn is the clip's.
  await Promise.all([popup.waitForEvent("close"), roll.getByRole("button", { name: "Back to the main window" }).click()]);
  await expect(docked.locator("[data-note-id]")).toHaveCount(before + 1);
});

test("closing the piano roll's window stops editing the clip", async ({ page, studio }) => {
  await studio.open("Beat");
  await studio.clipsOn("Bass").first().dblclick({ position: { x: 30, y: 50 } });
  const popup = await popOut(page, () => page.getByRole("button", { name: "Pop out" }).click());
  await expect(popup.getByRole("dialog", { name: "Piano Roll — Bass" })).toBeVisible();
  await popup.close();
  await expect(page.getByRole("dialog", { name: /^Piano Roll/ })).toHaveCount(0);
  // And the next clip opens in the main window again.
  await studio.clipsOn("Bass").first().dblclick({ position: { x: 30, y: 50 } });
  await expect(page.getByRole("dialog", { name: "Piano Roll — Bass" })).toBeVisible();
});
