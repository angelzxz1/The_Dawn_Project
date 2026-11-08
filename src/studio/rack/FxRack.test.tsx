// The FX rack on its own: the instrument slot, the effect cards and their
// buttons, dropping effects in from the browser and reordering them, the
// sends, and where the track's audio comes from and goes to - each checked
// by what the rack asks of the studio (its callbacks).

import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "@vitest/browser/context";
import type { ComponentProps } from "react";
import { FxRack } from "./FxRack";
import { EFFECT_DRAG_MIME, PRESET_DRAG_MIME } from "./EffectBrowser";
import { CHAIN_DRAG_MIME, RACK_EFFECTS_MIME } from "./effectDrag";
import { TRACK_COLOR_PALETTE } from "@/project/colors";
import { defaultParams, type EffectInstance, type EffectType } from "@/effects/registry";
import { INSTRUMENT_LABELS } from "@/instruments/registry";

function effect(id: string, type: EffectType, bypass = false): EffectInstance {
  return { id, type, params: defaultParams(type), bypass };
}

function renderRack(props: Partial<ComponentProps<typeof FxRack>> = {}) {
  const callbacks = {
    onAddEffect: vi.fn(),
    onRemoveEffect: vi.fn(),
    onMoveEffect: vi.fn(),
    onBypassToggle: vi.fn(),
    onParamChange: vi.fn(),
    onOpenEffectWindow: vi.fn(),
    onInstrumentChange: vi.fn(),
    onSendChange: vi.fn(),
    onParamDragStart: vi.fn(),
  };
  const screen = render(
    <FxRack channelName="Lead" channelType="midi" color={TRACK_COLOR_PALETTE[0]} instrument="synth" effects={[]} bpm={120} {...callbacks} {...props} />
  );
  return { screen, ...callbacks };
}

/** The drop target at a place in the chain (0 is before the first effect). */
const gap = (index: number) => document.querySelector(`[data-drop-gap="${index}"]`)!;

/** Drops what a drag carries (by type) on an element, as the browser would
 * when a drag from the effect browser or a card's handle ends there. */
function drop(target: Element, data: DataTransfer) {
  for (const type of ["dragenter", "dragover", "drop"]) {
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
  }
}

function carrying(entries: Record<string, string>): DataTransfer {
  const data = new DataTransfer();
  for (const [type, value] of Object.entries(entries)) data.setData(type, value);
  return data;
}

describe("the instrument slot", () => {
  test("a MIDI track picks its instrument there, or none", async () => {
    const { screen, onInstrumentChange } = renderRack();
    const slot = screen.getByRole("group", { name: "Instrument" });
    await expect.element(slot.getByRole("button", { name: INSTRUMENT_LABELS.synth })).toHaveAttribute("aria-pressed", "true");
    await slot.getByRole("button", { name: INSTRUMENT_LABELS.drums }).click();
    expect(onInstrumentChange).toHaveBeenCalledWith("drums");
    await slot.getByRole("button", { name: "None" }).click();
    expect(onInstrumentChange).toHaveBeenLastCalledWith(null);
  });

  test("a plugin isn't offered until the track has one", async () => {
    const { screen } = renderRack();
    const slot = screen.getByRole("group", { name: "Instrument" });
    await expect.element(slot.getByRole("button", { name: INSTRUMENT_LABELS.piano })).toBeVisible();
    await expect.element(slot.getByRole("button", { name: "Plugin" })).not.toBeInTheDocument();
  });

  test("a track's plugin is offered, and its card names it", async () => {
    const keys = { format: "vst3" as const, id: "ABCD", name: "Keys", vendor: "Cloud Synths", path: "C:/VST3/Keys.vst3" };
    const { screen, onInstrumentChange } = renderRack({ instrument: "plugin", instrumentSettings: { pluginInstrument: keys } });
    const pluginSlot = screen.getByRole("group", { name: "Instrument" });
    await expect.element(pluginSlot.getByRole("button", { name: "Plugin" })).toHaveAttribute("aria-pressed", "true");
    await expect.element(pluginSlot.getByText("Keys")).toBeVisible();
    await expect.element(pluginSlot.getByText("VST3")).toBeVisible();
    // It plays in the native engine, which isn't on here.
    await expect.element(pluginSlot.getByRole("button", { name: "Open its window" })).toBeDisabled();
    await expect.element(pluginSlot.getByRole("status")).toHaveTextContent(/native engine/);
    await pluginSlot.getByRole("button", { name: INSTRUMENT_LABELS.synth }).click();
    expect(onInstrumentChange).toHaveBeenCalledWith("synth");
  });

  test("with none loaded, it says the track is silent", async () => {
    const { screen } = renderRack({ instrument: null });
    await expect.element(screen.getByText(/No instrument loaded/)).toBeVisible();
  });

  test("audio tracks and buses have no instrument slot", async () => {
    const { screen } = renderRack({ channelType: "audio", instrument: null });
    await expect.element(screen.getByRole("group", { name: "Instrument" })).not.toBeInTheDocument();
  });
});

describe("the effect cards", () => {
  test("each card's buttons act on its own effect", async () => {
    const { screen, onBypassToggle, onRemoveEffect, onOpenEffectWindow } = renderRack({
      effects: [effect("a", "reverb"), effect("b", "delay")],
    });
    await screen.getByTitle("Bypass effect").nth(1).click();
    expect(onBypassToggle).toHaveBeenCalledWith("b");
    await screen.getByTitle("Expand").nth(0).click();
    expect(onOpenEffectWindow).toHaveBeenCalledWith("a");
    await screen.getByTitle("Remove effect").nth(0).click();
    expect(onRemoveEffect).toHaveBeenCalledWith("a");
  });

  test("a bypassed effect offers to be switched back on", async () => {
    const { screen, onBypassToggle } = renderRack({ effects: [effect("a", "reverb", true)] });
    await screen.getByTitle("Enable effect").click();
    expect(onBypassToggle).toHaveBeenCalledWith("a");
  });

  test("a bypassed effect says it isn't playing; the others don't", async () => {
    const { screen } = renderRack({ effects: [effect("a", "reverb", true), effect("b", "delay")] });
    await expect.element(screen.getByRole("status")).toHaveTextContent("Bypassed");
    expect(screen.getByRole("status").all()).toHaveLength(1);
  });

  test("an effect dropped from the browser goes where it's dropped, with its preset", () => {
    const { onAddEffect } = renderRack({ effects: [effect("a", "reverb"), effect("b", "delay")] });
    drop(gap(1), carrying({ [EFFECT_DRAG_MIME]: "chorus" }));
    expect(onAddEffect).toHaveBeenCalledWith("chorus", 1, undefined);
    drop(gap(2), carrying({ [EFFECT_DRAG_MIME]: "reverb", [PRESET_DRAG_MIME]: "factory:reverb:small-room" }));
    expect(onAddEffect).toHaveBeenLastCalledWith("reverb", 2, "factory:reverb:small-room");
  });

  test("an empty rack takes a dropped effect as its first", async () => {
    const { screen, onAddEffect } = renderRack();
    drop(screen.getByText("Drag effects here").element(), carrying({ [EFFECT_DRAG_MIME]: "delay" }));
    expect(onAddEffect).toHaveBeenCalledWith("delay", 0, undefined);
  });

  test("right-clicking a card opens what can be done to that effect", async () => {
    const onDuplicateEffect = vi.fn();
    const onPresetChange = vi.fn();
    const { screen, onMoveEffect, onBypassToggle, onRemoveEffect, onOpenEffectWindow } = renderRack({
      effects: [effect("a", "reverb"), effect("b", "delay")],
      onDuplicateEffect,
      onPresetChange,
    });
    const menuOn = async (card: number) => {
      await screen.getByTitle("Drag to reorder").nth(card).click({ button: "right" });
    };
    const item = (name: string | RegExp) => screen.getByRole("button", { name, exact: typeof name === "string" });

    await menuOn(1);
    await expect.element(item("Move right")).toBeDisabled();
    await item("Move left").click();
    expect(onMoveEffect).toHaveBeenCalledWith("b", 0);
    await expect.element(item("Move left")).not.toBeInTheDocument();

    await menuOn(0);
    await expect.element(item("Move left")).toBeDisabled();
    await item("Move right").click();
    expect(onMoveEffect).toHaveBeenLastCalledWith("a", 1);

    const steps: [string | RegExp, () => void][] = [
      [/^Open /, () => expect(onOpenEffectWindow).toHaveBeenCalledWith("b")],
      ["Bypass", () => expect(onBypassToggle).toHaveBeenCalledWith("b")],
      ["Duplicate", () => expect(onDuplicateEffect).toHaveBeenCalledWith("b")],
      ["Reset to the defaults", () => expect(onPresetChange).toHaveBeenCalledWith("b", { params: defaultParams("delay"), preset: undefined })],
      ["Remove", () => expect(onRemoveEffect).toHaveBeenCalledWith("b")],
    ];
    for (const [name, check] of steps) {
      await menuOn(1);
      await item(name).click();
      check();
    }
  });

  test("right-clicking a knob types its value, without the card's menu", async () => {
    const { screen } = renderRack({ effects: [effect("a", "reverb")] });
    await screen.getByTitle(/^Drag or scroll to change/).first().click({ button: "right" });
    await expect.element(screen.getByRole("button", { name: "Duplicate" })).not.toBeInTheDocument();
  });

  test("a card dragged by its handle moves to where it's dropped", async () => {
    const { screen, onMoveEffect, onAddEffect } = renderRack({ effects: [effect("a", "reverb"), effect("b", "delay")] });
    const data = new DataTransfer();
    const handle = screen.getByTitle("Drag to reorder").nth(1).element();
    handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: data }));
    drop(gap(0), data);
    expect(onMoveEffect).toHaveBeenCalledWith("b", 0);
    expect(onAddEffect).not.toHaveBeenCalled();
  });

  test("the rack asks to fold away and back, and shows only its title bar folded", async () => {
    const onCollapsedChange = vi.fn();
    const { screen } = renderRack({ effects: [effect("a", "reverb")], onCollapsedChange });
    await screen.getByTitle("Collapse the FX rack").click();
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    screen.rerender(
      <FxRack channelName="Lead" channelType="midi" color={TRACK_COLOR_PALETTE[0]} instrument="synth" effects={[effect("a", "reverb")]} bpm={120} onAddEffect={vi.fn()} onRemoveEffect={vi.fn()} onMoveEffect={vi.fn()} onBypassToggle={vi.fn()} onParamChange={vi.fn()} collapsed onCollapsedChange={onCollapsedChange} />
    );
    await expect.element(screen.getByTitle("Remove effect")).not.toBeInTheDocument();
    await screen.getByTitle("Expand the FX rack").click();
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
  });
});

describe("effects from elsewhere, copying and chains", () => {
  test("a chain from the browser, another rack's card, and a card dropped with Ctrl go to the studio where they're dropped", async () => {
    const onDropEffects = vi.fn();
    const { screen, onMoveEffect } = renderRack({ hostId: "lead", effects: [effect("a", "reverb"), effect("b", "delay")], onDropEffects });
    drop(gap(1), carrying({ [CHAIN_DRAG_MIME]: "clean-guitar" }));
    expect(onDropEffects).toHaveBeenLastCalledWith({ kind: "chain", chain: "clean-guitar" }, 1);
    drop(gap(0), carrying({ [RACK_EFFECTS_MIME]: JSON.stringify({ host: "bass", ids: ["x"] }) }));
    expect(onDropEffects).toHaveBeenLastCalledWith({ kind: "rack", host: "bass", ids: ["x"], copy: false }, 0);

    const data = new DataTransfer();
    screen.getByTitle("Drag to reorder").nth(0).element().dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: data }));
    gap(2).dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data, ctrlKey: true }));
    expect(onDropEffects).toHaveBeenLastCalledWith({ kind: "rack", host: "lead", ids: ["a"], copy: true }, 2);
    expect(onMoveEffect).not.toHaveBeenCalled();
  });

  test("a card's menu copies it or the whole chain, and pastes after it; the rack's own menu pastes at the end", async () => {
    const onCopyEffects = vi.fn();
    const onPasteEffects = vi.fn();
    const { screen } = renderRack({ effects: [effect("a", "reverb"), effect("b", "delay")], onCopyEffects, onPasteEffects, copiedCount: 0 });
    const menuOf = (card: number) => screen.getByTitle("Drag to reorder").nth(card).click({ button: "right" });
    await menuOf(0);
    await expect.element(screen.getByRole("button", { name: "Paste (nothing copied yet)" })).toBeDisabled();
    await screen.getByRole("button", { name: "Copy the whole chain (2)" }).click();
    expect(onCopyEffects).toHaveBeenLastCalledWith(["a", "b"]);
    await menuOf(1);
    await screen.getByRole("button", { name: "Copy", exact: true }).click();
    expect(onCopyEffects).toHaveBeenLastCalledWith(["b"]);

    screen.rerender(
      <FxRack channelName="Lead" channelType="midi" color={TRACK_COLOR_PALETTE[0]} instrument="synth" effects={[effect("a", "reverb"), effect("b", "delay")]} bpm={120} onAddEffect={vi.fn()} onRemoveEffect={vi.fn()} onMoveEffect={vi.fn()} onBypassToggle={vi.fn()} onParamChange={vi.fn()} onCopyEffects={onCopyEffects} onPasteEffects={onPasteEffects} copiedCount={2} />
    );
    await menuOf(0);
    await screen.getByRole("button", { name: "Paste 2 effects after this" }).click();
    expect(onPasteEffects).toHaveBeenLastCalledWith(1);
    // Outside the cards: the rack's own menu.
    const gapAtEnd = gap(2) as HTMLElement;
    gapAtEnd.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    await screen.getByRole("button", { name: "Paste 2 effects at the end" }).click();
    expect(onPasteEffects).toHaveBeenLastCalledWith(2);
  });

  test("the chain is saved under the name typed, or not at all with Escape", async () => {
    const onSaveChain = vi.fn();
    const { screen } = renderRack({ effects: [effect("a", "reverb")], onSaveChain });
    await screen.getByRole("button", { name: "Save chain" }).click();
    const name = screen.getByRole("textbox", { name: "Chain name" });
    await expect.element(name).toHaveValue("Lead");
    await userEvent.fill(name, "Wide lead");
    await userEvent.keyboard("{Enter}");
    expect(onSaveChain).toHaveBeenCalledWith("Wide lead");
    await screen.getByRole("button", { name: "Save chain" }).click();
    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByRole("textbox", { name: "Chain name" })).not.toBeInTheDocument();
    expect(onSaveChain).toHaveBeenCalledTimes(1);
  });

  test("an empty rack has nothing to save", async () => {
    const { screen } = renderRack({ onSaveChain: vi.fn() });
    await expect.element(screen.getByRole("button", { name: "Save chain" })).not.toBeInTheDocument();
  });
});

describe("sends and routing", () => {
  const buses = [
    { id: "verb", name: "Reverb", colorIndex: 0 },
    { id: "dly", name: "Echo", colorIndex: 1 },
  ];

  test("a level per bus; typing one sets it, and the bottom turns the send off", async () => {
    const { screen, onSendChange } = renderRack({ buses, sends: { verb: -12 } });
    await expect.element(screen.getByRole("slider", { name: "Reverb" })).toHaveAttribute("aria-valuenow", "-12");
    await expect.element(screen.getByRole("slider", { name: "Echo" })).toHaveAttribute("aria-valuenow", "-60");
    await screen.getByRole("slider", { name: "Echo" }).click();
    await userEvent.fill(screen.getByRole("textbox"), "-6");
    await userEvent.keyboard("{Enter}");
    expect(onSendChange).toHaveBeenCalledWith("dly", -6);
    await screen.getByRole("slider", { name: "Reverb" }).click();
    await userEvent.fill(screen.getByRole("textbox"), "-80");
    await userEvent.keyboard("{Enter}");
    expect(onSendChange).toHaveBeenLastCalledWith("verb", null);
  });

  test("a send on says whether it's before or after the fader, and switches", async () => {
    const onSendPreChange = vi.fn();
    const { screen } = renderRack({ buses, sends: { verb: -12, dly: -6 }, preSends: ["dly"], onSendPreChange });
    const toggle = (bus: string) => screen.getByRole("button", { name: `Take the send to ${bus} before the fader` });
    await expect.element(toggle("Reverb")).toHaveAttribute("aria-pressed", "false");
    await expect.element(toggle("Reverb")).toHaveTextContent("Post");
    await expect.element(toggle("Echo")).toHaveTextContent("Pre");
    await toggle("Reverb").click();
    expect(onSendPreChange).toHaveBeenCalledWith("verb", true);
    await toggle("Echo").click();
    expect(onSendPreChange).toHaveBeenLastCalledWith("dly", false);
  });

  test("a send that's off has no pre/post switch", async () => {
    const { screen } = renderRack({ buses, sends: { verb: -12 }, onSendPreChange: vi.fn() });
    await expect.element(screen.getByRole("button", { name: "Take the send to Echo before the fader" })).not.toBeInTheDocument();
  });

  test("a bus's own rack has no sends", async () => {
    const { screen } = renderRack({ channelType: undefined, instrument: undefined, buses });
    await expect.element(screen.getByRole("slider", { name: "Reverb" })).not.toBeInTheDocument();
  });

  test("Audio from and Audio to pick the track's input and output", async () => {
    const onInputChange = vi.fn();
    const onOutputChange = vi.fn();
    const inputOptions = [
      { value: "", label: "Audio interface" },
      { value: "gtr", label: "Guitar" },
    ];
    const outputOptions = [
      { value: "", label: "Master" },
      { value: "grp", label: "Group" },
    ];
    const { screen } = renderRack({ channelType: "audio", instrument: null, inputOptions, onInputChange, outputOptions, onOutputChange });
    const from = screen.getByText("Audio from").getByRole("combobox").first();
    await from.selectOptions("Guitar");
    expect(onInputChange).toHaveBeenCalledWith("gtr", "postFx");
    await screen.getByText("Audio to").getByRole("combobox").selectOptions("Group");
    expect(onOutputChange).toHaveBeenCalledWith("grp");
  });

  test("taking the input from a track, where on it can be chosen", async () => {
    const onInputChange = vi.fn();
    const inputOptions = [
      { value: "", label: "Audio interface" },
      { value: "gtr", label: "Guitar" },
    ];
    const { screen } = renderRack({ channelType: "audio", instrument: null, inputOptions, inputValue: "gtr", onInputChange });
    await screen.getByRole("combobox", { name: "Where on that track" }).selectOptions("Pre FX");
    expect(onInputChange).toHaveBeenCalledWith("gtr", "preFx");
  });
});
