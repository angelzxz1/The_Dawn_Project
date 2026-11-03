// The mixer on its own: a strip for every track, bus and the master, each
// with its inserts, sends, pan, buttons and fader - checked by what it asks
// of the studio (its actions), with the project in the store.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "@vitest/browser/context";
import { useState } from "react";
import { defaultParams } from "@/effects/registry";
import { INSTRUMENT_LABELS } from "@/instruments/registry";
import type { ProjectState } from "@/project/project";
import type { ChannelConfig } from "@/project/types";
import { projectStore } from "@/state/projectStore";
import { EFFECT_DRAG_MIME } from "@/studio/rack/effectDrag";
import { Fader } from "./Fader";
import { Mixer, type MixerActions } from "./Mixer";

const track = (id: string, name: string, type: ChannelConfig["type"], more: Partial<ChannelConfig> = {}): ChannelConfig => ({
  id,
  name,
  type,
  volume: 0,
  pan: 0,
  colorIndex: 0,
  instrument: type === "midi" ? "synth" : null,
  muted: false,
  solo: false,
  armed: false,
  ...more,
});

const tracks = [
  track("lead", "Lead", "midi", { volume: -6, sends: { verb: -12 } }),
  track("vox", "Vox", "audio", { muted: true }),
];

function doc(): ProjectState {
  return {
    channels: tracks,
    clipsByChannel: {},
    takesByChannel: {},
    channelEffects: { lead: [{ id: "fx-1", type: "chorus", params: defaultParams("chorus") }, { id: "fx-2", type: "reverb", params: defaultParams("reverb"), bypass: true }] },
    buses: [{ id: "verb", name: "Verb", colorIndex: 1, volume: -3 }],
    busEffects: {},
    bpm: 120,
    tempoChanges: [],
    markers: [],
    timeSignature: { numerator: 4, denominator: 4 },
    masterVolume: 0,
    masterPan: 0,
    masterName: "Master",
    masterEffects: [],
  };
}

function actions(): MixerActions {
  const names: (keyof MixerActions)[] = [
    "selectTrack", "selectBus", "selectMaster", "adjustStart", "setVolume", "setPan", "toggleMute", "toggleSolo", "toggleArm",
    "setSend", "setSendPre", "setInput", "setOutput", "openEffect", "toggleBypass", "openInstrument", "dropEffects", "hover",
    "addBus", "renameBus", "removeBus", "setBusVolume", "setBusPan", "toggleBusMute", "setMasterVolume", "setMasterPan", "setCeiling",
  ];
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as unknown as MixerActions;
}

function renderMixer(selected: Parameters<typeof Mixer>[0]["selected"] = null) {
  const a = actions();
  const screen = render(
    <Mixer
      tracks={tracks}
      selected={selected}
      route={null}
      silent={new Map()}
      inputOptions={() => [{ value: "", label: "Audio interface" }, { value: "lead", label: "Track: Lead" }]}
      outputOptions={() => [{ value: "", label: "Master" }, { value: "vox", label: "Track: Vox" }]}
      limiterThreshold={-1}
      actions={a}
    />
  );
  return { screen, actions: a, strip: (name: string) => screen.getByRole("group", { name: `Mixer: ${name}` }) };
}

beforeEach(() => {
  projectStore.replace(doc());
});

describe("the mixer", () => {
  test("has a strip for each track, then each bus, then the master, with their levels", async () => {
    const { screen } = renderMixer();
    const strips = screen.getByRole("group", { name: /^Mixer: / }).elements().map((e) => e.getAttribute("aria-label"));
    expect(strips).toEqual(["Mixer: Lead", "Mixer: Vox", "Mixer: Verb", "Mixer: Master"]);
    await expect.element(screen.getByRole("slider", { name: "Lead volume" })).toHaveAttribute("aria-valuetext", "-6.0 dB");
    await expect.element(screen.getByRole("slider", { name: "Verb volume" })).toHaveAttribute("aria-valuetext", "-3.0 dB");
    await expect.element(screen.getByRole("slider", { name: "Master volume" })).toHaveAttribute("aria-valuetext", "0.0 dB");
  });

  test("lists a track's instrument, then its effects; one opens on a click, and its light bypasses it", async () => {
    const { strip, actions: a } = renderMixer();
    const inserts = strip("Lead").getByRole("list", { name: "Inserts" });
    await expect.element(inserts.getByRole("listitem").first()).toHaveTextContent(INSTRUMENT_LABELS.synth);
    await inserts.getByRole("button", { name: "Chorus", exact: true }).click();
    expect(a.openEffect).toHaveBeenCalledWith("lead", "fx-1");
    await expect.element(inserts.getByRole("button", { name: "Reverb on" })).toHaveAttribute("aria-pressed", "false");
    await inserts.getByRole("button", { name: "Reverb on" }).click();
    expect(a.toggleBypass).toHaveBeenCalledWith("lead", "fx-2");
    await inserts.getByRole("button", { name: INSTRUMENT_LABELS.synth }).click();
    expect(a.openInstrument).toHaveBeenCalledWith("lead");
  });

  test("moves a fader with the keys, a gesture at a time, and double-click puts it back at 0 dB", async () => {
    const { screen, actions: a } = renderMixer();
    const fader = screen.getByRole("slider", { name: "Lead volume" });
    (fader.element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(a.setVolume).toHaveBeenLastCalledWith("lead", -5.5);
    await userEvent.keyboard("{PageDown}");
    expect(a.setVolume).toHaveBeenLastCalledWith("lead", -9);
    expect(a.adjustStart).toHaveBeenCalledTimes(2);
    await fader.dblClick();
    expect(a.setVolume).toHaveBeenLastCalledWith("lead", 0);
  });

  test("mute, solo and arm a track, and mute a bus", async () => {
    const { strip, actions: a } = renderMixer();
    await expect.element(strip("Vox").getByTitle("Unmute", { exact: true })).toHaveAttribute("aria-pressed", "true");
    await strip("Lead").getByTitle("Mute", { exact: true }).click();
    expect(a.toggleMute).toHaveBeenCalledWith("lead");
    await strip("Lead").getByTitle("Solo", { exact: true }).click();
    expect(a.toggleSolo).toHaveBeenCalledWith("lead");
    await strip("Lead").getByTitle("Arm this channel for recording and note input").click();
    expect(a.toggleArm).toHaveBeenCalledWith("lead");
    await strip("Verb").getByTitle("Mute", { exact: true }).click();
    expect(a.toggleBusMute).toHaveBeenCalledWith("verb");
  });

  test("has a send to each bus; one that's on can be taken before the fader", async () => {
    const { strip, actions: a } = renderMixer();
    const send = strip("Lead").getByRole("group", { name: "Send to Verb" });
    await expect.element(send.getByRole("slider")).toHaveAttribute("aria-valuenow", "-12");
    await send.getByRole("button", { name: "Take the send to Verb before the fader" }).click();
    expect(a.setSendPre).toHaveBeenCalledWith("lead", "verb", true);
    // Vox doesn't send: no switch until it does.
    await expect.element(strip("Vox").getByRole("button", { name: /before the fader$/ })).not.toBeInTheDocument();
  });

  test("picks where a track's audio comes from and goes", async () => {
    const { strip, actions: a } = renderMixer();
    await strip("Vox").getByRole("combobox", { name: "Audio from" }).selectOptions("lead");
    expect(a.setInput).toHaveBeenCalledWith("vox", "lead", "postFx");
    await strip("Lead").getByRole("combobox", { name: "Audio to" }).selectOptions("vox");
    expect(a.setOutput).toHaveBeenCalledWith("lead", "vox");
  });

  test("a click on a strip shows its FX rack, the pointer on it lights its routing, and effects dropped on it are added", async () => {
    const { strip, actions: a } = renderMixer({ kind: "track", id: "vox" });
    await strip("Verb").getByText("Its sends").click();
    expect(a.selectBus).toHaveBeenCalledWith("verb");
    await strip("Master").getByText("Every track").click();
    expect(a.selectMaster).toHaveBeenCalled();
    await strip("Lead").getByText("MIDI", { exact: true }).hover();
    expect(a.hover).toHaveBeenLastCalledWith({ kind: "track", id: "lead" });

    const data = new DataTransfer();
    data.setData(EFFECT_DRAG_MIME, "delay");
    for (const type of ["dragenter", "dragover", "drop"]) {
      strip("Vox").element().dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
    }
    expect(a.dropEffects).toHaveBeenCalledWith("vox", { kind: "effect", type: "delay", preset: undefined });
  });

  test("renames and removes a bus, and adds one", async () => {
    const { screen, strip, actions: a } = renderMixer();
    await strip("Verb").getByRole("textbox", { name: "Bus name" }).fill("Plate");
    expect(a.renameBus).toHaveBeenLastCalledWith("verb", "Plate");
    await strip("Verb").getByRole("button", { name: "Remove Verb" }).click();
    expect(a.removeBus).toHaveBeenCalledWith("verb");
    await screen.getByRole("button", { name: "Bus", exact: true }).click();
    expect(a.addBus).toHaveBeenCalled();
  });
});

describe("the fader", () => {
  function Held({ onGestureStart = () => {} }: { onGestureStart?: () => void }) {
    const [db, setDb] = useState(0);
    return <div style={{ height: 264 }}><Fader label="Level" value={db} onChange={setDb} onGestureStart={onGestureStart} /></div>;
  }

  test("follows a drag by how far it moves, finer with Shift, within -60 to +6 dB", async () => {
    const started = vi.fn();
    const screen = render(<Held onGestureStart={started} />);
    const fader = screen.getByRole("slider", { name: "Level" });
    const el = fader.element() as HTMLElement;
    const box = el.getBoundingClientRect();
    const fire = (type: string, y: number, shiftKey = false) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: box.left + 5, clientY: y, shiftKey }));
    const y0 = box.top + box.height / 2;
    // The whole height is 66 dB: a quarter of it down is 16.5 dB.
    fire("pointerdown", y0);
    fire("pointermove", y0 + box.height / 4);
    fire("pointerup", y0 + box.height / 4);
    await expect.element(fader).toHaveAttribute("aria-valuetext", "-16.5 dB");
    fire("pointerdown", y0);
    fire("pointermove", y0 - box.height / 2, true);
    fire("pointerup", y0 - box.height / 2, true);
    await expect.element(fader).toHaveAttribute("aria-valuetext", "-13.2 dB");
    expect(started).toHaveBeenCalledTimes(2);
    fire("pointerdown", y0);
    fire("pointermove", y0 - box.height * 3);
    fire("pointerup", y0 - box.height * 3);
    await expect.element(fader).toHaveAttribute("aria-valuetext", "+6.0 dB");
  });

  test("Home and End go to the ends; at the bottom it reads off", async () => {
    const screen = render(<Held />);
    const fader = screen.getByRole("slider", { name: "Level" });
    (fader.element() as HTMLElement).focus();
    await userEvent.keyboard("{Home}");
    await expect.element(fader).toHaveAttribute("aria-valuetext", "-∞ dB");
    await userEvent.keyboard("{End}");
    await expect.element(fader).toHaveAttribute("aria-valuetext", "+6.0 dB");
  });
});
