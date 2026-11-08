// A plugin on the computer (VST3 or CLAP) as a MIDI track's instrument:
// which plugin it is and the state it saved are on the track
// (`pluginInstrument`). It plays in the desktop app's native engine, which
// runs the plugin (src-tauri/src/audio/hosted.rs) and gives it the track's
// notes; in the browser it's silent. It's put on a track from the
// browser's Plugins tab, so the picker only offers it once a track has one.

import { defineInstrument } from "../types";
import { normalizePluginRef } from "../../effects/plugin";
import type { PluginRef } from "../../effects/types";

/** What a track whose plugin can't be read back keeps: the card says its
 * details are missing. */
const MISSING: PluginRef = { format: "clap", id: "", name: "Plugin", vendor: "", path: "" };

export const pluginInstrument = defineInstrument({
  type: "plugin",
  label: "Plugin",
  settings: { key: "pluginInstrument", defaults: () => ({ ...MISSING }), normalize: (saved) => normalizePluginRef(saved) ?? { ...MISSING } },
  hidden: true,
});
