// What you can do to a send/return bus: add, rename, remove, mute, each one
// undo step; and its fader and pan, whose gesture's start pushes the undo
// step (as a track's do). (Its effects are effectActions'; a track's send
// level to it is trackActions.setSend.)

import { audioEngine } from "@/engine/audioEngine";
import { newBusId } from "./ids";
import { projectStore } from "./projectStore";
import type { BusConfig } from "@/project/types";

const updateBus = (id: string, update: (b: BusConfig) => BusConfig) =>
  projectStore.set("buses", (prev) => prev.map((b) => (b.id === id ? update(b) : b)));

export const busActions = {
  /** Adds "Bus N"; returns its id. */
  add(): string {
    projectStore.push();
    const id = newBusId();
    projectStore.set("buses", (prev) => [...prev, { id, name: `Bus ${prev.length + 1}`, colorIndex: prev.length }]);
    return id;
  },

  rename(id: string, name: string): void {
    projectStore.push();
    updateBus(id, (b) => ({ ...b, name }));
  },

  setVolume(id: string, db: number): void {
    audioEngine.setBusVolume(id, db);
    updateBus(id, (b) => ({ ...b, volume: db }));
  },

  setPan(id: string, pan: number): void {
    audioEngine.setBusPan(id, pan);
    updateBus(id, (b) => ({ ...b, pan }));
  },

  toggleMute(id: string): void {
    const bus = projectStore.get().buses.find((b) => b.id === id);
    if (!bus) return;
    projectStore.push();
    audioEngine.setBusMute(id, !bus.muted);
    updateBus(id, (b) => ({ ...b, muted: !bus.muted }));
  },

  /** Removes a bus with its effects, and every track's send to it. */
  remove(id: string): void {
    projectStore.push();
    audioEngine.removeBus(id);
    projectStore.set("buses", (prev) => prev.filter((b) => b.id !== id));
    projectStore.set("busEffects", (prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    projectStore.set("channels", (prev) =>
      prev.map((c) => {
        if (!c.sends || !(id in c.sends)) return c;
        const sends = { ...c.sends };
        delete sends[id];
        return { ...c, sends };
      })
    );
  },
};
