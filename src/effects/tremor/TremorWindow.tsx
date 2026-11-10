"use client";

import { useMemo } from "react";
import { PluginKnob, type KnobMode } from "@/ui/PluginKnob";
import { PluginToggle, PluginWindow } from "@/effects/ui/PluginChrome";
import { Segmented } from "@/effects/ui/PluginSegmented";
import { paramSpecs, type ParamSpec } from "@/effects/registry";
import {
  TREMOR_ATTACK_LABELS,
  TREMOR_GRUNT_LABELS,
  TREMOR_MID_LABELS,
  TREMOR_ULTRA_LO_LABELS,
  TREMOR_VOICES,
  TREMOR_VOICE_LABELS,
  tremorEqCurve,
  tremorMidIndex,
  tremorSwitch,
  tremorVoice,
  type TremorVoice,
} from "./tremorModel";
import { fraunces } from "@/ui/pluginFonts";

export function tremorSpec(key: string): ParamSpec {
  return paramSpecs("tremor").find((s) => s.key === key)!;
}

export function tremorValue(params: Record<string, number>, key: string): number {
  return params[key] ?? tremorSpec(key).default;
}

/** What the rack card's header says: the voice. */
export function tremorStatus(params: Record<string, number>): string {
  return TREMOR_VOICE_LABELS[tremorVoice(tremorValue(params, "voice"))];
}

const ACCENT = "#5AA8FF";
const F_MIN = 30;
const F_MAX = 12000;
const CURVE_POINTS = 96;
const CURVE_FREQS = Array.from({ length: CURVE_POINTS }, (_, i) => F_MIN * Math.pow(F_MAX / F_MIN, i / (CURVE_POINTS - 1)));
const GRID_FREQS = [50, 100, 300, 1000, 3000, 10000];
/** dB above and below 0 the graph spans. */
const RANGE_DB = 18;
const CURVE_KEYS = ["voice", "bass", "mid", "midFreq", "treble", "ultraLo", "ultraHi"];

/** The EQ's curve (the three bands and the Tube voice's Ultra switches). */
export function TremorCurve({ params, width, height, labels = false }: { params: Record<string, number>; width: number; height: number; labels?: boolean }) {
  const values = CURVE_KEYS.map((k) => tremorValue(params, k));
  const key = values.join(",");
  const path = useMemo(() => {
    const p = Object.fromEntries(CURVE_KEYS.map((k, i) => [k, values[i]]));
    return tremorEqCurve(p, CURVE_FREQS)
      .map((d, i) => {
        const x = (i / (CURVE_POINTS - 1)) * width;
        const y = height / 2 - (d / RANGE_DB) * (height / 2);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${Math.min(height, Math.max(0, y)).toFixed(1)}`;
      })
      .join(" ");
    // `key` stands for the values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, width, height]);
  const xOf = (f: number) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * width;
  return (
    <svg width={width} height={height} className="block rounded-lg" style={{ background: "#121419" }} aria-label="EQ curve">
      {GRID_FREQS.map((f) => (
        <g key={f}>
          <line x1={xOf(f)} x2={xOf(f)} y1={0} y2={height} stroke="#22252D" />
          {labels && (
            <text x={xOf(f) + 3} y={height - 4} fill="#5A5E6A" fontSize={9}>
              {f >= 1000 ? `${f / 1000}k` : f}
            </text>
          )}
        </g>
      ))}
      <line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke="#22252D" />
      <path d={`${path} L${width},${height} L0,${height} Z`} fill="rgba(90,168,255,0.12)" />
      <path d={path} fill="none" stroke={ACCENT} strokeWidth={labels ? 2 : 1.5} />
    </svg>
  );
}

const KNOBS: { key: string; mode: KnobMode }[] = [
  { key: "gain", mode: "linear" },
  { key: "blend", mode: "linear" },
  { key: "comp", mode: "linear" },
  { key: "bass", mode: "bipolar" },
  { key: "mid", mode: "bipolar" },
  { key: "treble", mode: "bipolar" },
  { key: "output", mode: "bipolar" },
];

const SPLIT_KNOBS: { key: string; mode: KnobMode }[] = [
  { key: "lowSplit", mode: "log" },
  { key: "highSplit", mode: "log" },
  { key: "midLevel", mode: "bipolar" },
  { key: "highLevel", mode: "bipolar" },
];

/** A line about each voice, under the curve. */
const VOICE_NOTES: Record<TremorVoice, string> = {
  tube: "Tube is a tube preamp: warm and round, breaking up gently as Gain rises. Ultra Lo's Deep adds lows and scoops the mids; Tight cuts the lows. Ultra Hi lifts the top.",
  grind: "Grind is a blend drive: the clean bass stays under a hard, aggressive distortion. Grunt sets how much low end the drive gets (Raw keeps it tight, Fat makes it huge), Attack the top going in.",
  split: "Split keeps the lows clean and compressed and distorts the mids and highs on their own: set where the bands split, and how loud the distorted mids and highs are. Blend is the clean lows against them.",
};

/** The Tremor's full window: the faceplate with the Voice switch and the
 * seven knobs, the voice's own switches and controls, the EQ curve. */
export function TremorWindow({
  channelName,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
}: {
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}) {
  const value = (key: string) => tremorValue(params, key);
  const pick = (key: string, v: number) => {
    onParamDragStart?.();
    onParamChange(key, v);
  };
  const voice = tremorVoice(value("voice"));
  const knob = ({ key, mode }: { key: string; mode: KnobMode }, size: number) => {
    const spec = tremorSpec(key);
    return (
      <PluginKnob
        key={key}
        label={voice === "split" && key === "blend" ? "Low Blend" : spec.label}
        value={value(key)}
        min={spec.min}
        max={spec.max}
        defaultValue={spec.default}
        mode={mode}
        size={size}
        showReadout
        onChange={(v) => onParamChange(key, v)}
        onDragStart={onParamDragStart}
        formatValue={spec.format}
      />
    );
  };
  const section = "text-[10px] font-semibold uppercase tracking-wider text-[#8A8A94]";
  const switches = (key: string, label: string, labels: string[], fallback = 1) => (
    <div className="flex flex-col gap-1.5">
      <span className={section}>{label}</span>
      <Segmented label={label} options={labels.map((l, i) => ({ value: i, label: l }))} value={tremorSwitch(value(key), fallback)} onSelect={(v) => pick(key, v)} />
    </div>
  );

  return (
    <PluginWindow title="Tremor" channelName={channelName} bypass={bypass} onBypassToggle={onBypassToggle} onClose={onClose} width={860}>
      <div
        className="flex flex-col gap-4 rounded-xl px-5 pb-5 pt-4"
        style={{ background: "linear-gradient(180deg, #1D222B 0%, #14171D 100%)", border: "1px solid #303644", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}
      >
        <div className="flex min-h-[34px] items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              aria-label={bypass ? "Standby" : "On"}
              className="h-3 w-3 rounded-full"
              style={{ background: bypass ? "#232B38" : ACCENT, boxShadow: bypass ? "none" : "0 0 10px 2px rgba(90,168,255,0.5)" }}
            />
            <span className={`${fraunces.className} text-[22px] font-semibold uppercase tracking-[0.3em]`} style={{ color: "#DCE6F2" }}>
              Tremor
            </span>
          </div>
          <Segmented
            label="Voice"
            options={TREMOR_VOICES.map((v, i) => ({ value: i, label: TREMOR_VOICE_LABELS[v] }))}
            value={TREMOR_VOICES.indexOf(voice)}
            onSelect={(v) => pick("voice", v)}
          />
        </div>
        <div className="flex justify-between">{KNOBS.map((k) => knob(k, 54))}</div>
      </div>

      <div className="flex min-h-[118px] flex-wrap items-center gap-x-6 gap-y-3 rounded-xl px-3.5 py-3" style={{ background: "#15171C", border: "1px solid #2A2D35" }}>
        <div className="flex flex-col gap-1.5">
          <span className={section}>Mid freq (Hz)</span>
          <Segmented label="Mid frequency" options={TREMOR_MID_LABELS.map((l, i) => ({ value: i, label: l }))} value={tremorMidIndex(value("midFreq"))} onSelect={(v) => pick("midFreq", v)} />
        </div>
        <div className="h-10 w-px" style={{ background: "#2A2D35" }} />
        {voice === "tube" && (
          <>
            {switches("ultraLo", "Ultra Lo", TREMOR_ULTRA_LO_LABELS, 0)}
            <div className="flex flex-col gap-1.5">
              <span className={section}>Ultra Hi</span>
              <PluginToggle label="Ultra Hi" active={value("ultraHi") >= 0.5} onClick={() => pick("ultraHi", value("ultraHi") >= 0.5 ? 0 : 1)} title="A lift at the very top, for slap and pick attack" />
            </div>
          </>
        )}
        {voice === "grind" && (
          <>
            {switches("grunt", "Grunt", TREMOR_GRUNT_LABELS)}
            {switches("attack", "Attack", TREMOR_ATTACK_LABELS)}
          </>
        )}
        {voice === "split" && <div className="flex flex-1 justify-around">{SPLIT_KNOBS.map((k) => knob(k, 44))}</div>}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">EQ</span>
        <TremorCurve params={params} width={816} height={110} labels />
      </div>
      <p className="text-[12px] leading-snug text-muted">
        {VOICE_NOTES[voice]} The Tremor is the amp alone: put an IR Loader after it with one of the bass cabinets (the <span className="text-foreground">8x10</span> or the{" "}
        <span className="text-foreground">1x15</span>), or add the Bass chain, which comes with one.
      </p>
    </PluginWindow>
  );
}
