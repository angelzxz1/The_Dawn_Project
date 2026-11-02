// Faster effect handling: a rack's card dragged onto another track moves
// there (Ctrl: copied), a chain is copied and pasted, and a chain saved
// under a name is there to add to any track.

import { test, expect } from "./fixtures";

test("a card dragged onto another track moves there, or with Ctrl held is copied, and undo takes it back", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await studio.select("Audio 1");
  await studio.addEffect("Delay");
  const handles = page.getByTitle("Drag to reorder");
  await expect(handles).toHaveCount(1);

  await handles.first().dragTo(studio.header("MIDI 1"));
  await expect(handles).toHaveCount(0);
  await expect(page.getByText("Moved Delay to MIDI 1")).toBeVisible();
  await studio.select("MIDI 1");
  await expect(handles).toHaveCount(1);

  await page.keyboard.down("Control");
  await handles.first().dragTo(studio.header("MIDI 2"));
  await page.keyboard.up("Control");
  await expect(page.getByText("Copied Delay to MIDI 2")).toBeVisible();
  await expect(handles).toHaveCount(1);
  await studio.select("MIDI 2");
  await expect(handles).toHaveCount(1);

  await studio.undo();
  await expect(handles).toHaveCount(0);
});

test("a whole chain copied from one track pastes onto another", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await studio.select("Audio 1");
  await studio.addEffect("Delay");
  await studio.addEffect("Chorus");
  const handles = page.getByTitle("Drag to reorder");
  await handles.first().click({ button: "right" });
  await page.getByRole("button", { name: "Copy the whole chain (2)" }).click();

  await studio.select("MIDI 1");
  await expect(handles).toHaveCount(0);
  await page.getByText("Drag effects here").click({ button: "right" });
  await page.getByRole("button", { name: "Paste 2 effects here" }).click();
  await expect(handles).toHaveCount(2);
});

test("a chain saved from a rack is in the browser, to add to another track", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await studio.select("Audio 1");
  await studio.addEffect("Delay");
  await studio.addEffect("Chorus");
  await page.getByRole("button", { name: "Save chain" }).click();
  await page.getByRole("textbox", { name: "Chain name" }).fill("Wide echo");
  await page.keyboard.press("Enter");
  await expect(page.getByText('Saved the chain "Wide echo"')).toBeVisible();

  await studio.select("MIDI 1");
  const handles = page.getByTitle("Drag to reorder");
  await expect(handles).toHaveCount(0);
  await page.getByRole("region", { name: "Your chains" }).getByRole("button", { name: "Wide echo", exact: true }).click();
  await expect(handles).toHaveCount(2);
});
