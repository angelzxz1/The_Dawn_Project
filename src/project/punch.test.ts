import { describe, expect, test } from "vitest";
import { punchedPasses, punchRecordFrom } from "./punch";
import { recordingPasses } from "./takes";

const punch = { start: 4, end: 8 };

describe("punch-in and punch-out", () => {
  test("off, the passes are kept as they are", () => {
    const passes = recordingPasses(2, 10, null);
    expect(punchedPasses(passes, null)).toBe(passes);
  });

  test("straight through, only the time between the punch-in and the punch-out is kept, from where it is in the recording", () => {
    // Recording from 2 s for 10 s: the take is 4 s to 8 s, 2 s into it.
    expect(punchedPasses(recordingPasses(2, 10, null), punch)).toEqual([{ start: 4, end: 8, at: 2 }]);
  });

  test("started inside the range, the take starts where recording did", () => {
    expect(punchedPasses(recordingPasses(5, 10, null), punch)).toEqual([{ start: 5, end: 8, at: 0 }]);
  });

  test("stopped before the punch-out, the take ends there", () => {
    expect(punchedPasses(recordingPasses(2, 4, null), punch)).toEqual([{ start: 4, end: 6, at: 2 }]);
  });

  test("stopped before the punch-in, or recorded past the punch-out, nothing is kept", () => {
    expect(punchedPasses(recordingPasses(0, 3, null), punch)).toEqual([]);
    expect(punchedPasses(recordingPasses(9, 3, null), punch)).toEqual([]);
  });

  test("with the loop on, the run-up before the first time round is left out, and each time round is a take", () => {
    // From 2 s, looping 4-8 s, for 14 s: 2-8 (the run-up and the first
    // time round), then 4-8 twice.
    const passes = recordingPasses(2, 14, punch);
    expect(punchedPasses(passes, punch)).toEqual([
      { start: 4, end: 8, at: 2 },
      { start: 4, end: 8, at: 6 },
      { start: 4, end: 8, at: 10 },
    ]);
  });

  test("recording starts at the marker, unless that's at or past the punch-out: then a bar before the punch-in", () => {
    expect(punchRecordFrom(1, punch, 2)).toBe(1);
    expect(punchRecordFrom(6, punch, 2)).toBe(6);
    expect(punchRecordFrom(8, punch, 2)).toBe(2);
    expect(punchRecordFrom(12, punch, 2)).toBe(2);
    // Never before the song's start.
    expect(punchRecordFrom(12, { start: 1, end: 3 }, 2)).toBe(0);
  });
});
