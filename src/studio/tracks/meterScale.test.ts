import { describe, expect, it } from "vitest";
import { dbOf, formatDb, holdPeak, meterFraction, PEAK_HOLD } from "./meterScale";

describe("the meter's scale", () => {
  it("reads amplitudes in dB, and places them from -60 at the bottom to +6 at the top", () => {
    expect(dbOf(1)).toBe(0);
    expect(dbOf(0.5)).toBeCloseTo(-6.02, 2);
    expect(dbOf(0)).toBe(-Infinity);
    expect(meterFraction(-Infinity)).toBe(0);
    expect(meterFraction(-60)).toBe(0);
    expect(meterFraction(0)).toBeCloseTo(60 / 66, 6);
    expect(meterFraction(12)).toBe(1);
  });

  it("writes levels with their sign, and silence as -∞", () => {
    expect(formatDb(-3.24)).toBe("-3.2");
    expect(formatDb(1)).toBe("+1.0");
    expect(formatDb(-Infinity)).toBe("-∞");
  });

  it("holds a peak, then lets it fall, and a louder one takes over at once", () => {
    let held = holdPeak({ db: -Infinity, age: 0 }, -6, 0.016);
    expect(held.db).toBe(-6);
    held = holdPeak(held, -30, PEAK_HOLD.seconds - 0.1);
    expect(held.db).toBe(-6);
    held = holdPeak(held, -30, 0.6);
    expect(held.db).toBeCloseTo(-6 - PEAK_HOLD.fallDbPerSecond * 0.5, 6);
    // It never falls below what's playing.
    held = holdPeak(held, -10, 5);
    expect(held.db).toBe(-10);
    expect(holdPeak(held, -1, 0.016)).toEqual({ db: -1, age: 0 });
  });
});
