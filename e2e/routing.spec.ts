// Routing you can see: hovering a track lights up where its audio goes and
// what plays into it, and a send can be taken before the fader.

import { test, expect } from "./fixtures";
import { toneWav } from "./wav";

test("hovering a track lights up its group, and hovering the group what plays into it", async ({ page, studio }) => {
  await studio.open("Podcast");
  const roleOf = (track: string) => page.getByRole("group", { name: `Track ${track}` }).getAttribute("data-route");

  await studio.name("Host").hover();
  await expect.poll(() => roleOf("Voices")).toBe("to");
  expect(await roleOf("Guest")).toBeNull();

  await studio.name("Voices").hover();
  await expect.poll(() => roleOf("Host")).toBe("from");
  expect(await roleOf("Guest")).toBe("from");
  // The group goes to the master.
  await expect(page.getByText("receives", { exact: true })).toBeVisible();

  // Off the tracks, nothing's lit.
  await page.getByRole("group", { name: "Loudness" }).hover();
  await expect.poll(() => roleOf("Host")).toBeNull();
});

test("a send taken before the fader says so on its bus, and undo takes it back", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await page.getByRole("button", { name: "+ Bus" }).click();
  await studio.select("Audio 1");
  const send = page.getByRole("group", { name: /^Send to / }).getByRole("slider");
  await send.click();
  await page.getByRole("group", { name: /^Send to / }).getByRole("textbox").fill("-6");
  await page.keyboard.press("Enter");
  const toggle = page.getByRole("button", { name: /before the fader$/ });
  await expect(toggle).toHaveText("Post");
  await toggle.click();
  await expect(toggle).toHaveText("Pre");

  await studio.name("Audio 1").hover();
  await expect(page.getByRole("group", { name: /^Bus / }).getByText("pre", { exact: true })).toBeVisible();

  await studio.undo();
  await expect(toggle).toHaveText("Post");
});

test("with the fader down, a post-fader send goes quiet and a pre-fader one doesn't", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await studio.header("Audio 1").locator('input[type="file"][accept="audio/*"]').setInputFiles({ name: "tone.wav", mimeType: "audio/wav", buffer: toneWav(12, 440) });
  await expect(studio.clipsOn("Audio 1")).toHaveCount(1);
  await page.getByRole("button", { name: "+ Bus" }).click();
  await studio.select("Audio 1");
  const sendGroup = page.getByRole("group", { name: /^Send to / });
  await sendGroup.getByRole("slider").click();
  await sendGroup.getByRole("textbox").fill("0");
  await page.keyboard.press("Enter");
  // The fader all the way down.
  const header = studio.header("Audio 1");
  await header.getByRole("slider", { name: "Vol" }).click();
  await header.getByRole("textbox").fill("-60");
  await header.getByRole("textbox").press("Enter");

  const busLevel = () => page.getByRole("group", { name: /^Bus / }).getByRole("meter", { name: "Left level" }).getAttribute("aria-valuenow").then(Number);
  await page.keyboard.press("Space");
  await page.waitForTimeout(800);
  // Post-fader: nothing reaches the bus.
  expect(await busLevel()).toBeLessThan(-50);
  await page.getByRole("button", { name: /before the fader$/ }).click();
  await expect.poll(busLevel, { timeout: 5000 }).toBeGreaterThan(-20);
  await page.keyboard.press("Space");
});
