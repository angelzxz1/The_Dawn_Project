// The Preferences window on its own, with the engine stood in for: its
// tabs, and each setting changing this computer's settings (audioPrefs.ts,
// studioPrefs.ts).

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "@vitest/browser/context";
import { useState } from "react";

const engine = vi.hoisted(() => ({ canChoose: true, setOutputDevice: vi.fn(async () => null as string | null) }));
vi.mock("@/engine/audioEngine", () => ({
  audioEngine: {
    getLatencyInfo: () => ({ sampleRate: 48000, output: 0.02, input: 0.01, effects: 0, compensated: 0 }),
    getRoundTrip: () => ({ seconds: 0.03, measured: false }),
    canChooseOutput: () => engine.canChoose,
    setOutputDevice: engine.setOutputDevice,
    measureRoundTrip: async () => null,
  },
}));

import { PreferencesWindow } from "./PreferencesWindow";
import type { PrefsTab } from "./preferences";
import { DEFAULT_AUDIO_PREFS, getAudioPrefs, updateAudioPrefs } from "@/engine/audioPrefs";
import { DEFAULT_STUDIO_PREFS, getStudioPrefs, updateStudioPrefs } from "@/state/studioPrefs";

beforeEach(() => {
  updateAudioPrefs(DEFAULT_AUDIO_PREFS);
  updateStudioPrefs(DEFAULT_STUDIO_PREFS);
  engine.canChoose = true;
  engine.setOutputDevice.mockClear();
});

function Window({ start = "audio", onClose = () => {} }: { start?: PrefsTab; onClose?: () => void }) {
  const [tab, setTab] = useState<PrefsTab>(start);
  return <PreferencesWindow tab={tab} onTab={setTab} onClose={onClose} />;
}

describe("the Preferences window", () => {
  test("its tabs show their settings; Esc closes it", async () => {
    const onClose = vi.fn();
    const screen = render(<Window onClose={onClose} />);
    await expect.element(screen.getByRole("tabpanel", { name: "Audio" })).toBeVisible();
    await screen.getByRole("tab", { name: "Projects" }).click();
    await expect.element(screen.getByRole("tabpanel", { name: "Projects" })).toHaveTextContent("Autosave");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  test("Audio: delay compensation, the output and the buffer size", async () => {
    const screen = render(<Window />);
    await screen.getByRole("switch", { name: "Delay compensation" }).click();
    expect(getAudioPrefs().delayCompensation).toBe(false);

    await screen.getByRole("combobox", { name: "Output device" }).selectOptions("System default");
    expect(engine.setOutputDevice).toHaveBeenCalledWith(null);

    // A new buffer is used after a reload, which it offers.
    await expect.element(screen.getByRole("button", { name: "Reload" })).not.toBeInTheDocument();
    await screen.getByRole("combobox", { name: "Buffer size" }).selectOptions("playback");
    expect(getAudioPrefs().browserLatency).toBe("playback");
    await expect.element(screen.getByRole("button", { name: "Reload" })).toBeVisible();
  });

  test("Audio: where the browser can't choose an output, it says so", async () => {
    engine.canChoose = false;
    const screen = render(<Window />);
    await expect.element(screen.getByRole("combobox", { name: "Output device" })).toBeDisabled();
    await expect.element(screen.getByText(/always plays through the system's output/)).toBeVisible();
  });

  test("Recording: the offset, and the note after a take", async () => {
    const screen = render(<Window start="recording" />);
    await userEvent.fill(screen.getByRole("spinbutton", { name: "Recording offset in milliseconds" }), "12.5");
    await userEvent.keyboard("{Enter}");
    expect(getAudioPrefs().recordingOffsetMs).toBe(12.5);
    await screen.getByRole("switch", { name: "Offer to measure after a take" }).click();
    expect(getAudioPrefs().latencyHintDismissed).toBe(true);
  });

  test("Metronome: the click's sound", async () => {
    const screen = render(<Window start="metronome" />);
    await screen.getByRole("combobox", { name: "Click sound" }).selectOptions("wood");
    expect(getAudioPrefs().metronomeSound).toBe("wood");
  });

  test("Appearance: the theme; in a browser, its zoom sets the size", async () => {
    const screen = render(<Window start="appearance" />);
    await screen.getByRole("radio", { name: "Light" }).click();
    expect(getStudioPrefs().theme).toBe("light");
    await expect.element(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
    await expect.element(screen.getByText(/browser's zoom/)).toBeVisible();
    await expect.element(screen.getByRole("combobox", { name: "Interface size" })).not.toBeInTheDocument();
  });

  test("Projects: autosave and the count-in for new projects", async () => {
    const screen = render(<Window start="projects" />);
    await screen.getByRole("combobox", { name: "Autosave" }).selectOptions("Every 5 minutes");
    await screen.getByRole("combobox", { name: "Count-in for new projects" }).selectOptions("2 bars");
    expect(getStudioPrefs()).toMatchObject({ autosaveMinutes: 5, defaultCountInBars: 2 });
  });
});
