import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("tone", () => ({}));
vi.mock("./workletLoader", () => ({ loadWorklet: vi.fn() }));

const { cpuReading, noteNativeLoad } = await import("./cpuMeter");

describe("the CPU meter with the native engine", () => {
  let now = 0;
  beforeEach(() => {
    now += 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the native engine's load from its statuses, in quarter-second readings", () => {
    expect(cpuReading()).toBeNull();
    // Statuses about a screen frame apart: 16 ms of audio each, 4 ms of it
    // busy, with one heavy stretch (the second reading).
    for (let i = 0; i < 96; i++) {
      noteNativeLoad(i >= 16 && i < 32 ? 12 : 4, 16);
      now += 16;
    }
    const reading = cpuReading();
    expect(reading?.source).toBe("native");
    // The last four readings, and the highest in the last three seconds.
    expect(reading?.average).toBeCloseTo(0.25, 5);
    expect(reading?.peak).toBeCloseTo(0.75, 5);
  });

  it("ignores statuses with no audio, and goes idle a second after they stop", () => {
    noteNativeLoad(3, 0);
    noteNativeLoad(Number.NaN, 16);
    expect(cpuReading()).toBeNull();
  });
});
