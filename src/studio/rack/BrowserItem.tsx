"use client";

// The parts every browser row shares: a button that previews it (and stops
// the preview), a star that makes it a favorite, and which row's preview
// is playing.

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, Star } from "lucide-react";
import { toggleFavorite } from "@/library/browserPicks";

/** Which row's preview plays (by its pick key), until it ends or another
 * starts. `play` takes what starts it, which resolves with its length (s;
 * 0 if it couldn't play). */
export function usePreviewing(stopPreview: () => void) {
  const [playing, setPlaying] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const play = useCallback(
    (key: string, start: () => Promise<number>) => {
      window.clearTimeout(timer.current);
      if (playing === key) {
        stopPreview();
        setPlaying(null);
        return;
      }
      setPlaying(key);
      // Unless another preview has started meanwhile, this one's button
      // goes back once it ends (or at once, if it couldn't play).
      const done = () => setPlaying((now) => (now === key ? null : now));
      void start().then((seconds) => {
        if (seconds > 0) timer.current = window.setTimeout(done, seconds * 1000 + 200);
        else done();
      });
    },
    [playing, stopPreview]
  );
  return { playing, play };
}

export function PreviewButton({ name, playing, onClick }: { name: string; playing: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={`${playing ? "Stop" : "Preview"} ${name}`}
      title={playing ? "Stop the preview" : "Hear it before adding it"}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded hover:text-accent ${playing ? "text-accent" : "text-muted"}`}
    >
      {playing ? <Square size={9} /> : <Play size={9} />}
    </button>
  );
}

export function StarButton({ name, pick, starred }: { name: string; pick: string; starred: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggleFavorite(pick);
      }}
      aria-label={`${starred ? "Unstar" : "Star"} ${name}`}
      aria-pressed={starred}
      title={starred ? "Take it out of your favorites" : "Add it to your favorites"}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded hover:text-accent ${
        starred ? "text-accent" : "text-muted opacity-0 focus:opacity-100 group-hover:opacity-100"
      }`}
    >
      <Star size={9} fill={starred ? "currentColor" : "none"} />
    </button>
  );
}
