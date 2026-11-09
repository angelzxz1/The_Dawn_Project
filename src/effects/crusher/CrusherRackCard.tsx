"use client";

import { PluginKnob } from "@/ui/PluginKnob";
import { RackCardHeader } from "@/effects/ui/PluginChrome";
import { CrusherLeds, crusherSpec, crusherStatus, crusherValue } from "./CrusherWindow";
import { spaceGrotesk } from "@/ui/pluginFonts";

const CARD_KNOBS = ["input", "attack", "release", "output"];

/** The compact Crusher in the FX rack: the gain-reduction LEDs and the four
 * knobs (the switches and Mix are in the window). */
export function CrusherRackCard({
  hostId,
  effectId,
  params,
  bypass,
  onBypassToggle,
  onRemove,
  onExpand,
  onParamChange,
  onParamDragStart,
}: {
  hostId?: string;
  effectId: string;
  params: Record<string, number>;
  bypass: boolean;
  onBypassToggle: () => void;
  onRemove: () => void;
  onExpand: () => void;
  onParamChange: (key: string, value: number) => void;
  onParamDragStart?: () => void;
}) {
  return (
    <div className={`${spaceGrotesk.className} flex h-full flex-col gap-2`}>
      <RackCardHeader title="Crusher" status={crusherStatus(params)} bypass={bypass} onBypassToggle={onBypassToggle} onRemove={onRemove} onExpand={onExpand} />
      <button type="button" onClick={onExpand} title="Open the Crusher" className="block">
        <CrusherLeds hostId={bypass ? undefined : hostId} effectId={effectId} width={256} height={8} />
      </button>
      <div className="grid grid-cols-4 gap-x-1">
        {CARD_KNOBS.map((key) => {
          const spec = crusherSpec(key);
          return (
            <PluginKnob
              key={key}
              label={spec.label}
              value={crusherValue(params, key)}
              min={spec.min}
              max={spec.max}
              defaultValue={spec.default}
              mode="linear"
              size={30}
              onChange={(v) => onParamChange(key, v)}
              onDragStart={onParamDragStart}
              formatValue={spec.format}
            />
          );
        })}
      </div>
    </div>
  );
}
