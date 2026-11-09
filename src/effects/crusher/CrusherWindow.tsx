"use client";

import { useEffect, useRef } from "react";
import { PluginKnob } from "@/ui/PluginKnob";
import { PluginToggle, PluginWindow } from "@/effects/ui/PluginChrome";
import { Segmented } from "@/effects/ui/PluginSegmented";
import { audioEngine } from "@/engine/audioEngine";
import { paramSpecs, type ParamSpec } from "@/effects/registry";
import { CRUSHER_DISTS, CRUSHER_DIST_LABELS, CRUSHER_RATIO_LABELS, crusherDist, crusherRatioIndex } from "./crusherModel";
import { fraunces } from "@/ui/pluginFonts";

export function crusherSpec(key: string): ParamSpec {
  return paramSpecs("crusher").find((s) => s.key === key)!;
}

export function crusherValue(params: Record<string, number>, key: string): number {
  return params[key] ?? crusherSpec(key).default;
}

/** What the rack card's header says: the ratio (or British Mode), and the
 * distortion if one's on. */
export function crusherStatus(params: Record<string, number>): string {
  const dist = crusherDist(crusherValue(params, "dist"));
  const ratio = crusherValue(params, "british") >= 0.5 ? "British" : CRUSHER_RATIO_LABELS[crusherRatioIndex(crusherValue(params, "ratio"))];
  return dist === "clean" ? ratio : `${ratio} · ${CRUSHER_DIST_LABELS[dist]}`;
}

/** The gain reduction (dB) each LED lights at, like the hardware's
 * column. */
export const CRUSHER_LED_STEPS = [1, 2, 3, 4, 6, 8, 10, 14, 20, 30];
const ledOn = (i: number) => (i < 4 ? "#7FD46B" : i < 7 ? "#E6C04E" : "#FF5A5A");
const LED_OFF = "#2A2B33";

/** The gain-reduction LEDs, lit directly each frame with meter-like
 * ballistics. `width` sets the proportions; it fills its container's
 * width. */
export function CrusherLeds({ hostId, effectId, width = 320, height = 14 }: { hostId?: string; effectId: string; width?: number; height?: number }) {
  const leds = useRef<(SVGRectElement | null)[]>([]);
  useEffect(() => {
    let frame = 0;
    let shown = 0;
    const tick = () => {
      const target = (hostId ? audioEngine.getCrusherMeters(hostId, effectId) : null)?.gainReduction ?? 0;
      shown += (target - shown) * (target > shown ? 0.4 : 0.1);
      CRUSHER_LED_STEPS.forEach((step, i) => leds.current[i]?.setAttribute("fill", shown >= step * 0.94 ? ledOn(i) : LED_OFF));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hostId, effectId]);
  const n = CRUSHER_LED_STEPS.length;
  const gap = Math.max(2, width * 0.012);
  const w = (width - gap * (n - 1)) / n;
  const labels = height >= 14;
  const total = labels ? height + 14 : height;
  return (
    <svg viewBox={`0 0 ${width} ${total}`} preserveAspectRatio="none" role="img" aria-label="Gain reduction" style={{ display: "block", width: "100%", height: total }}>
      {CRUSHER_LED_STEPS.map((step, i) => (
        <g key={step}>
          <rect
            ref={(el) => {
              leds.current[i] = el;
            }}
            x={i * (w + gap)}
            y={0}
            width={w}
            height={height}
            rx={Math.min(3, height / 3)}
            fill={LED_OFF}
          />
          {labels && (
            <text x={i * (w + gap) + w / 2} y={height + 11} fill="#7A7A84" fontSize={9} fontFamily="monospace" textAnchor="middle">
              {step}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

const KNOBS = ["input", "attack", "release", "output"];

/** The full Crusher window: the faceplate's four knobs and Mix, the
 * gain-reduction LEDs, and the Ratio, Distortion, Detector and British
 * Mode switches. */
export function CrusherWindow({
  hostId,
  effectId,
  channelName,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
}: {
  hostId: string;
  effectId: string;
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}) {
  const value = (key: string) => crusherValue(params, key);
  const pick = (key: string, v: number) => {
    onParamDragStart?.();
    onParamChange(key, v);
  };
  const toggle = (key: string) => pick(key, value(key) >= 0.5 ? 0 : 1);
  const british = value("british") >= 0.5;
  const knob = (key: string, size: number) => {
    const spec = crusherSpec(key);
    return (
      <PluginKnob
        key={key}
        label={spec.label}
        value={value(key)}
        min={spec.min}
        max={spec.max}
        defaultValue={spec.default}
        mode="linear"
        size={size}
        showReadout
        onChange={(v) => onParamChange(key, v)}
        onDragStart={onParamDragStart}
        formatValue={spec.format}
      />
    );
  };
  const section = "text-[10px] font-semibold uppercase tracking-wider text-[#8A8A94]";

  return (
    <PluginWindow title="Crusher" channelName={channelName} bypass={bypass} onBypassToggle={onBypassToggle} onClose={onClose} width={860}>
      <div
        className="flex flex-col gap-4 rounded-xl px-5 pb-5 pt-4"
        style={{ background: "linear-gradient(180deg, #1F2128 0%, #15161B 100%)", border: "1px solid #34353D", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              aria-label={bypass ? "Off" : "On"}
              className="h-3 w-3 rounded-full"
              style={{ background: bypass ? "#2A2B33" : "#FF5A5A", boxShadow: bypass ? "none" : "0 0 10px 2px rgba(255,90,90,0.5)" }}
            />
            <span className={`${fraunces.className} text-[22px] font-semibold uppercase tracking-[0.3em]`} style={{ color: "#E4E6EC" }}>
              Crusher
            </span>
          </div>
          <PluginToggle
            label="British Mode"
            active={british}
            onClick={() => toggle("british")}
            title="Every ratio at once: past the threshold the loudest hits come out lower than the softer ones, and the release is twice as fast"
          />
        </div>
        <div className="flex items-end justify-between">
          {KNOBS.map((key) => knob(key, 60))}
          <div className="h-16 w-px self-center" style={{ background: "#2E2F37" }} />
          {knob("mix", 48)}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={section}>Gain reduction (dB)</span>
          <CrusherLeds hostId={bypass ? undefined : hostId} effectId={effectId} width={776} height={16} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl px-3.5 py-3" style={{ background: "#16171C", border: "1px solid #2A2B33" }}>
        <div className="flex flex-col gap-1.5" style={{ opacity: british ? 0.45 : 1 }}>
          <span className={section}>Ratio{british ? " (British Mode)" : ""}</span>
          <Segmented
            label="Ratio"
            options={CRUSHER_RATIO_LABELS.map((l, i) => ({ value: i, label: l }))}
            value={crusherRatioIndex(value("ratio"))}
            onSelect={(v) => pick("ratio", v)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={section}>Distortion</span>
          <Segmented
            label="Distortion"
            options={CRUSHER_DISTS.map((d, i) => ({ value: i, label: CRUSHER_DIST_LABELS[d] }))}
            value={CRUSHER_DISTS.indexOf(crusherDist(value("dist")))}
            onSelect={(v) => pick("dist", v)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={section}>Detector</span>
          <div className="flex gap-1.5">
            <PluginToggle label="HP" active={value("detHp") >= 0.5} onClick={() => toggle("detHp")} title="The detector hears less below 100 Hz, so the low end doesn't pump the rest" />
            <PluginToggle label="Band" active={value("detBand") >= 0.5} onClick={() => toggle("detBand")} title="The detector hears more around 6.8 kHz, so sibilance is compressed most: a de-esser" />
          </div>
        </div>
      </div>

      <p className="text-[12px] leading-snug text-muted">
        Input drives the audio into the threshold: turn it up for more compression, and Output down by as much to keep the level. 1:1
        doesn&apos;t compress, for the distortion alone; 2:1 releases like an opto, slower after a long squash. Dist 2 adds even harmonics
        (tube-like), Dist 3 odd ones (tape-like). Fast releases distort the low end on their own.
      </p>
    </PluginWindow>
  );
}
