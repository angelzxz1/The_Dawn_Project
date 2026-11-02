"use client";

import { PluginWindow } from "@/effects/ui/PluginChrome";
import { PluginKnob } from "@/ui/PluginKnob";
import { EQThreeGraph } from "./EQThreeGraph";
import { paramSpecs } from "@/effects/registry";

interface EQThreeWindowProps {
  channelName: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}

/** The full EQ Three plugin window - a live frequency-response preview
 * plus every knob with its numeric readout, opened from the compact FX
 * rack card's expand button. */
export function EQThreeWindow({
  channelName,
  params,
  bypass,
  onBypassToggle,
  onClose,
  onParamChange,
  onParamDragStart,
}: EQThreeWindowProps) {
  const specs = paramSpecs("eq3");
  const [lowSpec, midSpec, highSpec, lowXSpec, highXSpec] = specs;
  const value = (key: string, fallback: number) => params[key] ?? fallback;

  return (
    <PluginWindow title="EQ Three" channelName={channelName} bypass={bypass} onBypassToggle={onBypassToggle} onClose={onClose} width={380}>
      <EQThreeGraph
        low={value("low", lowSpec.default)}
        mid={value("mid", midSpec.default)}
        high={value("high", highSpec.default)}
        lowFrequency={value("lowFrequency", lowXSpec.default)}
        highFrequency={value("highFrequency", highXSpec.default)}
      />

      <div className="flex justify-between px-3.5 pt-0.5">
        {[lowSpec, midSpec, highSpec].map((spec) => (
          <PluginKnob
            key={spec.key}
            label={spec.label}
            value={value(spec.key, spec.default)}
            min={spec.min}
            max={spec.max}
            defaultValue={spec.default}
            mode="bipolar"
            size={58}
            showReadout
            onChange={(v) => onParamChange(spec.key, v)}
            onDragStart={onParamDragStart}
            formatValue={spec.format}
          />
        ))}
      </div>

      <div style={{ height: 1, background: "#2E2F37" }} />

      <div className="flex justify-between px-1">
        {[lowXSpec, highXSpec].map((spec) => (
          <PluginKnob
            key={spec.key}
            label={spec.label}
            value={value(spec.key, spec.default)}
            min={spec.min}
            max={spec.max}
            defaultValue={spec.default}
            mode="log"
            size={44}
            showReadout
            layout="inline"
            onChange={(v) => onParamChange(spec.key, v)}
            onDragStart={onParamDragStart}
            formatValue={spec.format}
          />
        ))}
      </div>
    </PluginWindow>
  );
}
