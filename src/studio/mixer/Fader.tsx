"use client";

import { useRef } from "react";
import { FINE_FACTOR } from "@/ui/knobInput";
import { useKnobWheel } from "@/ui/useKnobWheel";
import { METER_FLOOR_DB, METER_TOP_DB, meterFraction } from "@/studio/tracks/meterScale";

interface FaderProps {
  /** What it sets, for screen readers ("Bass volume"). */
  label: string;
  /** dB, from -60 (off) to +6: the meter's own scale, so the cap sits
   * level with the meter's marks beside it. */
  value: number;
  onChange: (db: number) => void;
  /** Fired once at the start of a gesture (a drag, a key, a wheel turn, a
   * reset), for one undo step per gesture. */
  onGestureStart?: () => void;
}

const MIN = METER_FLOOR_DB;
const MAX = METER_TOP_DB;
const KEY_STEP_DB = 0.5;
const PAGE_STEP_DB = 3;

/** "-6.0 dB", "-∞ dB": the fader's level, said and shown. */
export function faderText(db: number): string {
  return db <= MIN ? "-∞ dB" : `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;
}

const clamp = (db: number) => Math.min(MAX, Math.max(MIN, db));

/** A mixer's vertical fader. Drag it (Shift: fine), scroll it, or use the
 * arrow keys (Page Up and Down: 3 dB); double-click puts it back at 0 dB. */
export function Fader({ label, value, onChange, onGestureStart }: FaderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ lastY: number; db: number; started: boolean } | null>(null);
  const db = clamp(value);

  useKnobWheel(trackRef, meterFraction(db), (position, fresh) => {
    if (fresh) onGestureStart?.();
    onChange(clamp(MIN + position * (MAX - MIN)));
  });

  const nudge = (by: number) => {
    onGestureStart?.();
    onChange(clamp(db + by));
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={Math.round(db * 10) / 10}
      aria-valuetext={faderText(db)}
      title="Drag or scroll to change the level (Shift: fine) · double-click for 0 dB"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // A synthetic pointer can't be captured; the drag still works.
        }
        drag.current = { lastY: e.clientY, db, started: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const height = trackRef.current?.clientHeight ?? 0;
        if (!d || height === 0 || e.clientY === d.lastY) return;
        if (!d.started) {
          d.started = true;
          onGestureStart?.();
        }
        // Step by step, so Shift can come and go mid-drag.
        const step = ((d.lastY - e.clientY) / height) * (MAX - MIN) * (e.shiftKey ? FINE_FACTOR : 1);
        d.lastY = e.clientY;
        d.db = clamp(d.db + step);
        onChange(d.db);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={() => {
        onGestureStart?.();
        onChange(0);
      }}
      onKeyDown={(e) => {
        const fine = e.shiftKey ? FINE_FACTOR : 1;
        if (e.key === "ArrowUp" || e.key === "ArrowRight") nudge(KEY_STEP_DB * fine);
        else if (e.key === "ArrowDown" || e.key === "ArrowLeft") nudge(-KEY_STEP_DB * fine);
        else if (e.key === "PageUp") nudge(PAGE_STEP_DB);
        else if (e.key === "PageDown") nudge(-PAGE_STEP_DB);
        else if (e.key === "Home") nudge(MIN - db);
        else if (e.key === "End") nudge(MAX - db);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      className="relative h-full w-6 shrink-0 cursor-ns-resize touch-none select-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {/* The groove, and 0 dB across it. */}
      <div className="absolute inset-y-1 left-1/2 w-1 -translate-x-1/2 rounded-full bg-background ring-1 ring-border" />
      <div aria-hidden className="absolute left-0.5 right-0.5 h-px bg-foreground/30" style={{ bottom: `${meterFraction(0) * 100}%` }} />
      <div
        aria-hidden
        className="absolute left-0 right-0 h-3 translate-y-1/2 rounded-[3px] border border-border bg-surface-raised shadow-md"
        style={{ bottom: `${meterFraction(db) * 100}%` }}
      >
        <div className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-foreground/70" />
      </div>
    </div>
  );
}
