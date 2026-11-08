// A plugin instrument in the browser's engine: silent (the plugin itself
// plays in the desktop app's native engine).

import { NullInstrument } from "../instrument";
import { defineInstrumentAudio } from "../types";

export const pluginInstrumentAudio = defineInstrumentAudio<NullInstrument>({
  create(_settings, onSettled) {
    queueMicrotask(onSettled);
    return new NullInstrument();
  },
});
