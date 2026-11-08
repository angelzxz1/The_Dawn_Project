// A plugin on the computer (VST3 or CLAP) as an effect in a chain: which
// plugin it is and its saved state are on the effect (EffectInstance's
// `plugin`); it has no parameters of Dawn's own. It plays in the desktop
// app's native engine, which runs the plugin (src-tauri/src/audio/hosted.rs);
// in the browser it passes the sound through. It's added from the
// browser's Plugins tab, not the effect list.

import { defineEffect, type PluginRef } from "../types";

export const pluginEffect = defineEffect({
  type: "plugin",
  label: "Plugin",
  group: "Utilities",
  params: [],
  hidden: true,
});

/** A saved plugin, read back: none if it isn't one (no id or file, or a
 * format Dawn doesn't host). Shared by plugin effects and instruments. */
export function normalizePluginRef(raw: unknown): PluginRef | null {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
  const id = text(p.id, "");
  const path = text(p.path, "");
  if (!id || !path || (p.format !== "clap" && p.format !== "vst3")) return null;
  return {
    format: p.format,
    id,
    name: text(p.name, id).slice(0, 120),
    vendor: text(p.vendor, "").slice(0, 120),
    path,
    ...(typeof p.state === "string" && /^[A-Za-z0-9+/=]*$/.test(p.state) ? { state: p.state } : {}),
  };
}
