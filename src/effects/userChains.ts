// Your own effect chains: a track's whole chain saved under a name, to add
// to any track later. Like user presets they're saved in this browser
// (localStorage) and shared by every project. A step keeps all of its
// effect's settings, its bypass and a factory cabinet; a file you loaded
// yourself belongs to its project, so the step comes without it.

import { EFFECT_CHAINS, type ChainStep, type EffectChain } from "./chains";
import { EFFECT_LABELS, EFFECT_TYPES, type EffectInstance, type EffectType } from "./registry";
import { clampToSpec, findPreset } from "./presets";
import { isFactoryFile } from "../library/tones";

const STORAGE_KEY = "dawn-effect-chains-v1";
const MAX_NAME = 60;
const EMPTY: EffectChain[] = [];
let cache: EffectChain[] | null = null;
const listeners = new Set<() => void>();

function normalizeStep(raw: unknown): ChainStep | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = r.type as EffectType;
  if (!EFFECT_TYPES.includes(type)) return null;
  const params: Record<string, number> = {};
  const saved = r.params && typeof r.params === "object" ? (r.params as Record<string, unknown>) : {};
  Object.entries(saved).forEach(([key, value]) => {
    const v = clampToSpec(type, key, value as number);
    if (v !== null) params[key] = v;
  });
  const step: ChainStep = { type, params };
  if (typeof r.preset === "string" && findPreset(r.preset)?.type === type) step.preset = r.preset;
  const file = r.file as Record<string, unknown> | undefined;
  if (file && typeof file.id === "string" && isFactoryFile(file.id)) step.file = { id: file.id, name: typeof file.name === "string" ? file.name : file.id };
  if (r.bypass === true) step.bypass = true;
  return step;
}

/** What a chain has in it, for its tooltip: "Gate → Compressor → Reverb". */
export const chainSummary = (steps: ChainStep[]) => steps.map((s) => EFFECT_LABELS[s.type]).join(" → ");

function normalize(raw: unknown): EffectChain | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim().slice(0, MAX_NAME) : "";
  if (typeof r.id !== "string" || !r.id.startsWith("user-chain:") || !name || !Array.isArray(r.steps)) return null;
  const steps = r.steps.map(normalizeStep).filter((s): s is ChainStep => !!s);
  if (steps.length === 0) return null;
  return { id: r.id, name, description: chainSummary(steps), steps };
}

function read(): EffectChain[] {
  if (cache) return cache;
  let list: EffectChain[] = [];
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      const seen = new Set<string>();
      list = parsed.map(normalize).filter((c): c is EffectChain => !!c && !seen.has(c.id) && !!seen.add(c.id));
    }
  } catch {
    // Unreadable storage: start empty (the bad data is left alone).
  }
  cache = list;
  return list;
}

function write(list: EffectChain[]): void {
  cache = list;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.map(({ id, name, steps }) => ({ id, name, steps }))));
  } catch {
    // Storage full or blocked: kept for this session only.
  }
  listeners.forEach((fn) => fn());
}

if (typeof window !== "undefined") {
  // Chains saved in another tab show up here too.
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    cache = null;
    listeners.forEach((fn) => fn());
  });
}

export function subscribeUserChains(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Every chain you saved, by name (a stable array until one changes). */
export function userChains(): EffectChain[] {
  return typeof window === "undefined" ? EMPTY : read();
}

/** A factory chain or one of yours. */
export function findChain(id: string): EffectChain | undefined {
  return EFFECT_CHAINS.find((c) => c.id === id) ?? userChains().find((c) => c.id === id);
}

let idCounter = 0;
const newId = () => `user-chain:${Date.now().toString(36)}-${(++idCounter).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** The steps that add these effects back as they are. */
export function stepsFrom(effects: EffectInstance[]): ChainStep[] {
  return effects.map((fx) => {
    const step: ChainStep = { type: fx.type, params: { ...fx.params } };
    if (fx.preset && findPreset(fx.preset.id)) step.preset = fx.preset.id;
    if (fx.file && isFactoryFile(fx.file.id)) step.file = { ...fx.file };
    if (fx.bypass) step.bypass = true;
    return step;
  });
}

/** Saves effects as a chain of yours. One with the same name (ignoring
 * case) is replaced. Null if there's nothing to save. */
export function saveUserChain(name: string, effects: EffectInstance[]): EffectChain | null {
  if (effects.length === 0) return null;
  const clean = name.trim().slice(0, MAX_NAME) || "Untitled chain";
  const list = read();
  const existing = list.find((c) => c.name.toLowerCase() === clean.toLowerCase());
  const steps = stepsFrom(effects);
  const chain: EffectChain = { id: existing?.id ?? newId(), name: clean, description: chainSummary(steps), steps };
  const next = existing ? list.map((c) => (c.id === existing.id ? chain : c)) : [...list, chain];
  write(next.sort((a, b) => a.name.localeCompare(b.name)));
  return chain;
}

export function deleteUserChain(id: string): void {
  write(read().filter((c) => c.id !== id));
}

/** For tests: forget the cached list (re-read storage next time). */
export function resetUserChainCache(): void {
  cache = null;
}
