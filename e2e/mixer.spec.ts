// The mixer view: a strip for every track, bus and the master, in place of
// the arrangement. It changes the same project the track headers do, and
// the project remembers which view it was left in.

import { test, expect } from "./fixtures";

test("F3 shows the mixer and back; a fader moved there is the track's, and undo takes it back", async ({ page, studio }) => {
  await studio.open("Beat");
  await page.keyboard.press("F3");
  const mixer = page.getByRole("region", { name: "Mixer" });
  await expect(mixer).toBeVisible();
  // Its four tracks, its reverb bus and the master.
  await expect(mixer.getByRole("group", { name: /^Mixer: / })).toHaveCount(6);
  await expect(studio.header("Bass")).toBeHidden();

  const fader = mixer.getByRole("slider", { name: "Bass volume" });
  const start = Number(await fader.getAttribute("aria-valuenow"));
  const level = (down: number) => String(Math.round((start - down) * 10) / 10);
  await fader.focus();
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  await expect(fader).toHaveAttribute("aria-valuenow", level(6));

  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  await expect(mixer).toBeHidden();
  await expect(studio.header("Bass").getByRole("slider", { name: "Vol" })).toHaveAttribute("aria-valuenow", level(6));

  // Each key was a step of its own.
  await page.keyboard.press("F3");
  await studio.undo();
  await expect(fader).toHaveAttribute("aria-valuenow", level(3));
  await studio.undo();
  await expect(fader).toHaveAttribute("aria-valuenow", level(0));
});

test("a bus's fader and mute, and the mixer itself, come back after a reload", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  const mixer = page.getByRole("region", { name: "Mixer" });
  await mixer.getByRole("button", { name: "Bus", exact: true }).click();
  const bus = mixer.getByRole("group", { name: "Mixer: Bus 1" });
  await bus.getByRole("slider", { name: "Bus 1 volume" }).focus();
  await page.keyboard.press("PageDown");
  await bus.getByTitle("Mute", { exact: true }).click();
  await expect(bus.getByTitle("Unmute", { exact: true })).toHaveAttribute("aria-pressed", "true");

  // Once the browser has kept them.
  await expect.poll(() => studio.autosavedLayout(), { timeout: 10_000 }).toMatchObject({ view: "mix" });
  const savedBuses = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open("dawn-project-db");
          open.onsuccess = () => {
            const get = open.result.transaction("meta").objectStore("meta").get("current");
            get.onsuccess = () => resolve(get.result?.buses ?? null);
          };
        })
    );
  await expect.poll(savedBuses, { timeout: 10_000 }).toMatchObject([{ name: "Bus 1", volume: -3, muted: true }]);
  await page.reload();
  await expect(mixer).toBeVisible();
  await expect(bus.getByRole("slider", { name: "Bus 1 volume" })).toHaveAttribute("aria-valuetext", "-3.0 dB");
  await expect(bus.getByTitle("Unmute", { exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("an insert opens its effect's window, and its light bypasses it", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await studio.select("Audio 1");
  await studio.addEffect("Chorus");
  await page.keyboard.press("F3");
  const strip = page.getByRole("group", { name: "Mixer: Audio 1" });
  await strip.getByRole("button", { name: "Chorus", exact: true }).click();
  const window = page.getByRole("dialog", { name: "Chorus — Audio 1" });
  await expect(window).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(window).toBeHidden();
  await strip.getByRole("button", { name: "Chorus on" }).click();
  await expect(strip.getByRole("button", { name: "Chorus on" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("Bypassed", { exact: true })).toBeVisible();
});
