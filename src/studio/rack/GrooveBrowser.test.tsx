// The Grooves tab's samples (from sound packs) and favorites, on its own
// with a pack's samples standing in.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { GrooveBrowser, SAMPLE_DRAG_MIME } from "./GrooveBrowser";
import { resetPicks } from "@/library/browserPicks";

const packs = vi.hoisted(() => ({ samples: [] as { fileId: string; name: string; pack: string }[], installed: [] }));
vi.mock("@/project/packStore", () => ({
  packSamples: () => packs.samples,
  // The same list each time, as the store's is until it changes.
  installedPacks: () => packs.installed,
  subscribePacks: () => () => {},
}));

beforeEach(() => {
  resetPicks();
  packs.samples = [];
});

function renderGrooves(canAddSample = true) {
  const props = {
    onPreview: vi.fn(),
    onStopPreview: vi.fn(),
    onAdd: vi.fn(),
    canAdd: true,
    onPreviewSample: vi.fn(() => Promise.resolve(2)),
    onAddSample: vi.fn(),
    canAddSample,
  };
  return { screen: render(<GrooveBrowser {...props} />), ...props };
}

describe("samples", () => {
  test("with no pack, it says where samples come from", async () => {
    const { screen } = renderGrooves();
    await expect.element(screen.getByRole("region", { name: "Samples" })).toHaveTextContent(/sound pack/);
  });

  test("a pack's sample can be heard, added at the playhead, and dragged as itself", async () => {
    const kick = { fileId: "pack:p:samples/kick.wav", name: "kick", pack: "Kicks" };
    packs.samples = [kick];
    const { screen, onPreviewSample, onAddSample } = renderGrooves();
    await screen.getByRole("button", { name: "Preview kick", exact: true }).click();
    expect(onPreviewSample).toHaveBeenCalledWith(kick.fileId);
    await screen.getByRole("button", { name: "Add kick at the playhead" }).click({ force: true });
    expect(onAddSample).toHaveBeenCalledWith(kick);

    const data = new DataTransfer();
    screen.getByTitle(/^kick, from the pack/).element().dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: data }));
    expect(data.getData(SAMPLE_DRAG_MIME)).toBe(kick.fileId);
  });

  test("a starred sample shows under Favorites", async () => {
    packs.samples = [{ fileId: "f1", name: "snare", pack: "P" }];
    const { screen } = renderGrooves();
    await screen.getByRole("button", { name: "Star snare" }).click({ force: true });
    await expect.element(screen.getByRole("region", { name: "Favorites" })).toHaveTextContent("snare");
  });
});
