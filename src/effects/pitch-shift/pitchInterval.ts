import { midiToNoteName } from "../../instruments/piano/piano";

/** The Pitch Shift window treats C4 as the note being shifted. */
export const PITCH_REFERENCE_MIDI = 60;

const INTERVAL_NAMES = [
  "Unison",
  "Minor 2nd",
  "Major 2nd",
  "Minor 3rd",
  "Major 3rd",
  "Perfect 4th",
  "Tritone",
  "Perfect 5th",
  "Minor 6th",
  "Major 6th",
  "Minor 7th",
  "Major 7th",
];

/** The nearest whole-semitone interval and what's left over in cents. */
export function splitShift(pitch: number, fine: number): { semitones: number; cents: number } {
  const total = Math.round(pitch) + Math.round(fine) / 100;
  const semitones = Math.round(total);
  return { semitones, cents: Math.round((total - semitones) * 100) };
}

/** e.g. "Unison", "+7 st · Perfect 5th up", "-12 st · Octave down". */
export function intervalLabel(semitones: number): string {
  if (semitones === 0) return "Unison";
  const size = Math.abs(semitones);
  const octaves = Math.floor(size / 12);
  const rest = size % 12;
  const octaveName = octaves === 1 ? "Octave" : `${octaves} Octaves`;
  const name =
    octaves === 0 ? INTERVAL_NAMES[rest] : rest === 0 ? octaveName : `${octaveName} + ${INTERVAL_NAMES[rest]}`;
  return `${semitones > 0 ? "+" : "-"}${size} st · ${name} ${semitones > 0 ? "up" : "down"}`;
}

/** e.g. "C4 → C4", "C4 → G4", "C4 → D#4 -12 ct". */
export function shiftReadout(pitch: number, fine: number): string {
  const { semitones, cents } = splitShift(pitch, fine);
  const target = midiToNoteName(PITCH_REFERENCE_MIDI + semitones);
  const centsText = cents === 0 ? "" : ` ${cents > 0 ? "+" : ""}${cents} ct`;
  return `${midiToNoteName(PITCH_REFERENCE_MIDI)} → ${target}${centsText}`;
}

/** The shifts a drop pedal offers, for the window's quick buttons. */
export const QUICK_SHIFTS = [-12, -7, -5, -4, -3, -2, -1, 0, 2, 5, 7, 12];

const TUNINGS: Record<number, string> = {
  0: "E standard",
  [-1]: "E♭ standard (half step down)",
  [-2]: "D standard (whole step down)",
  [-3]: "C♯ standard",
  [-4]: "C standard",
  [-5]: "B standard",
  [-6]: "B♭ standard",
  [-7]: "A standard",
  [-12]: "An octave down (baritone to bass)",
};

/** What a guitar in E standard is tuned to after the shift, e.g. "D
 * standard (whole step down)"; null when it isn't a common tuning. */
export function guitarTuning(pitch: number, fine: number): string | null {
  const { semitones, cents } = splitShift(pitch, fine);
  return cents === 0 ? (TUNINGS[semitones] ?? null) : null;
}
