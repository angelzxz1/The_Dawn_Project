// How the Tremor's audio node is built and a parameter applied.

import { TremorChain } from "./tremor";
import { defineAudio } from "../types";

export const tremorAudio = defineAudio<TremorChain>({
  create(params) {
    return new TremorChain(params);
  },
  set(node, key, value) {
    node.setParam(key, value);
  },
});
