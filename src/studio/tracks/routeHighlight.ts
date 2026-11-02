// What to light up while the pointer is on a track or a bus: where its
// audio goes (its group or the track it plays into, or the master, the
// buses it sends to, the tracks taking it as their input) and what plays
// into it.

import type { ChannelConfig } from "@/project/types";

export type Hovered = { kind: "track"; id: string } | { kind: "bus"; id: string };

/** "to": the hovered one's audio goes here; "from": this one's goes into
 * the hovered one. */
export type RouteRole = "to" | "from";

export interface RouteHighlight {
  tracks: Map<string, RouteRole>;
  /** Buses it sends to (or, a bus hovered: none), and whether before the
   * fader. */
  buses: Map<string, { role: RouteRole; pre: boolean }>;
  /** Its audio goes straight to the master. */
  master: boolean;
}

/** `routes`: each track's destination (routing.ts routeMap; null: the
 * master). */
export function routeHighlights(hovered: Hovered | null, channels: ChannelConfig[], routes: Map<string, string | null>): RouteHighlight | null {
  if (!hovered) return null;
  const tracks = new Map<string, RouteRole>();
  const buses = new Map<string, { role: RouteRole; pre: boolean }>();
  if (hovered.kind === "bus") {
    channels.forEach((c) => {
      if (c.sends?.[hovered.id] !== undefined) tracks.set(c.id, "from");
    });
    return { tracks, buses, master: false };
  }
  const track = channels.find((c) => c.id === hovered.id);
  if (!track) return null;
  const dest = routes.get(track.id) ?? null;
  if (dest) tracks.set(dest, "to");
  Object.keys(track.sends ?? {}).forEach((bus) => buses.set(bus, { role: "to", pre: !!track.preSends?.includes(bus) }));
  channels.forEach((c) => {
    if (c.id === track.id) return;
    // Tracks taking its audio as their input ("Audio From").
    if (c.input?.track === track.id) tracks.set(c.id, "to");
    // Tracks playing into it, and the one it takes its input from.
    if (routes.get(c.id) === track.id || track.input?.track === c.id) tracks.set(c.id, "from");
  });
  return { tracks, buses, master: dest === null };
}
