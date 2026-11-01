// The meters, on a tone of known level: a 1 kHz sine at -23 dBFS on an
// audio track (both sides, as a mono clip plays) is -23 LUFS by the
// standard's own reference (EBU Tech 3341, case 1), and its track meter
// peaks at -23 dB.

import { test, expect } from "./fixtures";
import { toneWav } from "./wav";

test("a -23 dBFS tone reads -23 LUFS on the master, and -23 dB on its track's meter", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await studio.header("Audio 1").locator('input[type="file"][accept="audio/*"]').setInputFiles({
    name: "tone.wav",
    mimeType: "audio/wav",
    buffer: toneWav(12, 1000, 48000, -23),
  });
  await expect(studio.clipsOn("Audio 1")).toHaveCount(1);

  await page.keyboard.press("Space");
  const meter = studio.header("Audio 1").getByRole("meter", { name: "Left level" });
  await expect.poll(async () => Number(await meter.getAttribute("aria-valuenow")), { timeout: 10_000 }).toBeGreaterThan(-24);
  expect(Number(await meter.getAttribute("aria-valuenow"))).toBeLessThan(-22);

  // The short-term needs 3 s; the integrated settles with it.
  const loudness = page.getByRole("group", { name: "Loudness" });
  const figure = (label: string) => loudness.getByTitle(new RegExp(`^${label}`)).locator("span").last();
  await expect.poll(async () => Number(await figure("Short-term").textContent()), { timeout: 15_000 }).toBeGreaterThan(-23.5);
  for (const label of ["Momentary", "Short-term", "Integrated"]) {
    const value = Number(await figure(label).textContent());
    expect(value, label).toBeGreaterThan(-23.5);
    expect(value, label).toBeLessThan(-22.5);
  }
  await page.keyboard.press("Space");
});
