// How the Crusher's audio node is built and a parameter applied.

import { CrusherChain } from "./crusher";
import { defineAudio } from "../types";

export const crusherAudio = defineAudio<CrusherChain>({
  create(params) {
    return new CrusherChain(params);
  },
  set(node, key, value) {
    node.setParam(key, value);
  },
});
