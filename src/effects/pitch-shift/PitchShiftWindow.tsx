"use client";

import { PluginWindow } from "@/effects/ui/PluginChrome";
import { PluginKnob, type KnobMode } from "@/ui/PluginKnob";
import { PitchShiftKeyboard } from "./PitchShiftKeyboard";
import { paramSpecs, type ParamSpec } from "@/effects/registry";
import { Segmented } from "@/effects/ui/PluginSegmented";
import { QUICK_SHIFTS, guitarTuning, shiftReadout } from "./pitchInterval";
import { PITCH_MODES, PITCH_MODE_LABELS, pitchMode } from "./pitchShiftKernel";

interface PitchShiftWindowProps {
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

export const PITCH_KNOBS: { key: string; mode: KnobMode }[] = [
  { key: "pitch", mode: "bipolar" },
  { key: "fine", mode: "bipolar" },
  { key: "window", mode: "log" },
  { key: "feedback", mode: "linear" },
  { key: "wet", mode: "linear" },
];

export function pitchSpec(key: string): ParamSpec {
  return paramSpecs("pitchShift").find((s) => s.key === key)!;
}

export function pitchParam(params: Record<string, number>, key: string): number {
  return params[key] ?? pitchSpec(key).default;
}

/** Pitch snaps to whole semitones and Fine to whole cents as they're
 * dragged or typed. */
export function snapPitchParam(key: string, value: number): number {
  return key === "pitch" || key === "fine" ? Math.round(value) : value;
}

/** What each mode is for, under the switch. */
const MODE_NOTES = {
  studio: "Studio: the most natural sound, chords included - every note shifted on its own. It delays the sound by a frame (about 85 ms), which Dawn lines up on playback; for playing through it live, use Live.",
  live: "Live: for playing through it, like a drop pedal - attacks come out about 3 ms after you play them. Chords are a little less clean than in Studio; Window sets how smooth the sustain is (longer is smoother, shorter tighter).",
};

/** The full Pitch Shift plugin window - the keyboard showing where C4
 * lands, the mode, quick shifts, five knobs with readouts, and the C4 ->
 * target readout - opened from the compact FX rack card's expand button. */
export function PitchShiftWindow({
  channelName,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
}: PitchShiftWindowProps) {
  const value = (key: string) => pitchParam(params, key);
  const pick = (key: string, v: number) => {
    onParamDragStart?.();
    onParamChange(key, v);
  };
  const engine = pitchMode(value("mode"));
  const tuning = guitarTuning(value("pitch"), value("fine"));
  const shift = Math.round(value("pitch"));

  return (
    <PluginWindow title="Pitch Shift" channelName={channelName} bypass={bypass} onBypassToggle={onBypassToggle} onClose={onClose} width={880}>
      <PitchShiftKeyboard pitch={value("pitch")} fine={value("fine")} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Mode" options={PITCH_MODES.map((m, i) => ({ value: i, label: PITCH_MODE_LABELS[m] }))} value={PITCH_MODES.indexOf(engine)} onSelect={(v) => pick("mode", v)} />
        <div className="flex gap-1" role="group" aria-label="Quick shifts">
          {QUICK_SHIFTS.map((st) => {
            const on = st === shift && Math.round(value("fine")) === 0;
            return (
              <button
                key={st}
                type="button"
                aria-pressed={on}
                title={st === 0 ? "No shift" : `${st > 0 ? "+" : ""}${st} semitones`}
                onClick={() => {
                  onParamDragStart?.();
                  onParamChange("pitch", st);
                  onParamChange("fine", 0);
                }}
                className="min-w-[34px] rounded-md px-1.5 py-1 font-mono text-[11px] font-bold"
                style={{ background: on ? "#2E2F37" : "transparent", color: on ? "#F4EDE2" : "#8A8A94", border: "1px solid #2E2F37" }}
              >
                {st > 0 ? `+${st}` : st === 0 ? "0" : `−${-st}`}
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-[12px] leading-snug text-muted">{MODE_NOTES[engine]}</p>

      <div className="flex justify-around px-1 pt-1">
        {PITCH_KNOBS.map(({ key, mode }) => {
          const spec = pitchSpec(key);
          return (
            <PluginKnob
              key={key}
              label={spec.label}
              value={value(key)}
              min={spec.min}
              max={spec.max}
              defaultValue={spec.default}
              mode={mode}
              size={54}
              showReadout
              onChange={(v) => onParamChange(key, snapPitchParam(key, v))}
              onDragStart={onParamDragStart}
              formatValue={spec.format}
              disabled={key === "window" && engine === "studio"}
            />
          );
        })}
      </div>

      <div style={{ height: 1, background: "#2E2F37" }} />

      <div className="flex justify-between gap-3">
        <span className="text-[12px] text-muted">{tuning ? `A guitar in E standard plays in ${tuning}` : ""}</span>
        <span className="font-mono text-[12px] text-muted">{shiftReadout(value("pitch"), value("fine"))}</span>
      </div>
    </PluginWindow>
  );
}
