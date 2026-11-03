// The menu bar (File, Edit, Create, View, Options, Help) and the browser
// down the left, shown or hidden from it.

import { test, expect } from "./fixtures";

test.beforeEach(async ({ studio }) => {
  await studio.open("Empty Project");
});

test("the studio has a menu bar, and no name of its own", async ({ page, studio }) => {
  const bar = page.getByRole("menubar");
  for (const menu of ["File", "Edit", "Create", "View", "Options", "Help"]) {
    await expect(bar.getByRole("menuitem", { name: menu, exact: true })).toBeVisible();
  }
  // The tab (or the desktop's window) has the name.
  await expect(page.getByRole("heading", { name: "The Dawn Project" })).toHaveCount(0);

  const tracks = await studio.trackNames.count();
  await studio.menu("Create", "MIDI Track");
  await expect(studio.trackNames).toHaveCount(tracks + 1);
  await studio.menu("Edit", "Undo");
  await expect(studio.trackNames).toHaveCount(tracks);

  // A setting shows whether it's on.
  await bar.getByRole("menuitem", { name: "Options", exact: true }).click();
  const metronome = page.getByRole("menuitemcheckbox", { name: "Metronome" });
  const on = await metronome.getAttribute("aria-checked");
  await metronome.click();
  await bar.getByRole("menuitem", { name: "Options", exact: true }).click();
  await expect(metronome).toHaveAttribute("aria-checked", on === "true" ? "false" : "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("the menus work from the keyboard", async ({ page }) => {
  await page.getByRole("menubar").getByRole("menuitem", { name: "File", exact: true }).click();
  const menu = page.getByRole("menu", { name: "File" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "New Project" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: /^Open Project/ })).toBeFocused();
  // Across to Edit.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menu", { name: "Edit" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("menubar").getByRole("menuitem", { name: "Edit", exact: true })).toBeFocused();
});

test("the browser hides and shows, and stays as it was left", async ({ page, studio }) => {
  const browser = page.getByRole("tablist", { name: "Browser" });
  await expect(browser).toBeVisible();

  await studio.menu("View", "Browser");
  await expect(browser).toHaveCount(0);
  await page.getByRole("button", { name: "Browser" }).click();
  await expect(browser).toBeVisible();
  await page.keyboard.press("Control+Alt+B");
  await expect(browser).toHaveCount(0);

  // Once the project is kept, so the reload reopens it.
  await expect.poll(() => studio.autosavedTracks(), { timeout: 10_000 }).not.toBeNull();
  await page.reload();
  await expect(studio.trackNames.first()).toBeVisible();
  await expect(browser).toHaveCount(0);
  await page.getByRole("button", { name: "Browser" }).click();
  await expect(browser).toBeVisible();
});
