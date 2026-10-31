"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AudioLines, ChevronRight, Clock, Play, Plus, Square, Star } from "lucide-react";
import { allGrooveGenres, allGrooves, GROOVE_DRAG_MIME, GROOVE_GENRES, SECTION_LABELS, subscribeGrooves, type Groove } from "@/library/grooves";
import { parsePick, pickKey, usePicks } from "@/library/browserPicks";
import { installedPacks, packSamples, subscribePacks } from "@/project/packStore";
import { PreviewButton, StarButton, usePreviewing } from "./BrowserItem";

/** The MIME type a pack's sample travels under when dragged onto an audio
 * track: its file id. */
export const SAMPLE_DRAG_MIME = "application/x-dawn-sample";

export type BrowserSample = ReturnType<typeof packSamples>[number];

interface GrooveBrowserProps {
  /** Plays the groove once (resolves when it has finished or was replaced). */
  onPreview: (groove: Groove) => void;
  onStopPreview: () => void;
  /** Adds the groove at the playhead on the selected track. */
  onAdd: (groove: Groove) => void;
  /** Whether there's a MIDI track selected to add to. */
  canAdd: boolean;
  /** Plays a pack's sample once; resolves with how long it plays (s). */
  onPreviewSample?: (fileId: string) => Promise<number>;
  /** Adds a sample at the playhead on the selected audio track. */
  onAddSample?: (sample: BrowserSample) => void;
  canAddSample?: boolean;
}

/** The Grooves tab of the left browser: drum patterns by genre. Click one to
 * hear it, drag it onto a MIDI track (it becomes a clip there, at the
 * project's tempo), or press + to add it at the playhead. Under them, the
 * samples from your sound packs, to hear and drag onto an audio track; above
 * them, your favorites and what you added last. */
export function GrooveBrowser({ onPreview, onStopPreview, onAdd, canAdd, onPreviewSample, onAddSample, canAddSample = false }: GrooveBrowserProps) {
  const [open, setOpen] = useState<Set<string>>(new Set(["rock"]));
  const [playing, setPlaying] = useState<string | null>(null);
  const genres = useSyncExternalStore(subscribeGrooves, allGrooveGenres, () => GROOVE_GENRES);
  const picks = usePicks();
  const favorites = new Set(picks.favorites);
  const samplePreview = usePreviewing(onStopPreview);
  useSyncExternalStore(subscribePacks, installedPacks, installedPacks);
  const samples = packSamples();

  // A preview stops on its own; this is only for the button's state.
  useEffect(() => {
    if (!playing) return;
    const g = allGrooves().find((x) => x.id === playing);
    const ms = g ? (g.bars * ((g.genre.meter[0] * 4) / g.genre.meter[1]) * 60000) / g.genre.bpm + 600 : 0;
    const t = window.setTimeout(() => setPlaying(null), ms);
    return () => window.clearTimeout(t);
  }, [playing]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const play = (g: Groove) => {
    if (playing === g.id) {
      onStopPreview();
      setPlaying(null);
      return;
    }
    onPreview(g);
    setPlaying(g.id);
  };

  const grooveRow = (g: Groove, withGenre = false) => {
    const pick = pickKey("groove", g.id);
    const name = withGenre ? `${g.genre.name}: ${SECTION_LABELS[g.section]}` : SECTION_LABELS[g.section];
    return (
      <div
        key={pick}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(GROOVE_DRAG_MIME, g.id);
          e.dataTransfer.effectAllowed = "copy";
        }}
        className="group flex cursor-grab items-center gap-1 rounded px-1 py-[3px] text-[10.5px] text-muted hover:bg-surface-raised hover:text-accent active:cursor-grabbing"
        title={`${g.name}: ${g.bars} bar${g.bars > 1 ? "s" : ""}, made at ${g.genre.bpm} BPM on the ${g.genre.kit} kit. Drag onto a MIDI track.`}
      >
        <button
          type="button"
          onClick={() => play(g)}
          aria-label={`${playing === g.id ? "Stop" : "Play"} ${g.name}`}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted hover:text-accent"
        >
          {playing === g.id ? <Square size={9} /> : <Play size={9} />}
        </button>
        <span className="flex-1 select-none truncate" onClick={() => play(g)}>
          {name}
        </span>
        <span className="font-mono text-[9.5px] text-muted/70">{g.bars}</span>
        <StarButton name={g.name} pick={pick} starred={favorites.has(pick)} />
        <button
          type="button"
          onClick={() => onAdd(g)}
          disabled={!canAdd}
          aria-label={`Add ${g.name} at the playhead`}
          title={canAdd ? "Add at the playhead on the selected track" : "Select a MIDI track to add it to"}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-accent group-hover:opacity-100 disabled:opacity-0"
        >
          <Plus size={10} />
        </button>
      </div>
    );
  };

  const sampleRow = (sample: BrowserSample) => {
    const pick = pickKey("sample", sample.fileId);
    return (
      <div
        key={pick}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(SAMPLE_DRAG_MIME, sample.fileId);
          e.dataTransfer.effectAllowed = "copy";
        }}
        title={`${sample.name}, from the pack "${sample.pack}". Drag onto an audio track.`}
        className="group flex cursor-grab items-center gap-1 rounded px-1 py-[3px] text-[10.5px] text-muted hover:bg-surface-raised hover:text-accent active:cursor-grabbing"
      >
        {onPreviewSample ? (
          <PreviewButton
            name={sample.name}
            playing={samplePreview.playing === pick}
            onClick={() => samplePreview.play(pick, () => onPreviewSample(sample.fileId))}
          />
        ) : (
          <AudioLines size={10} className="shrink-0" />
        )}
        <span className="flex-1 select-none truncate">{sample.name}</span>
        <StarButton name={sample.name} pick={pick} starred={favorites.has(pick)} />
        {onAddSample && (
          <button
            type="button"
            onClick={() => onAddSample(sample)}
            disabled={!canAddSample}
            aria-label={`Add ${sample.name} at the playhead`}
            title={canAddSample ? "Add at the playhead on the selected track" : "Select an audio track to add it to"}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-accent group-hover:opacity-100 disabled:opacity-0"
          >
            <Plus size={10} />
          </button>
        )}
      </div>
    );
  };

  /** A favorite's or a recent item's row, if it's still there. */
  const pickRow = (key: string) => {
    const pick = parsePick(key);
    if (pick?.kind === "groove") {
      const g = allGrooves().find((x) => x.id === pick.id);
      return g ? grooveRow(g, true) : null;
    }
    if (pick?.kind === "sample") {
      const sample = samples.find((x) => x.fileId === pick.id);
      return sample ? sampleRow(sample) : null;
    }
    return null;
  };
  const pickGroups = (
    [
      ["Favorites", <Star key="i" size={10} />, picks.favorites],
      ["Recent", <Clock key="i" size={10} />, picks.recent],
    ] as const
  )
    .map(([name, icon, keys]) => ({ name, icon, rows: keys.map(pickRow).filter((r) => r !== null) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
      <p className="px-1 pb-1.5 text-[10.5px] leading-snug text-muted">
        Click to hear · drag onto a MIDI track · they follow the project tempo
      </p>
      {pickGroups.map((g) => (
        <section key={g.name} aria-label={g.name} className="mb-1">
          <div className="flex items-center gap-1 px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
            {g.icon}
            {g.name}
          </div>
          <div className="flex flex-col">{g.rows}</div>
        </section>
      ))}
      {genres.map((genre) => {
        const isOpen = open.has(genre.id);
        return (
          <div key={genre.id}>
            <button
              type="button"
              onClick={() => toggle(genre.id)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-1 rounded px-1 py-1.5 text-left text-[11px] font-medium text-foreground/80 hover:bg-surface-raised"
            >
              <ChevronRight size={11} className={`shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
              <span className="flex-1 truncate">{genre.name}</span>
              {genre.pack && <span className="rounded bg-accent/15 px-1 text-[9px] font-normal text-accent">pack</span>}
              <span className="font-mono text-[9.5px] font-normal text-muted">
                {genre.meter[0] === 4 && genre.meter[1] === 4 ? "" : `${genre.meter[0]}/${genre.meter[1]} · `}
                {genre.bpm}
              </span>
            </button>
            {isOpen && (
              <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-1">
                {allGrooves()
                  .filter((g) => g.genre.id === genre.id)
                  .map((g) => grooveRow(g))}
              </div>
            )}
          </div>
        );
      })}
      <section aria-label="Samples" className="mt-2 border-t border-border pt-2">
        <div className="flex items-center gap-1 px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
          <AudioLines size={10} />
          Samples
        </div>
        {samples.length > 0 ? (
          <div className="flex flex-col">{samples.map(sampleRow)}</div>
        ) : (
          <p className="px-1 text-[10.5px] leading-snug text-muted">A sound pack&apos;s samples show here, to hear and drag onto an audio track.</p>
        )}
      </section>
    </div>
  );
}
