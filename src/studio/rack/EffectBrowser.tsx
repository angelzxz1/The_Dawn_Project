"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronRight, Clock, Drum, Link2, Plug, Search, Sliders, Star, Trash2, X } from "lucide-react";
import { EFFECT_CHAINS, type EffectChain } from "@/effects/chains";
import { EFFECT_GROUPS, EFFECT_LABELS, type EffectType } from "@/effects/registry";
import { findPreset, presetsFor, type EffectPreset } from "@/effects/presets";
import { deleteUserChain, subscribeUserChains, userChains } from "@/effects/userChains";
import { useUserPresets } from "@/effects/ui/PresetMenu";
import { parsePick, pickKey, usePicks } from "@/library/browserPicks";
import { browserTones, PREVIEW_SOURCE, toneEffect } from "@/library/previews";
import { bundledTones, type ToneEntry } from "@/library/tones";
import { installedPacks, subscribePacks } from "@/project/packStore";
import { PreviewButton, StarButton, usePreviewing } from "./BrowserItem";

// What a drag from here carries (effectDrag.ts), for the rack and the tracks.
import { CHAIN_DRAG_MIME, EFFECT_DRAG_MIME, PRESET_DRAG_MIME } from "./effectDrag";
export { EFFECT_DRAG_MIME, PRESET_DRAG_MIME };

interface EffectBrowserProps {
  /** Adds the effect (with a preset loaded, if given) to whatever
   * track/bus the FX rack currently targets - the click-to-add alternative
   * to dragging. */
  onAddEffect: (type: EffectType, presetId?: string) => void;
  /** The Grooves tab's contents. */
  grooves?: ReactNode;
  /** The Plugins tab's contents (the desktop app's), if it has one. */
  plugins?: ReactNode;
  /** Adds a ready-made chain of effects to the selected track. */
  onAddChain?: (chain: EffectChain) => void;
  /** Plays a phrase through an effect (with a preset) or a tone; resolves
   * with how long it plays (s). */
  onPreviewEffect?: (type: EffectType, presetId?: string) => Promise<number>;
  onPreviewTone?: (tone: ToneEntry) => Promise<number>;
  onStopPreview?: () => void;
  /** Adds the effect a tone goes in (the NAM Amp, the IR Loader) with it
   * loaded. */
  onAddTone?: (tone: ToneEntry) => void;
}

/** One row of the browser: preview, the item (click to add, drag onto the
 * rack), and its star. */
function Row({
  name,
  pick,
  starred,
  playing,
  onPreview,
  onAdd,
  drag,
  title,
  className = "text-[10.5px]",
  children,
}: {
  name: string;
  pick: string;
  starred: boolean;
  playing: boolean;
  onPreview?: () => void;
  onAdd: () => void;
  drag?: { draggable: boolean; onDragStart: (e: React.DragEvent) => void };
  title: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className="group flex min-w-0 items-center gap-0.5">
      {onPreview ? <PreviewButton name={name} playing={playing} onClick={onPreview} /> : <span className="w-4 shrink-0" />}
      <div
        {...drag}
        onClick={onAdd}
        title={title}
        className={`flex min-w-0 flex-1 select-none items-center gap-1 rounded px-1 py-[3px] text-muted hover:bg-surface-raised hover:text-accent ${
          drag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
        } ${className}`}
      >
        {children}
        <span className="truncate">{name}</span>
      </div>
      <StarButton name={name} pick={pick} starred={starred} />
    </div>
  );
}

const matches = (text: string, query: string) => text.toLowerCase().includes(query);

/**
 * An Ableton-style device browser docked to the left of the whole app:
 * every audio effect, grouped by category, each collapsible, and under
 * each device its presets (factory and your own). A device or preset is
 * both draggable (drop it onto the FX rack at the bottom of the screen)
 * and clickable (adds it straight to the currently selected track/bus).
 * The search box filters devices and presets by name.
 */
export function EffectBrowser({
  onAddEffect,
  grooves,
  plugins,
  onAddChain,
  onPreviewEffect,
  onPreviewTone,
  onStopPreview = () => {},
  onAddTone,
}: EffectBrowserProps) {
  const [tab, setTab] = useState<"effects" | "grooves" | "plugins">("effects");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [openDevices, setOpenDevices] = useState<Set<EffectType>>(new Set());
  const [query, setQuery] = useState("");
  const user = useUserPresets();
  const savedChains = useSyncExternalStore(subscribeUserChains, userChains, userChains);
  const picks = usePicks();
  const favorites = new Set(picks.favorites);
  const { playing, play } = usePreviewing(onStopPreview);
  // The packs' tones change as packs come and go.
  useSyncExternalStore(subscribePacks, installedPacks, installedPacks);
  const [bundled, setBundled] = useState<ToneEntry[]>([]);
  useEffect(() => {
    let alive = true;
    void bundledTones().then((t) => alive && setBundled(t));
    return () => {
      alive = false;
    };
  }, []);
  const q = query.trim().toLowerCase();

  const toggle = <T,>(set: React.Dispatch<React.SetStateAction<Set<T>>>, key: T) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const dragProps = (type: EffectType, preset?: EffectPreset) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(EFFECT_DRAG_MIME, type);
      if (preset) e.dataTransfer.setData(PRESET_DRAG_MIME, preset.id);
      e.dataTransfer.effectAllowed = "copy";
    },
  });

  const chains = EFFECT_CHAINS.filter((c) => !q || matches(c.name, q) || matches("chains", q));
  const yours = savedChains.filter((c) => !q || matches(c.name, q) || matches("chains", q));
  const chainRow = (c: EffectChain, own: boolean) => (
    <div key={c.id} className="group flex min-w-0 items-center">
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(CHAIN_DRAG_MIME, c.id);
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => onAddChain?.(c)}
        title={`${c.description} Click to add it to the selected track, or drag it into the rack or onto a track.`}
        className="flex min-w-0 flex-1 cursor-grab items-center gap-1.5 rounded border border-transparent px-1.5 py-1 text-left text-[11px] text-muted hover:border-accent hover:bg-surface-raised hover:text-accent active:cursor-grabbing"
      >
        <Link2 size={10} className="shrink-0" />
        <span className="truncate">{c.name}</span>
      </button>
      {own && (
        <button
          type="button"
          onClick={() => deleteUserChain(c.id)}
          aria-label={`Delete the chain ${c.name}`}
          title="Delete this chain (from every project)"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-record focus:opacity-100 group-hover:opacity-100"
        >
          <Trash2 size={10} />
        </button>
      )}
    </div>
  );

  const previewEffect = (type: EffectType, presetId?: string) =>
    onPreviewEffect && PREVIEW_SOURCE[type] ? () => play(pickKey(presetId ? "preset" : "effect", presetId ?? type), () => onPreviewEffect(type, presetId)) : undefined;
  // A bundled tone is downloaded only when it's added, so it isn't previewed.
  const previewTone = (tone: ToneEntry) => (onPreviewTone && !tone.file ? () => play(pickKey("tone", tone.id), () => onPreviewTone(tone)) : undefined);
  const toneTitle = (tone: ToneEntry) =>
    `${tone.name}: ${tone.description} (by ${tone.creator}). Click to add a ${EFFECT_LABELS[toneEffect(tone)]} with it loaded.`;

  const effectRow = (type: EffectType, label = EFFECT_LABELS[type]) => {
    const pick = pickKey("effect", type);
    return (
      <Row
        key={pick}
        name={label}
        pick={pick}
        starred={favorites.has(pick)}
        playing={playing === pick}
        onPreview={previewEffect(type)}
        onAdd={() => onAddEffect(type)}
        drag={dragProps(type)}
        title="Drag onto the FX rack, or click to add it to the selected track/bus"
        className="py-1 text-[11px]"
      />
    );
  };
  const presetRow = (type: EffectType, p: EffectPreset, withDevice = false) => {
    const pick = pickKey("preset", p.id);
    return (
      <Row
        key={pick}
        name={withDevice ? `${EFFECT_LABELS[type]}: ${p.name}` : p.name}
        pick={pick}
        starred={favorites.has(pick)}
        playing={playing === pick}
        onPreview={previewEffect(type, p.id)}
        onAdd={() => onAddEffect(type, p.id)}
        drag={dragProps(type, p)}
        title={`${EFFECT_LABELS[type]}: ${p.name}${p.factory ? "" : " (your preset)"} - drag onto the FX rack, or click to add`}
      >
        {!p.factory && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />}
      </Row>
    );
  };
  const toneRow = (tone: ToneEntry) => {
    const pick = pickKey("tone", tone.id);
    return (
      <Row
        key={pick}
        name={tone.name}
        pick={pick}
        starred={favorites.has(pick)}
        playing={playing === pick}
        onPreview={previewTone(tone)}
        onAdd={() => onAddTone?.(tone)}
        title={toneTitle(tone)}
      />
    );
  };

  /** A favorite's or a recent item's row, if it's still there. */
  const allTones = [...browserTones("irLoader", bundled), ...browserTones("namAmp", bundled)];
  const pickRow = (key: string) => {
    const pick = parsePick(key);
    if (pick?.kind === "effect" && pick.id in EFFECT_LABELS) return effectRow(pick.id as EffectType);
    if (pick?.kind === "preset") {
      const preset = findPreset(pick.id);
      return preset ? presetRow(preset.type, preset, true) : null;
    }
    if (pick?.kind === "tone" && onAddTone) {
      const tone = allTones.find((t) => t.id === pick.id);
      return tone ? toneRow(tone) : null;
    }
    return null;
  };
  const pickGroups = q
    ? []
    : ([
        ["Favorites", <Star key="i" size={10} />, picks.favorites],
        ["Recent", <Clock key="i" size={10} />, picks.recent],
      ] as const)
        .map(([name, icon, keys]) => ({ name, icon, rows: keys.map(pickRow).filter((r) => r !== null) }))
        .filter((g) => g.rows.length > 0);

  // Filtered view: which devices show, and which of their presets.
  const view = EFFECT_GROUPS.map((group) => ({
    name: group.name,
    devices: group.types
      .map((type) => {
        const { factory, user: mine } = presetsFor(type, user);
        const all = [...factory, ...mine];
        const label = EFFECT_LABELS[type];
        if (!q) return { type, presets: all, expanded: openDevices.has(type) };
        const deviceHit = matches(label, q) || matches(group.name, q);
        const hits = all.filter((p) => matches(p.name, q));
        const toneHits = onAddTone ? browserTones(type, bundled).filter((t) => matches(t.name, q)) : [];
        if (!deviceHit && !hits.length && !toneHits.length) return null;
        return { type, presets: deviceHit ? all : hits, expanded: hits.length + toneHits.length > 0 || openDevices.has(type) };
      })
      .filter((d): d is { type: EffectType; presets: EffectPreset[]; expanded: boolean } => !!d),
  })).filter((g) => g.devices.length > 0);

  /** A device's tones (the NAM Amp's and IR Loader's), as the search has them. */
  const tones = (type: EffectType) => browserTones(type, bundled).filter((t) => !q || matches(t.name, q) || matches(EFFECT_LABELS[type], q));

  return (
    <div data-tour="browser" className="flex w-48 shrink-0 flex-col overflow-hidden border-r border-border bg-surface">
      <div role="tablist" aria-label="Browser" className="flex border-b border-border">
        {(
          [
            ["effects", "Effects", <Sliders key="i" size={12} />],
            ["grooves", "Grooves", <Drum key="i" size={12} />],
            ...(plugins ? ([["plugins", "Plugins", <Plug key="i" size={12} />]] as const) : []),
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px flex flex-1 items-center justify-center border-b-2 py-2.5 font-semibold uppercase ${
              plugins ? "gap-1 px-0.5 text-[10px] tracking-normal" : "gap-1.5 px-2 text-xs tracking-wide"
            } ${tab === id ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
          >
            {/* Three tabs fit the browser's width as words alone. */}
            {!plugins && icon}
            {label}
          </button>
        ))}
      </div>
      {tab === "grooves" ? (
        grooves
      ) : tab === "plugins" && plugins ? (
        plugins
      ) : (
        <>
          <div className="border-b border-border p-2">
            <label className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 focus-within:border-accent">
              <Search size={11} className="shrink-0 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") setQuery("");
                }}
                placeholder="Search devices, presets"
                aria-label="Search devices and presets"
                className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} title="Clear search" className="text-muted hover:text-foreground">
                  <X size={11} />
                </button>
              )}
            </label>
          </div>
          <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
            {pickGroups.map((g) => (
              <section key={g.name} aria-label={g.name} className="mb-1">
                <div className="flex items-center gap-1 px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {g.icon}
                  {g.name}
                </div>
                <div className="flex flex-col">{g.rows}</div>
              </section>
            ))}
            {onAddChain && chains.length + yours.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => toggle<string>(setCollapsedGroups, "Chains")}
                  className="flex w-full items-center gap-1 rounded px-1 py-1.5 text-left text-[11px] font-medium text-foreground/80 hover:bg-surface-raised"
                >
                  <ChevronRight size={11} className={`shrink-0 transition-transform ${!q && collapsedGroups.has("Chains") ? "" : "rotate-90"}`} />
                  Chains
                </button>
                {(q || !collapsedGroups.has("Chains")) && (
                  <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-1">
                    {yours.length > 0 && (
                      <section aria-label="Your chains" className="flex flex-col gap-0.5">
                        <div className="px-1.5 pt-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-muted/70">Yours</div>
                        {yours.map((c) => chainRow(c, true))}
                        {chains.length > 0 && <div className="px-1.5 pt-1 text-[9.5px] font-semibold uppercase tracking-wide text-muted/70">Factory</div>}
                      </section>
                    )}
                    {chains.map((c) => chainRow(c, false))}
                  </div>
                )}
              </div>
            )}
            {view.length === 0 && chains.length + yours.length === 0 && <p className="px-1 py-2 text-[11px] text-muted">Nothing matches “{query.trim()}”.</p>}
            {view.map((group) => {
              const isCollapsed = !q && collapsedGroups.has(group.name);
              return (
                <div key={group.name}>
                  <button
                    type="button"
                    onClick={() => toggle(setCollapsedGroups, group.name)}
                    className="flex w-full items-center gap-1 rounded px-1 py-1.5 text-left text-[11px] font-medium text-foreground/80 hover:bg-surface-raised"
                  >
                    <ChevronRight size={11} className={`shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
                    {group.name}
                  </button>
                  {!isCollapsed && (
                    <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-1">
                      {group.devices.map(({ type, presets, expanded }) => (
                        <div key={type}>
                          <div className="flex items-center">
                            <button
                              type="button"
                              onClick={() => toggle(setOpenDevices, type)}
                              title={expanded ? "Hide presets" : "Show presets"}
                              aria-label={`${expanded ? "Hide" : "Show"} ${EFFECT_LABELS[type]} presets`}
                              aria-expanded={expanded}
                              className="flex h-5 w-4 shrink-0 items-center justify-center rounded text-muted hover:text-foreground"
                            >
                              <ChevronRight size={10} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
                            </button>
                            <div className="min-w-0 flex-1">{effectRow(type)}</div>
                          </div>
                          {expanded && (
                            <div className="mb-1 ml-4 flex flex-col border-l border-border/60 pl-1">
                              {presets.map((p) => presetRow(type, p))}
                              {onAddTone &&
                                tones(type).map((tone) => toneRow(tone))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
