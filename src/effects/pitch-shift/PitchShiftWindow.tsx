"use client";

import { PluginWindow } from "@/effects/ui/PluginChrome";
import { PluginKnob, type KnobMode } from "@/ui/PluginKnob";
import { PitchShiftKeyboard } from "./PitchShiftKeyboard";
import { paramSpecs, type ParamSpec } from "@/effects/registry";
import { shiftReadout } from "./pitchInterval";

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

/** The full Pitch Shift plugin window - the keyboard showing where C4
 * lands, five knobs with readouts, and the C4 -> target readout - opened
 * from the compact FX rack card's expand button. */
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

  return (
    <PluginWindow title="Pitch Shift" channelName={channelName} bypass={bypass} onBypassToggle={onBypassToggle} onClose={onClose} width={880}>
      <PitchShiftKeyboard pitch={value("pitch")} fine={value("fine")} />

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
            />
          );
        })}
      </div>

      <div style={{ height: 1, background: "#2E2F37" }} />

      <div className="flex justify-end">
        <span className="font-mono text-[12px] text-muted">{shiftReadout(value("pitch"), value("fine"))}</span>
      </div>
    </PluginWindow>
  );
}
