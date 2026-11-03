"use client";

// The mixer view: a channel strip for every track, then the send/return
// buses, then the master at the right. Each strip has, top to bottom, where
// its audio comes from and goes, its inserts (instrument and effects), its
// sends, pan, mute/solo/arm, and its fader beside its meter. It's the same
// project as the arrangement's headers and the FX rack, so a change in one
// shows in the others; clicking a strip shows its FX rack.

import { useState } from "react";
import { Circle, Plus, X } from "lucide-react";
import { EFFECT_LABELS, type EffectInstance } from "@/effects/registry";
import { SIDECHAIN_TAPS, SIDECHAIN_TAP_LABELS, type SidechainTap } from "@/effects/sidechain/sidechainModel";
import { INSTRUMENT_LABELS } from "@/instruments/registry";
import { INSTRUMENT_UI } from "@/instruments/ui/registry";
import { MASTER_COLOR, trackColorOf, type TrackColor } from "@/project/colors";
import type { BusConfig, ChannelConfig } from "@/project/types";
import { useProjectValue } from "@/state/projectStore";
import { carriesEffects, readEffectDrop, type EffectDrop } from "@/studio/rack/effectDrag";
import { EffectDropMark, effectDropHint, type EffectDropHint } from "@/studio/tracks/EffectDropMark";
import { LoudnessReadout } from "@/studio/tracks/LoudnessReadout";
import { Meter } from "@/studio/tracks/Meter";
import type { Hovered, RouteHighlight, RouteRole } from "@/studio/tracks/routeHighlight";
import { ValueBar } from "@/studio/tracks/ValueBar";
import { Fader, faderText } from "./Fader";

/** What the mixer can do. The studio passes the same object on every
 * redraw (useStableActions). */
export interface MixerActions {
  selectTrack(id: string): void;
  selectBus(id: string): void;
  selectMaster(): void;
  /** A fader, pan or send gesture starts: one undo step for all of it. */
  adjustStart(): void;
  setVolume(id: string, db: number): void;
  setPan(id: string, pan: number): void;
  toggleMute(id: string): void;
  toggleSolo(id: string): void;
  toggleArm(id: string): void;
  setSend(id: string, busId: string, db: number | null): void;
  setSendPre(id: string, busId: string, pre: boolean): void;
  /** An audio track's input: another track ("" for the audio interface),
   * taken at `tap`. */
  setInput(id: string, track: string, tap: SidechainTap): void;
  /** "" is the default: its group, or the master. */
  setOutput(id: string, value: string): void;
  /** `host`: a track's or bus's id, or "master". */
  openEffect(host: string, effectId: string): void;
  toggleBypass(host: string, effectId: string): void;
  openInstrument(id: string): void;
  dropEffects(host: string, drop: EffectDrop): void;
  /** The pointer came onto a track's or a bus's strip, or left it (null). */
  hover(on: Hovered | null): void;
  addBus(): void;
  renameBus(id: string, name: string): void;
  removeBus(id: string): void;
  setBusVolume(id: string, db: number): void;
  setBusPan(id: string, pan: number): void;
  toggleBusMute(id: string): void;
  setMasterVolume(db: number): void;
  setMasterPan(pan: number): void;
  /** The master limiter's ceiling (dB). */
  setCeiling(db: number): void;
}

export type MixerSelection = { kind: "track" | "bus"; id: string } | { kind: "master" } | null;

interface MixerProps {
  /** The tracks to show, in order (a folded group's tracks are left out). */
  tracks: ChannelConfig[];
  /** Whose FX rack is showing. */
  selected: MixerSelection;
  /** While the pointer's on a track or a bus: what it reaches. */
  route: RouteHighlight | null;
  /** Why a track can't be heard, besides its own mute (silentStates.ts). */
  silent: Map<string, { label: string; detail: string }>;
  /** An audio track's "Audio from" choices, and a track's "Audio to". */
  inputOptions: (c: ChannelConfig) => { value: string; label: string }[];
  outputOptions: (c: ChannelConfig) => { value: string; label: string }[];
  limiterThreshold: number;
  actions: MixerActions;
}

const SEND_OFF_DB = -60;

function formatPan(pan: number): string {
  if (Math.abs(pan) < 0.02) return "C";
  return pan < 0 ? `${Math.round(-pan * 100)}L` : `${Math.round(pan * 100)}R`;
}

const formatSend = (v: number) => (v <= SEND_OFF_DB ? "off" : `${v.toFixed(1)}dB`);

/** A small caption over a strip's section. */
function Caption({ children }: { children: React.ReactNode }) {
  return <div className="text-[8px] font-semibold uppercase leading-none tracking-wide text-muted">{children}</div>;
}

/** A pressed-or-not square button: mute, solo. */
function Toggle({ on, label, title, onClick, tone }: { on: boolean; label: string; title: string; onClick: () => void; tone: "mute" | "solo" }) {
  const lit = tone === "mute" ? "border-record bg-record/20 text-record" : "border-yellow-400 bg-yellow-400/20 text-yellow-300";
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={`flex h-5 w-6 items-center justify-center rounded border text-[10px] font-bold ${on ? lit : "border-border text-muted hover:bg-surface-raised"}`}
    >
      {label}
    </button>
  );
}

/** A labeled select that fills the strip's width. */
function Route({ caption, label, value, options, onChange }: { caption: string; label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-0.5" title={label}>
      <Caption>{caption}</Caption>
      <select
        aria-label={label}
        value={options.some((o) => o.value === value) ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-5 w-full min-w-0 rounded border border-border bg-surface px-0.5 text-[10px] text-foreground"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Where a strip's audio goes, when it can't be changed. */
function FixedRoute({ caption, text }: { caption: string; text: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Caption>{caption}</Caption>
      <div className="flex h-5 items-center truncate rounded border border-border/60 px-1 text-[10px] text-muted">{text}</div>
    </div>
  );
}

/** A host's inserts: its instrument (a MIDI track's), then its effects,
 * each with its on/off light. Click one to open its window; drop effects
 * here to add them. */
function Inserts({ host, effects, instrument, actions }: { host: string; effects: EffectInstance[]; instrument?: { label: string; open?: () => void } | null; actions: MixerActions }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Caption>Inserts</Caption>
      <ul aria-label="Inserts" className="flex h-[76px] flex-col gap-px overflow-y-auto rounded border border-border bg-background/50 p-0.5">
        {instrument !== undefined && (
          <li className="flex h-4 shrink-0 items-center">
            {instrument ? (
              <button
                type="button"
                onClick={instrument.open}
                disabled={!instrument.open}
                title={instrument.open ? `Open ${instrument.label}` : `${instrument.label}: its settings are in the FX rack`}
                className="min-w-0 flex-1 truncate rounded bg-accent/15 px-1 text-left text-[10px] font-medium text-accent hover:bg-accent/25 disabled:hover:bg-accent/15"
              >
                {instrument.label}
              </button>
            ) : (
              <span className="px-1 text-[10px] text-record">No instrument</span>
            )}
          </li>
        )}
        {effects.map((fx) => {
          const name = EFFECT_LABELS[fx.type];
          return (
            <li key={fx.id} className="flex h-4 shrink-0 items-center gap-1">
              <button
                type="button"
                aria-pressed={!fx.bypass}
                aria-label={`${name} on`}
                title={fx.bypass ? `${name} is bypassed: click to turn it on` : `Bypass ${name}`}
                onClick={() => actions.toggleBypass(host, fx.id)}
                className={`ml-0.5 h-2 w-2 shrink-0 rounded-full ${fx.bypass ? "bg-border" : "bg-accent"}`}
              />
              <button
                type="button"
                onClick={() => actions.openEffect(host, fx.id)}
                title={`Open ${name}`}
                className={`min-w-0 flex-1 truncate rounded px-0.5 text-left text-[10px] hover:bg-surface-raised ${fx.bypass ? "text-muted line-through" : "text-foreground"}`}
              >
                {name}
              </button>
            </li>
          );
        })}
        {effects.length === 0 && <li className="px-1 text-[9px] leading-4 text-muted/70">Drop effects here</li>}
      </ul>
    </div>
  );
}

/** A track's sends, one level per bus, each taken after its fader or
 * before it. */
function Sends({ channel, buses, actions }: { channel: ChannelConfig; buses: BusConfig[]; actions: MixerActions }) {
  if (buses.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <Caption>Sends</Caption>
      <div className="flex max-h-[104px] flex-col gap-1 overflow-y-auto">
        {buses.map((bus) => {
          const level = channel.sends?.[bus.id];
          const pre = !!channel.preSends?.includes(bus.id);
          return (
            <div key={bus.id} role="group" aria-label={`Send to ${bus.name}`} className="flex items-end gap-0.5">
              <ValueBar
                label={bus.name}
                value={level ?? SEND_OFF_DB}
                min={SEND_OFF_DB}
                max={0}
                defaultValue={SEND_OFF_DB}
                onChange={(v) => actions.setSend(channel.id, bus.id, v <= SEND_OFF_DB ? null : v)}
                onDragStart={actions.adjustStart}
                formatValue={formatSend}
              />
              {level !== undefined && (
                <button
                  type="button"
                  aria-pressed={pre}
                  aria-label={`Take the send to ${bus.name} before the fader`}
                  title={pre ? "Pre-fader: the bus gets the track whatever its fader does. Click for post-fader." : "Post-fader: the send follows the fader. Click to take it before the fader."}
                  onClick={() => actions.setSendPre(channel.id, bus.id, !pre)}
                  className={`h-4 w-3 shrink-0 rounded border text-[8px] font-bold leading-none ${pre ? "border-warn/60 bg-warn/15 text-warn" : "border-border text-muted hover:text-foreground"}`}
                >
                  {pre ? "P" : "·"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The fader with the meter beside it, and the level under them. */
function FaderMeter({ label, value, onChange, onGestureStart, source }: { label: string; value: number; onChange: (db: number) => void; onGestureStart: () => void; source: string | { bus: string } | "master" }) {
  return (
    <div className="flex min-h-[120px] flex-1 flex-col items-center gap-1">
      <div className="flex min-h-0 w-full flex-1 justify-center gap-1.5 py-1">
        <Fader label={label} value={value} onChange={onChange} onGestureStart={onGestureStart} />
        <Meter source={source} scale />
      </div>
      <div className="font-mono text-[10px] tabular-nums text-foreground/90">{faderText(value)}</div>
    </div>
  );
}

/** What dragging effects over a strip shows, and dropping them does. */
function useEffectDrop(host: string, actions: MixerActions) {
  const [over, setOver] = useState<EffectDropHint | null>(null);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!carriesEffects(e)) return;
        e.preventDefault();
        const hint = effectDropHint(e);
        e.dataTransfer.dropEffect = hint === "move" ? "move" : "copy";
        if (hint !== over) setOver(hint);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
      },
      onDrop: (e: React.DragEvent) => {
        setOver(null);
        const drop = readEffectDrop(e);
        if (!drop) return;
        e.preventDefault();
        actions.dropEffects(host, drop);
      },
    },
  };
}

/** A strip's frame: its color, name and kind at the top, lit while it's
 * selected or the pointer's route reaches it. */
function Strip({
  host,
  name,
  kind,
  color,
  selected,
  route,
  badge,
  groupColor,
  wide = false,
  onSelect,
  onHover,
  actions,
  title,
  children,
}: {
  host: string;
  name: React.ReactNode;
  kind: string;
  color: TrackColor;
  selected: boolean;
  route?: RouteRole | null;
  /** Said on it while it's lit (pre, post). */
  badge?: string;
  groupColor?: TrackColor;
  wide?: boolean;
  onSelect: () => void;
  onHover?: (on: boolean) => void;
  actions: MixerActions;
  title: string;
  children: React.ReactNode;
}) {
  const drop = useEffectDrop(host, actions);
  return (
    <div
      role="group"
      aria-label={`Mixer: ${title}`}
      data-route={route ?? undefined}
      onClick={onSelect}
      onPointerEnter={() => onHover?.(true)}
      onPointerLeave={() => onHover?.(false)}
      {...drop.props}
      className={`relative flex ${wide ? "w-[116px]" : "w-[100px]"} shrink-0 flex-col gap-1.5 overflow-hidden rounded-md border p-1.5 pt-0 ${
        selected ? "border-accent/70 bg-surface-raised" : "border-border bg-surface"
      } ${route === "to" ? "ring-2 ring-inset ring-accent/80" : route === "from" ? "ring-2 ring-inset ring-warn/80" : ""}`}
    >
      {groupColor && <div className="pointer-events-none absolute inset-y-0 left-0 w-1" style={{ background: groupColor.accent, opacity: 0.7 }} />}
      {drop.over && <EffectDropMark hint={drop.over} />}
      <div className="-mx-1.5 h-1 shrink-0" style={{ background: color.accent }} />
      <div className="flex min-h-[28px] flex-col justify-center">
        {name}
        <span className="truncate text-[9px] text-muted">{kind}</span>
      </div>
      {route && (
        <span
          className={`pointer-events-none absolute right-1 top-1.5 z-10 rounded px-1 text-[8.5px] font-semibold uppercase leading-[12px] tracking-wide ${
            route === "to" ? "bg-accent text-on-accent" : "bg-warn text-on-warn"
          }`}
        >
          {badge ?? (route === "to" ? "receives" : "feeds")}
        </span>
      )}
      {children}
    </div>
  );
}

function TrackStrip({ channel, props, group, memberCount }: { channel: ChannelConfig; props: MixerProps; group?: ChannelConfig; memberCount: number }) {
  const { actions } = props;
  const effects = useProjectValue("channelEffects")[channel.id] ?? NO_EFFECTS;
  const buses = useProjectValue("buses");
  const id = channel.id;
  const isMidi = channel.type === "midi";
  const isGroup = channel.type === "group";
  const silent = props.silent.get(id);
  const selected = props.selected?.kind === "track" && props.selected.id === id;
  const instrument = isMidi
    ? channel.instrument
      ? { label: INSTRUMENT_LABELS[channel.instrument], open: INSTRUMENT_UI[channel.instrument].Window ? () => actions.openInstrument(id) : undefined }
      : null
    : undefined;
  const inputValue = channel.input?.track ?? "";
  const kind = isGroup ? `Group · ${memberCount} track${memberCount === 1 ? "" : "s"}` : isMidi ? "MIDI" : "Audio";
  return (
    <Strip
      host={id}
      title={channel.name}
      name={
        <span title={channel.name} className="truncate text-xs font-medium">
          {channel.name}
        </span>
      }
      kind={kind}
      color={trackColorOf(channel)}
      groupColor={group ? trackColorOf(group) : undefined}
      selected={selected}
      route={props.route?.tracks.get(id) ?? null}
      onSelect={() => actions.selectTrack(id)}
      onHover={(on) => actions.hover(on ? { kind: "track", id } : null)}
      actions={actions}
    >
      {silent && (
        <span role="status" title={silent.detail} aria-label={silent.detail} className="-mt-1 truncate rounded border border-warn/50 bg-warn/15 px-1 text-[9px] font-medium text-warn">
          {silent.label}
        </span>
      )}
      {channel.type === "audio" ? (
        <div className="flex flex-col gap-0.5">
          <Route
            caption="Audio from"
            label="Audio from"
            value={inputValue}
            options={props.inputOptions(channel)}
            onChange={(track) => actions.setInput(id, track, channel.input?.tap ?? "postFx")}
          />
          {inputValue && (
            <select
              aria-label="Where on that track"
              value={channel.input?.tap ?? "postFx"}
              onChange={(e) => actions.setInput(id, inputValue, e.target.value as SidechainTap)}
              className="h-5 w-full rounded border border-border bg-surface px-0.5 text-[10px] text-foreground"
            >
              {SIDECHAIN_TAPS.map((tap) => (
                <option key={tap} value={tap}>
                  {SIDECHAIN_TAP_LABELS[tap]}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : (
        <FixedRoute caption="Audio from" text={isGroup ? "Its tracks" : "Notes"} />
      )}
      <Inserts host={id} effects={effects} instrument={instrument} actions={actions} />
      <Sends channel={channel} buses={buses} actions={actions} />
      <ValueBar label="Pan" value={channel.pan} min={-1} max={1} defaultValue={0} onChange={(v) => actions.setPan(id, v)} onDragStart={actions.adjustStart} formatValue={formatPan} bipolar />
      <div className="flex items-center justify-center gap-1">
        <Toggle on={channel.muted} label="M" title={channel.muted ? "Unmute" : "Mute"} tone="mute" onClick={() => actions.toggleMute(id)} />
        <Toggle on={channel.solo} label="S" title={channel.solo ? "Unsolo" : "Solo"} tone="solo" onClick={() => actions.toggleSolo(id)} />
        {!isGroup && (
          <button
            type="button"
            title={channel.armed ? "Record-armed - click to disarm" : "Arm this channel for recording and note input"}
            aria-pressed={channel.armed}
            onClick={() => actions.toggleArm(id)}
            className={`flex h-5 w-5 items-center justify-center rounded-full border ${channel.armed ? "border-record bg-record text-white" : "border-border text-record hover:bg-surface-raised"}`}
          >
            <Circle size={9} fill="currentColor" />
          </button>
        )}
      </div>
      <FaderMeter label={`${channel.name} volume`} value={channel.volume} onChange={(db) => actions.setVolume(id, db)} onGestureStart={actions.adjustStart} source={id} />
      <Route caption="Audio to" label="Audio to" value={channel.output ?? ""} options={props.outputOptions(channel)} onChange={(v) => actions.setOutput(id, v)} />
    </Strip>
  );
}

function BusStrip({ bus, props }: { bus: BusConfig; props: MixerProps }) {
  const { actions } = props;
  const effects = useProjectValue("busEffects")[bus.id] ?? NO_EFFECTS;
  const sent = props.route?.buses.get(bus.id);
  return (
    <Strip
      host={bus.id}
      title={bus.name}
      name={
        <div className="flex items-center gap-0.5">
          <input
            aria-label="Bus name"
            value={bus.name}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => actions.renameBus(bus.id, e.target.value)}
            className="w-full min-w-0 truncate bg-transparent text-xs font-medium outline-none focus:rounded focus:ring-1 focus:ring-accent"
          />
          <button
            type="button"
            title="Remove bus"
            aria-label={`Remove ${bus.name}`}
            onClick={(e) => {
              e.stopPropagation();
              actions.removeBus(bus.id);
            }}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted hover:bg-surface hover:text-record"
          >
            <X size={11} />
          </button>
        </div>
      }
      kind="Bus"
      color={trackColorOf(bus)}
      selected={props.selected?.kind === "bus" && props.selected.id === bus.id}
      route={sent?.role ?? null}
      badge={sent ? (sent.pre ? "pre" : "post") : undefined}
      onSelect={() => actions.selectBus(bus.id)}
      onHover={(on) => actions.hover(on ? { kind: "bus", id: bus.id } : null)}
      actions={actions}
    >
      <FixedRoute caption="Audio from" text="Its sends" />
      <Inserts host={bus.id} effects={effects} actions={actions} />
      <ValueBar label="Pan" value={bus.pan ?? 0} min={-1} max={1} defaultValue={0} onChange={(v) => actions.setBusPan(bus.id, v)} onDragStart={actions.adjustStart} formatValue={formatPan} bipolar />
      <div className="flex items-center justify-center gap-1">
        <Toggle on={!!bus.muted} label="M" title={bus.muted ? "Unmute" : "Mute"} tone="mute" onClick={() => actions.toggleBusMute(bus.id)} />
      </div>
      <FaderMeter label={`${bus.name} volume`} value={bus.volume ?? 0} onChange={(db) => actions.setBusVolume(bus.id, db)} onGestureStart={actions.adjustStart} source={{ bus: bus.id }} />
      <FixedRoute caption="Audio to" text="Master" />
    </Strip>
  );
}

function MasterStrip({ props }: { props: MixerProps }) {
  const { actions } = props;
  const name = useProjectValue("masterName");
  const volume = useProjectValue("masterVolume");
  const pan = useProjectValue("masterPan");
  const effects = useProjectValue("masterEffects");
  return (
    <Strip
      host="master"
      title={name}
      name={
        <span title={name} className="truncate text-xs font-semibold">
          {name}
        </span>
      }
      kind="Master"
      color={MASTER_COLOR}
      selected={props.selected?.kind === "master"}
      route={props.route?.master ? "to" : null}
      onSelect={actions.selectMaster}
      actions={actions}
      wide
    >
      <FixedRoute caption="Audio from" text="Every track" />
      <Inserts host="master" effects={effects} actions={actions} />
      <ValueBar label="Pan" value={pan} min={-1} max={1} defaultValue={0} onChange={actions.setMasterPan} onDragStart={actions.adjustStart} formatValue={formatPan} bipolar />
      <div title="The limiter's ceiling: the master never goes over it">
        <ValueBar label="Ceiling" value={props.limiterThreshold} min={-24} max={0} defaultValue={-1} onChange={actions.setCeiling} onDragStart={actions.adjustStart} formatValue={(v) => `${v.toFixed(1)}dB`} />
      </div>
      <FaderMeter label="Master volume" value={volume} onChange={actions.setMasterVolume} onGestureStart={actions.adjustStart} source="master" />
      <FixedRoute caption="Audio to" text="Speakers" />
    </Strip>
  );
}

const NO_EFFECTS: EffectInstance[] = [];

export function Mixer(props: MixerProps) {
  const { tracks, actions } = props;
  const channels = useProjectValue("channels");
  const buses = useProjectValue("buses");
  return (
    <section aria-label="Mixer" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Mixer</span>
        <span className="truncate text-[10px] text-muted/80">click a strip for its FX rack · drop effects on a strip to add them</span>
        <div className="flex-1" />
        <LoudnessReadout />
      </div>
      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden p-2">
        <div className="flex min-h-0 min-w-0 flex-1 gap-1.5 overflow-auto pb-1">
          {tracks.map((c) => (
            <TrackStrip
              key={c.id}
              channel={c}
              props={props}
              group={c.groupId ? channels.find((g) => g.id === c.groupId) : undefined}
              memberCount={c.type === "group" ? channels.filter((m) => m.groupId === c.id).length : 0}
            />
          ))}
          {tracks.length === 0 && <p className="self-center px-4 text-xs text-muted">No tracks yet.</p>}
          <div className="mx-1 w-px shrink-0 self-stretch bg-border" />
          {buses.map((bus) => (
            <BusStrip key={bus.id} bus={bus} props={props} />
          ))}
          <button
            type="button"
            onClick={actions.addBus}
            title="Add a send/return bus"
            className="flex w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-[10px] text-muted hover:border-accent hover:text-accent"
          >
            <Plus size={14} />
            Bus
          </button>
        </div>
        <div className="flex min-h-0 shrink-0 overflow-y-auto">
          <MasterStrip props={props} />
        </div>
      </div>
    </section>
  );
}
