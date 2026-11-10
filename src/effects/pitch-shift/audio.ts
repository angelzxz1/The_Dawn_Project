// How the Pitch Shift's audio node is built and a parameter applied.

import { PitchShifter } from "./pitchShifter";
import { defineAudio } from "../types";

export const pitchShiftAudio = defineAudio<PitchShifter>({
  create(params) {
    return new PitchShifter(params);
  },
  set(node, key, value) {
    node.setParam(key, value);
  },
});
