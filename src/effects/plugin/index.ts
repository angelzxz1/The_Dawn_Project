// A plugin on the computer (VST3 or CLAP) as an effect in a chain: which
// plugin it is and its saved state are on the effect (EffectInstance's
// `plugin`); it has no parameters of Dawn's own. It plays in the desktop
// app's native engine, which runs the plugin (src-tauri/src/audio/hosted.rs);
// in the browser it passes the sound through. It's added from the
// browser's Plugins tab, not the effect list.

import { defineEffect } from "../types";

export const pluginEffect = defineEffect({
  type: "plugin",
  label: "Plugin",
  group: "Utilities",
  params: [],
  hidden: true,
});
