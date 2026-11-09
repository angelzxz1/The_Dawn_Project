// The Crusher: its key, name, browser group and parameters. Its audio
// node is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";
import { dbSigned, pct } from "../format";
import {
  CRUSHER_DISTS,
  CRUSHER_DIST_LABELS,
  CRUSHER_RATIO_LABELS,
  crusherDist,
  crusherInputDb,
  crusherOutputDb,
  crusherRatioIndex,
  formatCrusherAttack,
  formatCrusherRelease,
} from "./crusherModel";

const onOff = (v: number) => (v >= 0.5 ? "On" : "Off");

// The knobs read 0-10 like the hardware's (see crusherModel.ts for what
// each step means); Ratio and Dist are switches.
export const crusherEffect = defineEffect({
  type: "crusher",
  label: "Crusher",
  group: "Dynamics",
  params: [
    { key: "input", label: "Input", min: 0, max: 10, default: 5, format: (v) => dbSigned(crusherInputDb(v)) },
    { key: "attack", label: "Attack", min: 0, max: 10, default: 5, format: formatCrusherAttack },
    { key: "release", label: "Release", min: 0, max: 10, default: 5, format: formatCrusherRelease },
    { key: "output", label: "Output", min: 0, max: 10, default: 5, format: (v) => dbSigned(crusherOutputDb(v)) },
    { key: "ratio", label: "Ratio", min: 0, max: CRUSHER_RATIO_LABELS.length - 1, default: 3, format: (v) => CRUSHER_RATIO_LABELS[crusherRatioIndex(v)], automatable: false },
    { key: "dist", label: "Distortion", min: 0, max: CRUSHER_DISTS.length - 1, default: 0, format: (v) => CRUSHER_DIST_LABELS[crusherDist(v)], automatable: false },
    { key: "detHp", label: "Detector HP", min: 0, max: 1, default: 0, format: onOff, automatable: false },
    { key: "detBand", label: "Band Emphasis", min: 0, max: 1, default: 0, format: onOff, automatable: false },
    { key: "british", label: "British Mode", min: 0, max: 1, default: 0, format: onOff, automatable: false },
    { key: "mix", label: "Mix", min: 0, max: 1, default: 1, format: pct },
  ],
});
