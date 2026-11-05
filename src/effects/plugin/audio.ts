// A plugin effect in the browser's engine: the sound passes through (the
// plugin itself runs in the desktop app's native engine).

import * as Tone from "tone";
import { defineAudio } from "../types";

export const pluginAudio = defineAudio<Tone.Gain>({
  create() {
    return new Tone.Gain(1);
  },
  set() {},
});
