// Punch-in and punch-out, as in Ableton: with Punch on, a recording keeps
// only what was played between the loop brace's ends. The transport starts
// where it always does (the marker), so the song before the punch-in is a
// run-up to play along with; past the punch-out it plays on, and nothing
// more is kept. With the loop on as well, each time round is a take, as
// without Punch, and the run-up before the first is left out.

import type { RecordedPass } from "./takes";
import type { TimeRange } from "./timeRange";

const EPS = 1e-6;

/** The passes of a recording, each cut to the punch range (s): what was
 * recorded before the punch-in and after the punch-out is left out, and a
 * pass outside it altogether makes no take. */
export function punchedPasses(passes: RecordedPass[], punch: TimeRange | null): RecordedPass[] {
  if (!punch) return passes;
  return passes.flatMap((pass) => {
    const start = Math.max(pass.start, punch.start);
    const end = Math.min(pass.end, punch.end);
    if (end - start <= EPS) return [];
    return [{ start, end, at: pass.at + (start - pass.start) }];
  });
}

/** Where recording starts (s) with Punch on: at the marker, unless that's
 * at or past the punch-out, where nothing would be kept; then a bar before
 * the punch-in (`runUp`), or the song's start. */
export function punchRecordFrom(marker: number, punch: TimeRange, runUp: number): number {
  if (marker < punch.end - EPS) return marker;
  return Math.max(0, punch.start - runUp);
}
