// The project's layout: the zoom, where the arrangement is scrolled, the
// open FX rack and whether it's folded come back when the project does -
// and changing them isn't an unsaved change.

import { test, expect } from "./fixtures";

test("the layout comes back after a reload, and isn't an unsaved change", async ({ page, studio }) => {
  await studio.open("Beat");
  const lanes = page.locator("#arrangement-lanes");
  const width = () => lanes.evaluate((el) => el.scrollWidth);
  const before = await width();

  await page.getByTitle(/^Zoom in/).click();
  await page.getByTitle(/^Zoom in/).click();
  await expect.poll(width).toBeGreaterThan(before);
  const zoomed = await width();
  await lanes.evaluate((el) => (el.scrollLeft = 400));
  await studio.select("Pad");
  await page.getByTitle("Collapse the FX rack").click();
  await expect(page.getByTitle("Expand the FX rack")).toBeVisible();
  await expect(page.getByLabel("Unsaved changes")).toHaveCount(0);

  // Once the browser has kept it.
  await expect.poll(() => studio.autosavedLayout(), { timeout: 10_000 }).toMatchObject({ rackCollapsed: true, selectedTrack: expect.any(String) });
  await page.reload();
  await expect(studio.trackNames).toHaveText(["808 Drums", "Bass", "Pad", "Lead"]);

  await expect.poll(width).toBe(zoomed);
  await expect.poll(() => lanes.evaluate((el) => el.scrollLeft)).toBeGreaterThan(390);
  await expect(page.getByText("FX — Pad", { exact: true })).toBeVisible();
  await expect(page.getByTitle("Expand the FX rack")).toBeVisible();
});

test("a new project opens with the standard layout", async ({ page, studio }) => {
  await studio.open("Beat");
  const lanes = page.locator("#arrangement-lanes");
  const width = () => lanes.evaluate((el) => el.scrollWidth);
  const standard = await width();
  await page.getByTitle(/^Zoom in/).click();
  await expect.poll(width).toBeGreaterThan(standard);
  await page.getByTitle("Collapse the FX rack").click();

  page.on("dialog", (d) => void d.accept());
  await studio.fileMenu(/^New Project/);
  await page.getByRole("dialog", { name: "Start" }).getByRole("button", { name: /^Beat/ }).click();
  await expect.poll(width).toBe(standard);
  await expect(page.getByTitle("Collapse the FX rack")).toBeVisible();
});
