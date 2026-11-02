"use client";

import { useState } from "react";
import { BookmarkPlus, ChevronDown, ChevronUp, GripVertical, SlashSquare } from "lucide-react";
import { ValueBar } from "@/studio/tracks/ValueBar";
import { carriesEffects, readEffectDrop, startRackDrag, type EffectDrop } from "./effectDrag";
import { effectMenuItems, rackMenuItems } from "./effectMenu";
import { ContextMenu } from "@/studio/shell/ContextMenu";
import { PresetMenu, type PresetChange } from "@/effects/ui/PresetMenu";
import { sidechainSourceName, type SidechainSource } from "@/effects/sidechain/SidechainPanel";
import { SIDECHAIN_TAPS, SIDECHAIN_TAP_LABELS, type SidechainTap } from "@/effects/sidechain/sidechainModel";
import type { EffectInstance, EffectType } from "@/effects/registry";
import { EFFECT_UI } from "@/effects/ui/registry";
import { INSTRUMENT_LABELS, INSTRUMENT_TYPES, type InstrumentSettings, type InstrumentType } from "@/instruments/registry";
import { INSTRUMENT_UI } from "@/instruments/ui/registry";
import type { BusConfig, ChannelType } from "@/project/types";
import type { TrackColor } from "@/project/colors";

interface FxRackProps {
  channelName: string;
  /** The engine id of the channel/bus/master whose effects these are - for
   * cards that show live readings (the Multiband's gain). */
  hostId?: string;
  /** Omitted for a bus's rack - buses have no instrument slot and can't
   * themselves send to another bus (keeps the send graph acyclic). */
  channelType?: ChannelType;
  color: TrackColor;
  instrument?: InstrumentType | null;
  /** The track's instrument settings (the synth's patch, the Drum Rack's
   * kit); the instrument's card reads its own. */
  instrumentSettings?: InstrumentSettings;
  effects: EffectInstance[];
  /** The project's current tempo - only used by the Delay card/window's
   * Sync mode (note-division knobs) and its "@ N BPM" readout. */
  bpm: number;
  buses?: BusConfig[];
  sends?: Record<string, number>;
  /** The sends taken before the fader (bus ids). */
  preSends?: string[];
  /** Takes a send before the fader, or after it. */
  onSendPreChange?: (busId: string, pre: boolean) => void;
  onInstrumentChange?: (type: InstrumentType | null) => void;
  /** Edits from the instrument's card (the synth's macro knobs). */
  onInstrumentSettingsChange?: (settings: InstrumentSettings) => void;
  /** Opens the instrument's own window (the synth, the Drum Rack). */
  onOpenInstrument?: () => void;
  onSendChange?: (busId: string, db: number | null) => void;
  /** `atIndex` omitted means "append at the end"; `presetId` loads that
   * preset into the new effect. */
  onAddEffect: (type: EffectType, atIndex?: number, presetId?: string) => void;
  onRemoveEffect: (effectId: string) => void;
  onMoveEffect: (effectId: string, toIndex: number) => void;
  /** Something else dropped at a place in the chain: a chain from the
   * browser, another rack's cards, or a card with Ctrl held (a copy). */
  onDropEffects?: (drop: EffectDrop, atIndex: number) => void;
  /** Copies effects, to paste on any chain. */
  onCopyEffects?: (effectIds: string[]) => void;
  /** Pastes what was copied at a place in the chain. */
  onPasteEffects?: (atIndex: number) => void;
  /** How many effects are copied (0: none). */
  copiedCount?: number;
  /** Saves the whole chain under a name, for any track. */
  onSaveChain?: (name: string) => void;
  /** Adds a copy of an effect right after it (its menu's Duplicate). */
  onDuplicateEffect?: (effectId: string) => void;
  onBypassToggle: (effectId: string) => void;
  onParamChange: (effectId: string, key: string, value: number) => void;
  /** Fired once at the start of a param drag/edit gesture - lets the caller
   * push one undo checkpoint per gesture. */
  onParamDragStart?: () => void;
  /** Opens the full plugin window (EQ Three, Compressor, ...) for one
   * effect instance that has a custom UI. */
  onOpenEffectWindow?: (effectId: string) => void;
  /** Loads an uploaded file (an IR) into a file-based effect; resolves with
   * an error message if the file can't be used. */
  onLoadEffectFile?: (effectId: string, file: File) => Promise<string | null>;
  onClearEffectFile?: (effectId: string) => void;
  /** Loads, saves or resets an effect's preset (see PresetMenu). */
  onPresetChange?: (effectId: string, change: PresetChange) => void;
  /** Tracks and buses, for naming a dynamics effect's sidechain source. */
  sidechainSources?: SidechainSource[];
  /** A track's "Audio to" choices ("" is the default: its group, or the
   * master) and the current one. Omitted for buses and the master. */
  /** An audio track's "Audio From" choices ("" is the audio interface),
   * the current source and where on it the audio is taken. */
  inputOptions?: { value: string; label: string }[];
  inputValue?: string;
  inputTap?: SidechainTap;
  onInputChange?: (track: string, tap: SidechainTap) => void;
  outputOptions?: { value: string; label: string }[];
  outputValue?: string;
  onOutputChange?: (value: string) => void;
  /** Folded away to its title bar (the project's layout keeps it). */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

const INSTRUMENT_OPTIONS: { type: InstrumentType | null; label: string; icon: React.ReactNode }[] = [
  { type: null, label: "None", icon: <SlashSquare size={12} /> },
  ...INSTRUMENT_TYPES.map((type) => {
    const Icon = INSTRUMENT_UI[type].icon;
    return { type, label: INSTRUMENT_LABELS[type], icon: <Icon size={12} /> };
  }),
];

const SEND_OFF_DB = -60;
const SEND_MIN_DB = -60;

/** A narrow drop target sitting between (or at either end of) the device
 * cards - dropping an effect (from the sidebar, or reordering an existing
 * one) here inserts it at exactly this position in the chain. Highlights
 * while something's dragged over it, like Ableton's insertion marker. */
function DropGap({
  index,
  active,
  onDragOverGap,
  onDropAt,
}: {
  index: number;
  active: boolean;
  onDragOverGap: (index: number | null) => void;
  onDropAt: (index: number, e: React.DragEvent) => void;
}) {
  return (
    <div
      data-drop-gap={index}
      onDragOver={(e) => {
        if (!carriesEffects(e)) return;
        e.preventDefault();
        onDragOverGap(index);
      }}
      onDragLeave={() => onDragOverGap(null)}
      onDrop={(e) => {
        e.preventDefault();
        onDropAt(index, e);
      }}
      className="relative w-2 shrink-0 self-stretch"
    >
      {active && <div className="absolute inset-y-1 left-1/2 w-0.5 -translate-x-1/2 rounded bg-accent" />}
    </div>
  );
}

/**
 * An Ableton-style device chain, docked to the bottom of the screen: for a
 * MIDI track, an instrument card first (which can be left empty, or loaded
 * with the synth's own sound-design panel), then an ordered row of
 * individually-bypassable effect cards - audio tracks and buses only get
 * the effects row. Drop a device from the EffectBrowser sidebar anywhere
 * in the row to add it there; drag an existing card to reorder it. A track
 * (not a bus) also gets a trailing Sends card, one level per existing bus.
 */
export function FxRack({
  channelName,
  hostId,
  channelType,
  color,
  instrument,
  instrumentSettings,
  effects,
  bpm,
  buses = [],
  sends = {},
  preSends = [],
  onSendPreChange,
  onInstrumentChange,
  onInstrumentSettingsChange,
  onOpenInstrument,
  onSendChange,
  onAddEffect,
  onRemoveEffect,
  onMoveEffect,
  onDropEffects,
  onCopyEffects,
  onPasteEffects,
  copiedCount = 0,
  onSaveChain,
  onDuplicateEffect,
  onBypassToggle,
  onParamChange,
  onParamDragStart,
  onOpenEffectWindow,
  onLoadEffectFile,
  onClearEffectFile,
  sidechainSources,
  onPresetChange,
  inputOptions,
  inputValue = "",
  inputTap = "postFx",
  onInputChange,
  outputOptions,
  outputValue = "",
  onOutputChange,
  collapsed = false,
  onCollapsedChange,
}: FxRackProps) {
  const [dragOverGap, setDragOverGap] = useState<number | null>(null);
  /** The effect whose right-click menu is open, and where. */
  const [menu, setMenu] = useState<{ effectId: string | null; x: number; y: number } | null>(null);
  /** The name being typed for the chain to save (null: not saving). */
  const [chainName, setChainName] = useState<string | null>(null);
  const isBus = channelType === undefined;

  const handleDropAt = (index: number, e: React.DragEvent) => {
    setDragOverGap(null);
    const drop = readEffectDrop(e);
    if (!drop) return;
    if (drop.kind === "effect") onAddEffect(drop.type, index, drop.preset);
    else if (drop.kind === "rack" && drop.host === (hostId ?? "") && !drop.copy) drop.ids.forEach((id) => onMoveEffect(id, index));
    else onDropEffects?.(drop, index);
  };

  const saveChain = () => {
    if (chainName !== null && chainName.trim()) onSaveChain?.(chainName.trim());
    setChainName(null);
  };

  return (
    <div
      className={`flex shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface ${
        collapsed ? "" : "h-[256px]"
      }`}
    >
      <div className="flex items-center border-b border-border bg-surface-raised">
        <button
          type="button"
          onClick={() => onCollapsedChange?.(!collapsed)}
          title={collapsed ? "Expand the FX rack" : "Collapse the FX rack"}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left"
        >
          {collapsed ? <ChevronUp size={12} className="shrink-0 text-muted" /> : <ChevronDown size={12} className="shrink-0 text-muted" />}
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color.accent }} />
          <span className="shrink-0 text-xs font-medium">FX — {channelName}</span>
          {!collapsed && chainName === null && (
            <span className="truncate text-[10px] text-muted">
              drag a device from the sidebar into the rack; drag a card to reorder it, or onto another track to move it (Ctrl: copy)
            </span>
          )}
        </button>
        {onSaveChain && effects.length > 0 && !collapsed &&
          (chainName === null ? (
            <button
              type="button"
              onClick={() => setChainName(channelName)}
              title="Save this chain of effects under a name, to add to any track (it shows in the browser's Chains)"
              className="mr-2 flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted hover:border-accent hover:text-accent"
            >
              <BookmarkPlus size={11} />
              Save chain
            </button>
          ) : (
            <form
              className="mr-2 flex shrink-0 items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                saveChain();
              }}
            >
              <input
                autoFocus
                aria-label="Chain name"
                value={chainName}
                maxLength={60}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setChainName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setChainName(null);
                }}
                className="w-40 rounded border border-accent bg-surface px-1 py-0.5 text-[11px] outline-none"
              />
              <button type="submit" className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-on-accent">
                Save
              </button>
              <button type="button" onClick={() => setChainName(null)} className="rounded px-1 py-0.5 text-[10px] text-muted hover:text-foreground">
                Cancel
              </button>
            </form>
          ))}
        {inputOptions && onInputChange && (
          <label
            className="mr-3 flex shrink-0 items-center gap-1.5 text-[10px] text-muted"
            title="Where this track's input comes from: the audio interface, or another track - taken before its effects (Pre FX), after them (Post FX) or after its fader. Monitor to hear it through this track's effects; Record to record it."
          >
            Audio from
            <select
              value={inputOptions.some((o) => o.value === inputValue) ? inputValue : ""}
              onChange={(e) => onInputChange(e.target.value, inputTap)}
              className="max-w-[150px] rounded border border-border bg-surface px-1 py-0.5 text-[11px] text-foreground"
            >
              {inputOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {inputValue && (
              <select
                aria-label="Where on that track"
                value={inputTap}
                onChange={(e) => onInputChange(inputValue, e.target.value as SidechainTap)}
                className="rounded border border-border bg-surface px-1 py-0.5 text-[11px] text-foreground"
              >
                {SIDECHAIN_TAPS.map((tap) => (
                  <option key={tap} value={tap}>
                    {SIDECHAIN_TAP_LABELS[tap]}
                  </option>
                ))}
              </select>
            )}
          </label>
        )}
        {outputOptions && onOutputChange && (
          <label
            className="mr-2 flex shrink-0 items-center gap-1.5 text-[10px] text-muted"
            title="Where this track's audio goes: the master, its group, or another track (whose effects then process it too)"
          >
            Audio to
            <select
              value={outputOptions.some((o) => o.value === outputValue) ? outputValue : ""}
              onChange={(e) => onOutputChange(e.target.value)}
              className="max-w-[160px] rounded border border-border bg-surface px-1 py-0.5 text-[11px] text-foreground"
            >
              {outputOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!collapsed && (
      <div
        className="flex flex-1 items-stretch gap-0 overflow-x-auto p-2"
        onContextMenu={(e) => {
          // A card's own menu (or a knob's) comes first.
          if (e.defaultPrevented || !onPasteEffects) return;
          e.preventDefault();
          setMenu({ effectId: null, x: e.clientX, y: e.clientY });
        }}
      >
        {channelType === "midi" && (
          <div
            role="group"
            aria-label="Instrument"
            className={`flex ${instrument ? INSTRUMENT_UI[instrument].slotWidth : "w-56"} device-skin shrink-0 flex-col rounded border border-border bg-surface-raised p-2`}
          >
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Instrument
            </div>
            <div className="mb-1.5 flex overflow-hidden rounded border border-border">
              {INSTRUMENT_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  aria-pressed={instrument === opt.type}
                  onClick={() => onInstrumentChange?.(opt.type)}
                  className={`flex flex-1 items-center justify-center gap-1 border-l border-border py-1.5 text-[11px] first:border-l-0 ${
                    instrument === opt.type
                      ? "bg-accent/25 text-accent"
                      : "text-muted hover:bg-surface"
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
            {instrument === null && (
              <p className="text-[11px] text-muted">No instrument loaded — this track stays silent.</p>
            )}
            {instrument &&
              (() => {
                const { RackCard } = INSTRUMENT_UI[instrument];
                return (
                  RackCard && (
                    <RackCard
                      channelId={hostId}
                      settings={instrumentSettings ?? {}}
                      onSettingsChange={onInstrumentSettingsChange}
                      onDragStart={onParamDragStart}
                      onOpen={onOpenInstrument}
                    />
                  )
                );
              })()}
          </div>
        )}

        <DropGap index={0} active={dragOverGap === 0} onDragOverGap={setDragOverGap} onDropAt={handleDropAt} />

        {effects.map((fx, i) => (
          <div key={fx.id} className="flex items-stretch">
            <div
              className="relative flex shrink-0"
              onContextMenu={(e) => {
                // A knob's own right-click (typing a value) comes first.
                if (e.defaultPrevented) return;
                e.preventDefault();
                setMenu({ effectId: fx.id, x: e.clientX, y: e.clientY });
              }}
            >
              <div
                className={`device-skin flex shrink-0 rounded-xl ${EFFECT_UI[fx.type].cardWidth} ${fx.bypass ? "opacity-50" : ""}`}
                style={{ background: "#1B1C22", border: "1px solid #2E2F37" }}
              >
                <div
                  draggable
                  onDragStart={(e) => startRackDrag(e, hostId ?? "", [fx.id])}
                  title="Drag to reorder"
                  className="flex w-3 shrink-0 cursor-grab items-center justify-center rounded-l hover:bg-black/10 active:cursor-grabbing"
                >
                  <GripVertical size={10} className="text-muted" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col p-2.5 pl-1.5">
                  <div className="flex min-h-0 flex-1 flex-col">
                  {(() => {
                    const { RackCard } = EFFECT_UI[fx.type];
                    return (
                      <RackCard
                        hostId={hostId}
                        effectId={fx.id}
                        params={fx.params}
                        bypass={!!fx.bypass}
                        bpm={bpm}
                        file={fx.file}
                        sidechainName={sidechainSourceName(fx.sidechain, sidechainSources ?? [])}
                        onBypassToggle={() => onBypassToggle(fx.id)}
                        onRemove={() => onRemoveEffect(fx.id)}
                        onExpand={() => onOpenEffectWindow?.(fx.id)}
                        onParamChange={(key, v) => onParamChange(fx.id, key, v)}
                        onParamDragStart={onParamDragStart}
                        onLoadFile={(file) => onLoadEffectFile?.(fx.id, file) ?? Promise.resolve("Can't load files here.")}
                        onClearFile={() => onClearEffectFile?.(fx.id)}
                      />
                    );
                  })()}
                  </div>
                  {onPresetChange && (
                    <div className="mt-1.5">
                      <PresetMenu variant="rack" effect={fx} bpm={bpm} onChange={(change) => onPresetChange(fx.id, change)} />
                    </div>
                  )}
                </div>
              </div>
              {fx.bypass && (
                // Undimmed, over the dimmed card: it isn't playing.
                <span
                  role="status"
                  title="Bypassed: this effect isn't playing. Turn it back on with its power button."
                  className="pointer-events-none absolute bottom-1.5 right-2 rounded border border-[#E6AD5E]/50 bg-[#1B1C22] px-1 text-[9px] font-medium text-[#E6AD5E]"
                >
                  Bypassed
                </span>
              )}
            </div>
            <DropGap
              index={i + 1}
              active={dragOverGap === i + 1}
              onDragOverGap={setDragOverGap}
              onDropAt={handleDropAt}
            />
          </div>
        ))}

        {effects.length === 0 && (
          <div
            onDragOver={(e) => {
              if (carriesEffects(e)) e.preventDefault();
            }}
            onDrop={(e) => handleDropAt(0, e)}
            className="flex w-56 shrink-0 items-center justify-center rounded border border-dashed border-border text-[11px] text-muted"
          >
            Drag effects here
          </div>
        )}

        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            items={
              menu.effectId === null
                ? rackMenuItems(effects.length, { paste: onPasteEffects, copied: copiedCount })
                : effectMenuItems(effects, menu.effectId, {
                    open: (id) => onOpenEffectWindow?.(id),
                    toggleBypass: onBypassToggle,
                    move: onMoveEffect,
                    duplicate: (id) => onDuplicateEffect?.(id),
                    reset: onPresetChange ? (id, params) => onPresetChange(id, { params, preset: undefined }) : undefined,
                    remove: onRemoveEffect,
                    copy: onCopyEffects,
                    paste: onPasteEffects,
                    copied: copiedCount,
                  })
            }
          />
        )}

        {!isBus && buses.length > 0 && onSendChange && (
          <div className="flex max-h-[214px] w-[172px] shrink-0 flex-col self-start rounded border border-border bg-surface-raised p-2">
            <div className="mb-1.5 flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-wide text-muted">
              Sends
              {buses.length > 6 && <span className="font-normal normal-case tracking-normal text-muted/70">{buses.length} buses · scroll</span>}
            </div>
            {/* Many buses scroll inside the card instead of growing past the rack. */}
            <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-x-1.5 gap-y-2 overflow-y-auto overflow-x-hidden pr-0.5">
              {buses.map((bus) => {
                const on = sends[bus.id] !== undefined;
                const pre = preSends.includes(bus.id);
                return (
                  <div key={bus.id} role="group" aria-label={`Send to ${bus.name}`} className="flex flex-col gap-0.5">
                    <ValueBar
                      label={bus.name}
                      value={sends[bus.id] ?? SEND_OFF_DB}
                      min={SEND_MIN_DB}
                      max={0}
                      defaultValue={SEND_OFF_DB}
                      onChange={(v) => onSendChange(bus.id, v <= SEND_MIN_DB ? null : v)}
                      onDragStart={onParamDragStart}
                      formatValue={(v) => (v <= SEND_MIN_DB ? "off" : `${v.toFixed(1)}dB`)}
                    />
                    {on && onSendPreChange && (
                      <button
                        type="button"
                        aria-pressed={pre}
                        aria-label={`Take the send to ${bus.name} before the fader`}
                        onClick={() => onSendPreChange(bus.id, !pre)}
                        title={
                          pre
                            ? "Pre-fader: the bus gets the track at this level whatever its fader and pan do (a headphone mix, or a reverb that rings on as the track fades). Click for post-fader."
                            : "Post-fader: the send follows the track's fader. Click to take it before the fader."
                        }
                        className={`self-start rounded border px-1 text-[8.5px] font-semibold uppercase leading-[13px] tracking-wide ${
                          pre ? "border-warn/60 bg-warn/15 text-warn" : "border-border text-muted hover:text-foreground"
                        }`}
                      >
                        {pre ? "Pre" : "Post"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

