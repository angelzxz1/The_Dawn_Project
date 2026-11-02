"use client";

import { PluginWindow } from "@/effects/ui/PluginChrome";
import { PluginKnob, type KnobMode } from "@/ui/PluginKnob";
import { GateGraph } from "./GateGraph";
import { paramSpecs, type ParamSpec } from "@/effects/registry";
import { HYSTERESIS_DB } from "./gateModel";
import { SidechainPanel, type SidechainSource } from "@/effects/sidechain/SidechainPanel";
import type { SidechainRouting } from "@/effects/sidechain/sidechainModel";

interface GateWindowProps {
  hostId: string;
  effectId: string;
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
  /** The key input's routing, and the tracks/buses it could come from. */
  sidechain?: SidechainRouting;
  sidechainSources: SidechainSource[];
  onSidechainChange: (routing: SidechainRouting) => void;
}

export const GATE_KNOBS: { key: string; mode: KnobMode }[] = [
  { key: "threshold", mode: "linear" },
  { key: "attack", mode: "log" },
  { key: "hold", mode: "linear" },
  { key: "release", mode: "log" },
  { key: "range", mode: "linear" },
];

export function gateSpec(key: string): ParamSpec {
  return paramSpecs("gate").find((s) => s.key === key)!;
}

export function gateParam(params: Record<string, number>, key: string): number {
  return params[key] ?? gateSpec(key).default;
}

/** The full Noise Gate window - the level/threshold history graph and five
 * knobs with readouts - opened from the compact FX rack card. */
export function GateWindow({
  hostId,
  effectId,
  channelName,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
  sidechain,
  sidechainSources,
  onSidechainChange,
}: GateWindowProps) {
  const value = (key: string) => gateParam(params, key);

  return (
    <PluginWindow title="Noise Gate" channelName={channelName} bypass={bypass} onBypassToggle={onBypassToggle} onClose={onClose} width={880}>
      <GateGraph hostId={hostId} effectId={effectId} thresholdDb={value("threshold")} />

      <div className="flex justify-around px-1 pt-1">
        {GATE_KNOBS.map(({ key, mode }) => {
          const spec = gateSpec(key);
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
              onChange={(v) => onParamChange(key, v)}
              onDragStart={onParamDragStart}
              formatValue={spec.format}
            />
          );
        })}
      </div>

      <SidechainPanel
        type="gate"
        hostId={hostId}
        effectId={effectId}
        params={params}
        routing={sidechain}
        sources={sidechainSources}
        onRoutingChange={onSidechainChange}
        onParamChange={onParamChange}
        onParamDragStart={onParamDragStart}
      />

      <div style={{ height: 1, background: "#2E2F37" }} />

      <p className="text-[12px] leading-snug text-muted">
        Opens above the threshold and closes once the level falls {HYSTERESIS_DB} dB below it, after Hold. For a
        guitar, put it before the amp: set Threshold just above the hiss you hear when you&apos;re not playing.
      </p>
    </PluginWindow>
  );
}
