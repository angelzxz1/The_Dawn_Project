"use client";

import { useMemo } from "react";
import { PluginKnob, type KnobMode } from "@/ui/PluginKnob";
import { PluginWindow } from "@/effects/ui/PluginChrome";
import { Segmented } from "@/effects/ui/PluginSegmented";
import { paramSpecs, type ParamSpec } from "@/effects/registry";
import {
  AMP_MODELS,
  AMP_MODEL_LABELS,
  AMP_MODES,
  AMP_MODE_LABELS,
  AMP_RECTIFIERS,
  AMP_RECTIFIER_LABELS,
  ampMatchingCab,
  ampMode,
  ampModel,
  ampPresenceLabel,
  ampRectifier,
  ampToneCurve,
} from "./ampModel";
import { factoryCab } from "../ir-loader/cabIrs";
import { fraunces } from "@/ui/pluginFonts";

export function furnaceSpec(key: string): ParamSpec {
  return paramSpecs("tubeAmp").find((s) => s.key === key)!;
}

export function furnaceValue(params: Record<string, number>, key: string): number {
  return params[key] ?? furnaceSpec(key).default;
}

/** A knob's label: Presence is Cut on the Chime. */
export function furnaceLabel(params: Record<string, number>, key: string): string {
  return key === "presence" ? ampPresenceLabel(ampModel(params.amp)) : furnaceSpec(key).label;
}

/** What the rack card's header says: the amp, or on the High Gain head
 * its channel and rectifier. */
export function furnaceStatus(params: Record<string, number>): string {
  const model = ampModel(params.amp);
  if (model !== "highGain") return AMP_MODEL_LABELS[model];
  return `${AMP_MODE_LABELS[ampMode(params.mode)]} · ${AMP_RECTIFIER_LABELS[ampRectifier(params.rectifier)]}`;
}

const KNOBS: { key: string; mode: KnobMode }[] = [
  { key: "gain", mode: "linear" },
  { key: "bass", mode: "linear" },
  { key: "mid", mode: "linear" },
  { key: "treble", mode: "linear" },
  { key: "presence", mode: "linear" },
  { key: "master", mode: "linear" },
  { key: "output", mode: "bipolar" },
];

/** A line about each amp, under the curve. */
const AMP_NOTES: Record<ReturnType<typeof ampModel>, string> = {
  clean: "Clean American stays clean to about 5 on Gain and breaks up from 7; Gain is its volume, so it gets louder as it goes, and the bright cap lifts the top at low settings.",
  chime: "Chime breaks up early and sweetly, with even harmonics from its class A power amp. Cut darkens it: turn it up to tame the top.",
  crunch: "British Crunch goes from edge-of-breakup at 3 to a thick rhythm crunch at 7 and up; Middle does a lot.",
  lead: "British Lead is the crunch head with a fourth stage: saturated from about 3, for leads and tight rhythm.",
  highGain: "High Gain is the modern head: Raw, Vintage and Modern channels and the rectifier switch.",
};

const F_MIN = 40;
const F_MAX = 12000;
const CURVE_POINTS = 96;
const CURVE_FREQS = Array.from({ length: CURVE_POINTS }, (_, i) => F_MIN * Math.pow(F_MAX / F_MIN, i / (CURVE_POINTS - 1)));
const GRID_FREQS = [100, 300, 1000, 3000, 10000];
/** dB above and below the curve's middle the graph spans. */
const RANGE_DB = 18;

/** The tone controls' combined curve (the stack after the distortion, plus
 * presence and depth), centered on its own average level. */
export function FurnaceCurve({ params, width, height, labels = false }: { params: Record<string, number>; width: number; height: number; labels?: boolean }) {
  const { bass, mid, treble, presence, mode, amp } = {
    bass: furnaceValue(params, "bass"),
    mid: furnaceValue(params, "mid"),
    treble: furnaceValue(params, "treble"),
    presence: furnaceValue(params, "presence"),
    mode: furnaceValue(params, "mode"),
    amp: furnaceValue(params, "amp"),
  };
  const path = useMemo(() => {
    const db = ampToneCurve({ bass, mid, treble, presence, mode, amp }, CURVE_FREQS);
    const center = (Math.max(...db) + Math.min(...db)) / 2;
    return db
      .map((d, i) => {
        const x = (i / (CURVE_POINTS - 1)) * width;
        const y = height / 2 - ((d - center) / RANGE_DB) * (height / 2);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${Math.min(height, Math.max(0, y)).toFixed(1)}`;
      })
      .join(" ");
  }, [bass, mid, treble, presence, mode, amp, width, height]);
  const xOf = (f: number) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * width;
  return (
    <svg width={width} height={height} className="block rounded-lg" style={{ background: "#141519" }} aria-label="Tone curve">
      {GRID_FREQS.map((f) => (
        <g key={f}>
          <line x1={xOf(f)} x2={xOf(f)} y1={0} y2={height} stroke="#24252C" />
          {labels && (
            <text x={xOf(f) + 3} y={height - 4} fill="#5A5B64" fontSize={9}>
              {f >= 1000 ? `${f / 1000}k` : f}
            </text>
          )}
        </g>
      ))}
      <line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke="#24252C" />
      <path d={`${path} L${width},${height} L0,${height} Z`} fill="rgba(230,120,60,0.12)" />
      <path d={path} fill="none" stroke="#E8823C" strokeWidth={labels ? 2 : 1.5} />
    </svg>
  );
}

/** The Furnace's full window: a faceplate with the Amp selector (and on
 * the High Gain head the channel and rectifier switches), the seven knobs,
 * the tone curve, and which cabinet goes with the amp. */
export function FurnaceWindow({
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
  const value = (key: string) => furnaceValue(params, key);
  const pick = (key: string, v: number) => {
    onParamDragStart?.();
    onParamChange(key, v);
  };
  const model = ampModel(value("amp"));
  const cab = factoryCab(ampMatchingCab(model));
  return (
    <PluginWindow title="Furnace" channelName={channelName} bypass={bypass} onBypassToggle={onBypassToggle} onClose={onClose} width={860}>
      <div
        className="flex flex-col gap-4 rounded-xl px-5 pb-5 pt-4"
        style={{ background: "linear-gradient(180deg, #24242A 0%, #18181D 100%)", border: "1px solid #34353D", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}
      >
        <div className="flex min-h-[34px] items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              aria-label={bypass ? "Standby" : "On"}
              className="h-3 w-3 rounded-full"
              style={{ background: bypass ? "#3A2A22" : "#FF7A2E", boxShadow: bypass ? "none" : "0 0 10px 2px rgba(255,122,46,0.55)" }}
            />
            <span className={`${fraunces.className} text-[22px] font-semibold uppercase tracking-[0.3em]`} style={{ color: "#E8DCCB" }}>
              Furnace
            </span>
          </div>
          {model === "highGain" && (
            <div className="flex items-center gap-3">
              <Segmented
                label="Channel mode"
                options={AMP_MODES.map((m, i) => ({ value: i, label: AMP_MODE_LABELS[m] }))}
                value={AMP_MODES.indexOf(ampMode(value("mode")))}
                onSelect={(v) => pick("mode", v)}
              />
              <Segmented
                label="Rectifier"
                options={AMP_RECTIFIERS.map((r, i) => ({ value: i, label: AMP_RECTIFIER_LABELS[r] }))}
                value={AMP_RECTIFIERS.indexOf(ampRectifier(value("rectifier")))}
                onSelect={(v) => pick("rectifier", v)}
              />
            </div>
          )}
        </div>
        <Segmented
          label="Amp"
          options={AMP_MODELS.map((m, i) => ({ value: i, label: AMP_MODEL_LABELS[m] }))}
          value={AMP_MODELS.indexOf(model)}
          onSelect={(v) => pick("amp", v)}
        />
        <div className="flex justify-between">
          {KNOBS.map(({ key, mode }) => {
            const spec = furnaceSpec(key);
            return (
              <PluginKnob
                key={key}
                label={furnaceLabel(params, key)}
                value={value(key)}
                min={spec.min}
                max={spec.max}
                defaultValue={spec.default}
                mode={mode}
                size={54}
                showReadout
                onChange={(v) => onParamChange(key, v)}
                onDragStart={onParamDragStart}
                formatValue={spec.format}
              />
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Tone controls</span>
        <FurnaceCurve params={params} width={816} height={120} labels />
      </div>
      <p className="text-[12px] leading-snug text-muted">
        {AMP_NOTES[model]} The Furnace is the amp alone: put an IR Loader after it with a cabinet{cab ? <> (this amp&apos;s is the <span className="text-foreground">{cab.name}</span>)</> : null}, or add one of the guitar chains, which come with theirs.
      </p>
    </PluginWindow>
  );
}
