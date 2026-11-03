"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { audioEngine } from "@/engine/audioEngine";
import { useHostWindow } from "@/ui/hostWindow";
import { SILENT_LOUDNESS, type LoudnessReading } from "@/engine/loudness";
import { CLIP_LEVEL, dbOf, formatDb } from "./meterScale";

const lufs = (v: number) => (Number.isFinite(v) && v > -70 ? v.toFixed(1) : "–");

/** The master's loudness, as streaming services measure it (LUFS): the
 * momentary (the last 0.4 s), the short-term (the last 3 s) and the
 * integrated (all of it since playback started over), and the
 * loudest sample. */
export function LoudnessReadout() {
  const [reading, setReading] = useState<LoudnessReading>(SILENT_LOUDNESS);
  // The window it's in keeps time: the main one's slows down when hidden.
  const host = useHostWindow();
  useEffect(() => {
    const timer = host.setInterval(() => setReading(audioEngine.getLoudness()), 100);
    return () => host.clearInterval(timer);
  }, [host]);
  const over = reading.peak >= CLIP_LEVEL;
  const cell = (label: string, value: string, title: string, strong = false) => (
    <span title={title} className="flex flex-col items-center leading-none">
      <span className="text-[8px] uppercase tracking-wide text-muted">{label}</span>
      <span className={`font-mono text-[11px] tabular-nums ${strong ? "font-semibold text-foreground" : "text-foreground/85"}`}>{value}</span>
    </span>
  );
  return (
    <div
      role="group"
      aria-label="Loudness"
      className="flex shrink-0 items-center gap-2 rounded border border-border px-2 py-0.5"
      title="Loudness in LUFS. Streaming services play songs at about -14 integrated, so a louder mix gets turned down. It starts afresh each time playback starts over (not after a pause)."
    >
      {cell("M", lufs(reading.momentary), "Momentary loudness: the last 0.4 s (LUFS)")}
      {cell("S", lufs(reading.shortTerm), "Short-term loudness: the last 3 s (LUFS)")}
      {cell("Int", lufs(reading.integrated), "Integrated loudness: all of it since playback started (LUFS)", true)}
      <span className="text-[9px] text-muted">LUFS</span>
      <span
        title={over ? "The mix went over 0 dB: it clips. Lower the master or tracks (the limiter's ceiling keeps it under)" : "The loudest sample since playback started"}
        className="flex flex-col items-center leading-none"
      >
        <span className="text-[8px] uppercase tracking-wide text-muted">Peak</span>
        <span className={`font-mono text-[11px] tabular-nums ${over ? "font-semibold text-record" : "text-foreground/85"}`}>{formatDb(dbOf(reading.peak))}</span>
      </span>
      <button
        type="button"
        onClick={() => {
          audioEngine.resetLoudness();
          setReading(audioEngine.getLoudness());
        }}
        aria-label="Reset the loudness"
        title="Start measuring afresh"
        className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-surface-raised hover:text-foreground"
      >
        <RotateCcw size={11} />
      </button>
    </div>
  );
}
