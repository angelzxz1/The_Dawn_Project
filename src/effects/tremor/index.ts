// The Tremor: its key, name, browser group and parameters. Its audio node
// is in audio.ts, its rack card and window in ui.ts.

import { defineEffect } from "../types";
import { dbSigned, hzSpaced, tenths } from "../format";
import {
  TREMOR_ATTACK_LABELS,
  TREMOR_GRUNT_LABELS,
  TREMOR_MID_LABELS,
  TREMOR_ULTRA_LO_LABELS,
  TREMOR_VOICES,
  TREMOR_VOICE_LABELS,
  tremorEqDb,
  tremorMidIndex,
  tremorSwitch,
  tremorVoice,
} from "./tremorModel";

const eq = (v: number) => dbSigned(tremorEqDb(v));

// The bass amp (see tremorModel.ts): 0-10 knobs, the Voice switch, and each
// voice's own switches and controls.
export const tremorEffect = defineEffect({
  type: "tremor",
  label: "Tremor",
  group: "Amp & Cab",
  params: [
    { key: "gain", label: "Gain", min: 0, max: 10, default: 5, format: tenths },
    { key: "blend", label: "Blend", min: 0, max: 10, default: 6, format: tenths },
    { key: "comp", label: "Comp", min: 0, max: 10, default: 3, format: tenths },
    { key: "bass", label: "Bass", min: 0, max: 10, default: 5, format: eq },
    { key: "mid", label: "Middle", min: 0, max: 10, default: 5, format: eq },
    { key: "treble", label: "Treble", min: 0, max: 10, default: 5, format: eq },
    { key: "output", label: "Output", min: -24, max: 24, default: 0, format: dbSigned },
    { key: "voice", label: "Voice", min: 0, max: TREMOR_VOICES.length - 1, default: 0, format: (v) => TREMOR_VOICE_LABELS[tremorVoice(v)], automatable: false },
    { key: "midFreq", label: "Mid Freq", min: 0, max: TREMOR_MID_LABELS.length - 1, default: 1, format: (v) => `${TREMOR_MID_LABELS[tremorMidIndex(v)]} Hz`, automatable: false },
    { key: "ultraLo", label: "Ultra Lo", min: 0, max: 2, default: 0, format: (v) => TREMOR_ULTRA_LO_LABELS[tremorSwitch(v, 0)], automatable: false },
    { key: "ultraHi", label: "Ultra Hi", min: 0, max: 1, default: 0, format: (v) => (v >= 0.5 ? "On" : "Off"), automatable: false },
    { key: "grunt", label: "Grunt", min: 0, max: 2, default: 1, format: (v) => TREMOR_GRUNT_LABELS[tremorSwitch(v)], automatable: false },
    { key: "attack", label: "Attack", min: 0, max: 2, default: 1, format: (v) => TREMOR_ATTACK_LABELS[tremorSwitch(v)], automatable: false },
    { key: "lowSplit", label: "Low Split", min: 60, max: 500, default: 250, format: hzSpaced },
    { key: "highSplit", label: "High Split", min: 800, max: 6000, default: 2000, format: hzSpaced },
    { key: "midLevel", label: "Mid Level", min: -24, max: 12, default: 0, format: dbSigned },
    { key: "highLevel", label: "High Level", min: -24, max: 12, default: -6, format: dbSigned },
  ],
});
