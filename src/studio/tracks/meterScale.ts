// How the meters show a level: in dB, from -60 at the bottom to +6 at the
// top (over 0 dBFS is clipping), the colors' zones, and how a peak is held
// and falls.

export const METER_FLOOR_DB = -60;
export const METER_TOP_DB = 6;

/** Marks on the scale, in dB. */
export const METER_TICKS = [0, -6, -12, -24, -48] as const;

/** The level where green turns yellow, and yellow red. */
export const METER_ZONES = { yellow: -18, red: -6 } as const;

/** At or over this a sample is clipping (0 dBFS). */
export const CLIP_LEVEL = 1;

/** A held peak stays this long (s), then falls this fast (dB a second). */
export const PEAK_HOLD = { seconds: 1.5, fallDbPerSecond: 20 } as const;

/** An amplitude (1 = full scale) in dB; -Infinity for silence. */
export function dbOf(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
}

/** How far up the meter a level sits, 0-1. */
export function meterFraction(db: number): number {
  if (!(db > METER_FLOOR_DB)) return 0;
  return Math.min(1, (db - METER_FLOOR_DB) / (METER_TOP_DB - METER_FLOOR_DB));
}

/** "-3.2", "+1.0", "-∞": a level for a readout. */
export function formatDb(db: number): string {
  if (!Number.isFinite(db) || db <= METER_FLOOR_DB - 30) return "-∞";
  return `${db > 0 ? "+" : ""}${db.toFixed(1)}`;
}

/** A held peak after `dt` seconds: a louder level takes over at once; else
 * it stays for PEAK_HOLD.seconds, then falls. */
export function holdPeak(held: { db: number; age: number }, db: number, dt: number): { db: number; age: number } {
  if (db >= held.db) return { db, age: 0 };
  const age = held.age + dt;
  const falling = Math.max(0, age - PEAK_HOLD.seconds);
  const fallen = held.db - PEAK_HOLD.fallDbPerSecond * Math.min(falling, dt);
  return { db: Math.max(db, fallen), age };
}

/** The meter's colors, bottom to top, for a CSS gradient. */
export function meterGradient(direction: "to top" | "to right"): string {
  const at = (db: number) => `${(meterFraction(db) * 100).toFixed(1)}%`;
  return `linear-gradient(${direction}, #4ade80 0%, #4ade80 ${at(METER_ZONES.yellow)}, #facc15 ${at(METER_ZONES.yellow)}, #facc15 ${at(METER_ZONES.red)}, #fb923c ${at(METER_ZONES.red)}, #fb923c ${at(0)}, #ff5a5a ${at(0)}, #ff5a5a 100%)`;
}
