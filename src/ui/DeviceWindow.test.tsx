// The frame every device window shares: its name, bypass and close, Escape,
// focus kept inside, and the Keys window floating where it was left.

import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "@vitest/browser/context";
import { CLOSE_TITLE, DeviceWindow } from "./DeviceWindow";

describe("a device's window", () => {
  test("is a dialog named after the device and its track, with bypass and close", async () => {
    const onClose = vi.fn();
    const toggle = vi.fn();
    const screen = render(
      <DeviceWindow title="Chorus" subtitle="Audio 1" bypass={{ on: false, toggle }} onClose={onClose} width={600}>
        <button type="button">Inside</button>
      </DeviceWindow>
    );
    const dialog = screen.getByRole("dialog", { name: "Chorus — Audio 1" });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog).toHaveAttribute("aria-modal", "true");
    await expect.element(dialog.getByRole("heading", { name: "Chorus" })).toBeVisible();

    await dialog.getByTitle("Bypass effect").click();
    expect(toggle).toHaveBeenCalledTimes(1);
    await dialog.getByTitle(CLOSE_TITLE).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Escape closes it", async () => {
    const onClose = vi.fn();
    render(
      <DeviceWindow title="Drum Rack" onClose={onClose}>
        <p>Pads</p>
      </DeviceWindow>
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("takes focus when it opens, keeps Tab inside, and gives focus back when it closes", async () => {
    function Studio() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          {open && (
            <DeviceWindow title="Delay" onClose={() => setOpen(false)}>
              <button type="button">First control</button>
              <button type="button">Last control</button>
            </DeviceWindow>
          )}
        </>
      );
    }
    const screen = render(<Studio />);
    const opener = screen.getByRole("button", { name: "Open" });
    await opener.click();
    const dialog = screen.getByRole("dialog", { name: "Delay" });
    await expect.element(dialog).toHaveFocus();

    // The title row's close button comes first, the device's controls after.
    await userEvent.tab();
    await expect.element(dialog.getByRole("button", { name: "Close Delay" })).toHaveFocus();
    await userEvent.tab();
    await userEvent.tab();
    await expect.element(dialog.getByRole("button", { name: "Last control" })).toHaveFocus();
    await userEvent.tab();
    await expect.element(dialog.getByRole("button", { name: "Close Delay" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    await expect.element(dialog.getByRole("button", { name: "Last control" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(opener).toHaveFocus();
  });
});

describe("the floating Keys window", () => {
  test("isn't modal, stays mounted while closed, and leaves Escape alone", async () => {
    const onClose = vi.fn();
    function Keys({ open }: { open: boolean }) {
      return (
        <DeviceWindow title="Keys" subtitle="Bass" onClose={onClose} floating={{ open, posKey: "test.keysPos" }}>
          <p>Piano</p>
        </DeviceWindow>
      );
    }
    const screen = render(<Keys open />);
    const dialog = screen.getByRole("dialog", { name: "Keys — Bass" });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog).not.toHaveAttribute("aria-modal");
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    // Hidden, it leaves the accessibility tree, so keep hold of the element.
    const panel = dialog.element() as HTMLElement;
    screen.rerender(<Keys open={false} />);
    await expect.poll(() => panel.hidden).toBe(true);
    expect(panel).toBeInTheDocument();
    expect(panel).not.toBeVisible();
  });

  test("is dragged by its title row and opens where it was left", async () => {
    const view = () => (
      <DeviceWindow title="Keys" onClose={() => {}} floating={{ open: true, posKey: "test.keysPos" }} width={400}>
        <p>Piano</p>
      </DeviceWindow>
    );
    const screen = render(view());
    const panel = screen.getByRole("dialog", { name: "Keys" }).element() as HTMLElement;
    const heading = screen.getByRole("heading", { name: "Keys" }).element() as HTMLElement;
    const before = panel.getBoundingClientRect();
    const grab = heading.getBoundingClientRect();
    const fire = (type: string, x: number, y: number) =>
      heading.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y }));
    fire("pointerdown", grab.left + 5, grab.top + 5);
    fire("pointermove", grab.left + 5 - 100, grab.top + 5 - 200);
    fire("pointerup", grab.left + 5 - 100, grab.top + 5 - 200);
    await expect.poll(() => Math.round(panel.getBoundingClientRect().left)).toBe(Math.round(before.left - 100));
    expect(Math.round(panel.getBoundingClientRect().top)).toBe(Math.round(before.top - 200));

    const saved = JSON.parse(localStorage.getItem("test.keysPos")!);
    screen.unmount();
    const again = render(view());
    const moved = again.getByRole("dialog", { name: "Keys" }).element().getBoundingClientRect();
    expect(Math.round(moved.left)).toBe(Math.round(saved.x));
    expect(Math.round(moved.top)).toBe(Math.round(saved.y));
  });
});
