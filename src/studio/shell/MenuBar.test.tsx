// The menu bar on its own: opening a menu, picking an item, settings with
// their checks, what can't be done now, and moving between menus.

import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "@vitest/browser/context";
import { MenuBar, type Menu } from "./MenuBar";

function menus(run = vi.fn(), onOpen = vi.fn()): Menu[] {
  return [
    {
      label: "File",
      onOpen,
      entries: [
        { label: "New Project", onSelect: run },
        { kind: "separator" },
        { label: "Save", shortcut: "Ctrl+S", onSelect: vi.fn() },
        { kind: "note", text: "Saved to a folder." },
      ],
    },
    {
      label: "Options",
      entries: [
        { label: "Metronome", checked: true, onSelect: vi.fn() },
        { label: "Loop", checked: false, onSelect: vi.fn() },
        { label: "Undo", disabled: true, onSelect: vi.fn() },
        { kind: "link", label: "Setup Guide", href: "/how-it-works#setup" },
      ],
    },
  ];
}

describe("the menu bar", () => {
  test("opens a menu, runs the item picked and closes", async () => {
    const run = vi.fn();
    const onOpen = vi.fn();
    const screen = render(<MenuBar menus={menus(run, onOpen)} />);
    await screen.getByRole("menuitem", { name: "File", exact: true }).click();
    expect(onOpen).toHaveBeenCalledOnce();
    const file = screen.getByRole("menu", { name: "File" });
    await expect.element(file.getByRole("menuitem", { name: "Save Ctrl+S" })).toBeVisible();
    await expect.element(file.getByText("Saved to a folder.")).toBeVisible();
    await file.getByRole("menuitem", { name: "New Project" }).click();
    expect(run).toHaveBeenCalledOnce();
    await expect.element(screen.getByRole("menu")).not.toBeInTheDocument();
  });

  test("shows which settings are on, what can't be done now, and links to the guides", async () => {
    const screen = render(<MenuBar menus={menus()} />);
    await screen.getByRole("menuitem", { name: "Options", exact: true }).click();
    await expect.element(screen.getByRole("menuitemcheckbox", { name: "Metronome" })).toHaveAttribute("aria-checked", "true");
    await expect.element(screen.getByRole("menuitemcheckbox", { name: "Loop" })).toHaveAttribute("aria-checked", "false");
    await expect.element(screen.getByRole("menuitem", { name: "Undo" })).toBeDisabled();
    await expect.element(screen.getByRole("menuitem", { name: "Setup Guide" })).toHaveAttribute("target", "_blank");
  });

  test("while one is open, pointing at another opens it; the arrows move through them", async () => {
    const screen = render(<MenuBar menus={menus()} />);
    await screen.getByRole("menuitem", { name: "File", exact: true }).click();
    await userEvent.hover(screen.getByRole("menuitem", { name: "Options", exact: true }));
    await expect.element(screen.getByRole("menu", { name: "Options" })).toBeVisible();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(screen.getByRole("menuitemcheckbox", { name: "Metronome" })).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(screen.getByRole("menuitem", { name: "Setup Guide" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(screen.getByRole("menu", { name: "File" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByRole("menu")).not.toBeInTheDocument();
  });
});
