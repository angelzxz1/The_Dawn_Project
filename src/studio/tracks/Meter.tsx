"use client";

import { useEffect, useRef, useState } from "react";
import { audioEngine } from "@/engine/audioEngine";
import type { MeterReading } from "@/engine/levelMeter";
import {
  CLIP_LEVEL,
  dbOf,
  formatDb,
  holdPeak,
  METER_FLOOR_DB,
  METER_TICKS,
  METER_TOP_DB,
  meterFraction,
  meterGradient,
} from "./meterScale";

interface MeterProps {
  /** A track's id, a bus's (`{ bus }`), or the master's. */
  source: string | { bus: string } | "master";
  /** The dB marks written beside it, for a tall meter (the mixer's): on a
   * short one the top marks crowd together. */
  scale?: boolean;
}

const SIDES = ["Left", "Right"] as const;
const TITLE_EVERY_MS = 250;

function read(source: MeterProps["source"]): MeterReading {
  if (source === "master") return audioEngine.getMasterMeter();
  if (typeof source === "object") return audioEngine.getBusMeter(source.bus);
  return audioEngine.getMeter(source);
}

const key = (source: MeterProps["source"]) => (typeof source === "object" ? `bus:${source.bus}` : source);

/** A level meter on a dB scale (-60 to +6): left and right, each the
 * level's RMS (solid) and its peaks (paler) over it, with the loudest peak
 * held a moment. Over 0 dB the clip light turns red and stays red until
 * clicked; the tooltip has the figures. */
export function Meter({ source, scale = false }: MeterProps) {
  const rmsRefs = useRef<(HTMLDivElement | null)[]>([]);
  const peakRefs = useRef<(HTMLDivElement | null)[]>([]);
  const holdRefs = useRef<(HTMLDivElement | null)[]>([]);
  const sideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  /** The loudest peak since the clip light was last reset (dB). */
  const maxRef = useRef(-Infinity);
  const sourceKey = key(source);
  const sourceRef = useRef(source);
  useEffect(() => {
    sourceRef.current = source;
  });

  useEffect(() => {
    let frame = 0;
    let last: number | null = null;
    let titled = 0;
    const held = [
      { db: -Infinity, age: 0 },
      { db: -Infinity, age: 0 },
    ];
    const tick = (now: number) => {
      const dt = last === null ? 0 : (now - last) / 1000;
      last = now;
      const reading = read(sourceRef.current);
      reading.peak.forEach((peak, side) => {
        const peakDb = dbOf(peak);
        const rmsDb = dbOf(reading.rms[side]);
        held[side] = holdPeak(held[side], peakDb, dt);
        if (peakDb > maxRef.current) maxRef.current = peakDb;
        const rms = rmsRefs.current[side];
        if (rms) rms.style.clipPath = `inset(${(1 - meterFraction(rmsDb)) * 100}% 0 0 0)`;
        const pk = peakRefs.current[side];
        if (pk) pk.style.clipPath = `inset(${(1 - meterFraction(peakDb)) * 100}% 0 0 0)`;
        const hold = holdRefs.current[side];
        if (hold) {
          hold.style.bottom = `calc(${meterFraction(held[side].db) * 100}% - 1px)`;
          hold.style.opacity = held[side].db > METER_FLOOR_DB ? "1" : "0";
        }
        sideRefs.current[side]?.setAttribute("aria-valuenow", String(Math.max(METER_FLOOR_DB, Math.round(peakDb * 10) / 10)));
      });
      if (reading.peak.some((p) => p >= CLIP_LEVEL)) setClipped(true);
      if (now - titled > TITLE_EVERY_MS && rootRef.current) {
        titled = now;
        const peak = Math.max(...held.map((h) => h.db));
        const rms = dbOf(Math.max(...reading.rms));
        rootRef.current.title = `Peak ${formatDb(peak)} dB · RMS ${formatDb(rms)} dB · loudest ${formatDb(maxRef.current)} dB`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sourceKey]);

  return (
    <div ref={rootRef} className="flex h-full shrink-0 gap-0.5" onClick={(e) => e.stopPropagation()}>
      {scale && (
        <div aria-hidden className="relative h-full w-4 font-mono text-[7px] leading-none text-muted">
          {METER_TICKS.map((db) => (
            <span key={db} className="absolute right-0 translate-y-1/2" style={{ bottom: `calc(${meterFraction(db) * 100}% - ${meterFraction(db) * 4}px)` }}>
              {db}
            </span>
          ))}
        </div>
      )}
      <div className="flex h-full w-3 flex-col gap-px">
        <button
          type="button"
          aria-label={clipped ? "Clipped - click to reset" : "Clip light"}
          title={clipped ? "Went over 0 dB (the meter says how loud it got): turn it down. Click to reset." : "Lights up if the level goes over 0 dB"}
          onClick={() => {
            setClipped(false);
            maxRef.current = -Infinity;
          }}
          className={`h-[3px] w-full shrink-0 rounded-[1px] ${clipped ? "bg-record" : "bg-border"}`}
        />
        <div className="relative flex min-h-0 flex-1 gap-px overflow-hidden rounded-sm border border-border bg-background">
          {SIDES.map((side, i) => (
            <div
              key={side}
              ref={(el) => {
                sideRefs.current[i] = el;
              }}
              role="meter"
              aria-label={`${side} level`}
              aria-valuemin={METER_FLOOR_DB}
              aria-valuemax={METER_TOP_DB}
              aria-valuenow={METER_FLOOR_DB}
              className="relative h-full flex-1"
            >
              <div
                ref={(el) => {
                  peakRefs.current[i] = el;
                }}
                className="absolute inset-0 opacity-45"
                style={{ clipPath: "inset(100% 0 0 0)", background: meterGradient("to top") }}
              />
              <div
                ref={(el) => {
                  rmsRefs.current[i] = el;
                }}
                className="absolute inset-0"
                style={{ clipPath: "inset(100% 0 0 0)", background: meterGradient("to top") }}
              />
              <div
                ref={(el) => {
                  holdRefs.current[i] = el;
                }}
                className="absolute left-0 h-[2px] w-full bg-foreground/80"
                style={{ bottom: "0%", opacity: 0 }}
              />
            </div>
          ))}
          {METER_TICKS.map((db) => (
            <div key={db} aria-hidden className="pointer-events-none absolute inset-x-0 h-px bg-foreground/15" style={{ bottom: `${meterFraction(db) * 100}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
