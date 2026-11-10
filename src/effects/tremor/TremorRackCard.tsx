"use client";

import { PluginKnob } from "@/ui/PluginKnob";
import { RackCardHeader } from "@/effects/ui/PluginChrome";
import { TremorCurve, tremorSpec, tremorStatus, tremorValue } from "./TremorWindow";
import { spaceGrotesk } from "@/ui/pluginFonts";

const CARD_KNOBS = ["gain", "blend", "comp", "output"];

/** The compact Tremor in the FX rack: the EQ curve and four knobs (the
 * EQ knobs, the voice and its switches are in the window). */
export function TremorRackCard({
  params,
  bypass,
  onBypassToggle,
  onRemove,
  onExpand,
  onParamChange,
  onParamDragStart,
}: {
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
      <RackCardHeader title="Tremor" status={tremorStatus(params)} bypass={bypass} onBypassToggle={onBypassToggle} onRemove={onRemove} onExpand={onExpand} />
      <div className="flex items-center gap-2">
        <button type="button" onClick={onExpand} title="Open the Tremor" className="shrink-0">
          <TremorCurve params={params} width={104} height={72} />
        </button>
        <div className="grid flex-1 grid-cols-2 gap-x-1 gap-y-1.5">
          {CARD_KNOBS.map((key) => {
            const spec = tremorSpec(key);
            return (
              <PluginKnob
                key={key}
                label={spec.label}
                value={tremorValue(params, key)}
                min={spec.min}
                max={spec.max}
                defaultValue={spec.default}
                mode={key === "output" ? "bipolar" : "linear"}
                size={28}
                onChange={(v) => onParamChange(key, v)}
                onDragStart={onParamDragStart}
                formatValue={spec.format}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
