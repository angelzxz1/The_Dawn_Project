// The command palette and the cheat sheet on their own, given what the
// shortcut registry says works: finding a command, running it (as its
// keys would), and the sheet's groups.

import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "@vitest/browser/context";
import { CommandPalette } from "./CommandPalette";
import { ShortcutSheet } from "./ShortcutSheet";
import type { ActiveShortcut, Shortcut, ShortcutLayer } from "@/ui/shortcuts";

const command = (label: string, keys: string[], run: Shortcut["run"] = () => {}, layer: ShortcutLayer = "studio"): ActiveShortcut => ({
  label,
  keys,
  layer,
  palette: true,
  run,
});

describe("the command palette", () => {
  test("typing finds a command; Enter closes the palette and runs it, as its keys would", async () => {
    const run = vi.fn();
    const onClose = vi.fn();
    const screen = render(
      <CommandPalette
        available={[command("Undo", ["mod+z"]), command("Loop the time selection", ["mod+l"], run), command("Add an audio track", [])]}
        onClose={onClose}
        onNothingToDo={vi.fn()}
      />
    );
    await expect.element(screen.getByRole("option").first()).toBeVisible();
    expect(screen.getByRole("option").all()).toHaveLength(3);
    await userEvent.type(screen.getByRole("combobox", { name: "Find a command" }), "loop");
    await expect.element(screen.getByRole("option")).toHaveTextContent("Loop the time selection");
    await userEvent.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalled();
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(run.mock.calls[0][0]).toMatchObject({ key: "l", ctrlKey: true });
  });

  test("the arrows pick another; a click runs it", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const screen = render(
      <CommandPalette available={[command("Add a MIDI track", [], first), command("Add an audio track", [], second)]} onClose={vi.fn()} onNothingToDo={vi.fn()} />
    );
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(screen.getByRole("option", { name: "Add an audio track" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(second).toHaveBeenCalledOnce());
    expect(first).not.toHaveBeenCalled();
  });

  test("a command with nothing to act on says so", async () => {
    const onNothingToDo = vi.fn();
    const screen = render(<CommandPalette available={[command("Delete the selected clips", ["delete"], () => false)]} onClose={vi.fn()} onNothingToDo={onNothingToDo} />);
    await screen.getByRole("option", { name: /Delete the selected clips/ }).click();
    await vi.waitFor(() => expect(onNothingToDo).toHaveBeenCalledWith("Delete the selected clips"));
  });

  test("a search that finds nothing says so", async () => {
    const screen = render(<CommandPalette available={[command("Undo", ["mod+z"])]} onClose={vi.fn()} onNothingToDo={vi.fn()} />);
    await userEvent.type(screen.getByRole("combobox"), "teleport");
    await expect.element(screen.getByText("Nothing called that here.")).toBeVisible();
  });
});

describe("the cheat sheet", () => {
  test("lists the shortcuts with keys by where they work, and finds one", async () => {
    const screen = render(
      <ShortcutSheet
        available={[command("Quantize", ["q"], () => {}, "editor"), command("Undo", ["mod+z"]), command("Add an audio track", []), command("Save", ["mod+s"], () => {}, "global")]}
        onClose={vi.fn()}
      />
    );
    await expect.element(screen.getByRole("region", { name: "Piano roll" })).toHaveTextContent("QuantizeQ");
    await expect.element(screen.getByRole("region", { name: "Arrangement" })).toHaveTextContent("UndoCtrl+Z");
    await expect.element(screen.getByText("Add an audio track")).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: "Find a shortcut" }), "save");
    await expect.element(screen.getByRole("region", { name: "Anywhere" })).toBeVisible();
    await expect.element(screen.getByRole("region", { name: "Arrangement" })).not.toBeInTheDocument();
  });
});
