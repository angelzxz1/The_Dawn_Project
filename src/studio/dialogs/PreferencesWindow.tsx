"use client";

import { useEffect, useState } from "react";
import { AudioLines, FolderOpen, Mic, Palette, Settings, Timer, X } from "lucide-react";
import { audioEngine } from "@/engine/audioEngine";
import { nativeEngine } from "@/engine/native/nativeEngine";
import { BROWSER_LATENCIES, METRONOME_DB_RANGE, type BrowserLatency } from "@/engine/audioPrefs";
import { CLICK_SOUNDS, CLICK_SOUND_LABELS, type ClickSound } from "@/engine/clickSounds";
import { pageBrowserLatency } from "@/engine/context";
import { noteIssue } from "@/services/issues";
import { isDesktopApp } from "@/services/desktop";
import { projectStore } from "@/state/projectStore";
import { AUTOSAVE_CHOICES, COUNT_IN_CHOICES, THEME_CHOICES, UI_SCALES, useStudioPrefs, type StudioPrefs, type ThemeChoice } from "@/state/studioPrefs";
import { keyLabel } from "@/ui/keyLabel";
import { useAudioPrefs } from "@/studio/transport/useAudioPrefs";
import { NativeEngineSection } from "@/studio/transport/NativeEngineSection";
import { ValueBar } from "@/studio/tracks/ValueBar";
import { useShortcuts } from "@/ui/shortcuts";
import { PREFS_TABS, type PrefsTab } from "./preferences";

const ms = (seconds: number) => `${(seconds * 1000).toFixed(1)} ms`;

export function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span className="flex flex-col">
        <span className="text-[12px] text-foreground">{label}</span>
        <span className="text-[11px] leading-snug text-muted">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors"
        style={{ background: value ? "var(--warn)" : "var(--switch-off)" }}
      >
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-(--switch-knob) transition-all" style={{ left: value ? 18 : 2 }} />
      </button>
    </label>
  );
}

/** A labeled choice, its explanation under the label. */
function Choice({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="flex items-start justify-between gap-3">
      <span className="flex flex-col">
        <span className="text-[12px] text-foreground">{label}</span>
        <span className="text-[11px] leading-snug text-muted">{hint}</span>
      </span>
      {children}
    </label>
  );
}

const SELECT = "max-w-[200px] shrink-0 rounded border border-border bg-surface px-1.5 py-1 text-[12px] text-foreground";

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted">{children}</h3>;
}

const LATENCY_LABELS: Record<BrowserLatency, string> = {
  interactive: "Smallest (lowest latency)",
  balanced: "Medium",
  playback: "Largest (steadiest playback)",
};

/** The browser's own audio: where it plays, and how big a buffer. */
function BrowserAudio() {
  const [prefs, update] = useAudioPrefs();
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const canChoose = audioEngine.canChooseOutput();

  useEffect(() => {
    if (!canChoose || !navigator.mediaDevices?.enumerateDevices) return;
    let alive = true;
    void navigator.mediaDevices
      .enumerateDevices()
      .then((all) => alive && setOutputs(all.filter((d) => d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default")))
      .catch((e) => noteIssue("audio.outputs", e, { report: false }));
    return () => {
      alive = false;
    };
  }, [canChoose]);

  const pickOutput = async (id: string | null) => {
    update({ outputDevice: id });
    setError(await audioEngine.setOutputDevice(id));
  };
  const missing = !!prefs.outputDevice && outputs.length > 0 && !outputs.some((d) => d.deviceId === prefs.outputDevice);

  return (
    <section className="flex flex-col gap-3">
      <Heading>The browser&apos;s audio</Heading>
      <Choice
        label="Output"
        hint={canChoose ? "Where the studio plays. Names show once the browser may use the microphone." : "This browser always plays through the system's output device: change it in the system's sound settings."}
      >
        <select
          aria-label="Output device"
          value={prefs.outputDevice ?? ""}
          disabled={!canChoose}
          onChange={(e) => void pickOutput(e.target.value || null)}
          className={SELECT}
        >
          <option value="">System default</option>
          {outputs.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Output ${i + 1}`}
            </option>
          ))}
          {missing && <option value={prefs.outputDevice!}>Not connected</option>}
        </select>
      </Choice>
      {error && <p className="text-[11px] text-record">{error}</p>}
      <Choice label="Buffer size" hint="Smaller is quicker to respond when you play live; larger plays heavy projects without crackles.">
        <select aria-label="Buffer size" value={prefs.browserLatency} onChange={(e) => update({ browserLatency: e.target.value as BrowserLatency })} className={SELECT}>
          {BROWSER_LATENCIES.map((l) => (
            <option key={l} value={l}>
              {LATENCY_LABELS[l]}
            </option>
          ))}
        </select>
      </Choice>
      {prefs.browserLatency !== pageBrowserLatency && (
        <p className="flex items-center justify-between gap-2 rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-[11px] leading-snug text-warn">
          The new buffer size is used once the page reloads. Your project is kept.
          <button type="button" onClick={() => window.location.reload()} className="shrink-0 rounded border border-warn/60 px-2 py-0.5 font-semibold hover:bg-warn/15">
            Reload
          </button>
        </p>
      )}
    </section>
  );
}

function AudioTab() {
  const [prefs, update] = useAudioPrefs();
  const [desktop] = useState(isDesktopApp);
  return (
    <div className="flex flex-col gap-4">
      {desktop && <NativeEngineSection prefs={prefs} update={update} />}
      {!(desktop && prefs.nativeEngine) && <BrowserAudio />}
      <section className="flex flex-col gap-2.5 border-t border-border pt-3">
        <Heading>Delay compensation</Heading>
        <Toggle
          label="Delay compensation"
          hint="Delays tracks so effects that look ahead (Limiter, Compressor, Pitch Shift, oversampled Distortion) don't put their track behind the rest."
          value={prefs.delayCompensation}
          onChange={(v) => update({ delayCompensation: v })}
        />
        <Toggle
          label="Reduced latency when monitoring"
          hint="Tracks you're playing live (monitored, or the armed MIDI track) skip that delay so they respond right away."
          value={prefs.reducedLatencyMonitoring}
          onChange={(v) => update({ reducedLatencyMonitoring: v })}
        />
      </section>
    </div>
  );
}

function RecordingTab() {
  const [prefs, update] = useAudioPrefs();
  const [measure, setMeasure] = useState<{ state: "idle" | "running" | "failed" | "done"; message?: string }>({ state: "idle" });
  const [offsetDraft, setOffsetDraft] = useState(String(prefs.recordingOffsetMs));
  const info = audioEngine.getLatencyInfo();
  const roundTrip = audioEngine.getRoundTrip();
  // Through the native engine, its drivers' round trip is its own.
  const native = nativeEngine.current.active;
  const measuredKey = native ? "measuredNativeRoundTrip" : "measuredRoundTrip";

  const runMeasure = async () => {
    setMeasure({ state: "running" });
    try {
      // On the armed audio track's input, where takes come from.
      const armed = projectStore.get().channels.find((c) => c.armed && c.type === "audio" && !c.input);
      const rt = await audioEngine.measureRoundTrip(armed?.id);
      if (rt === null) {
        setMeasure({
          state: "failed",
          message: "Couldn't hear the clicks clearly. Turn the speakers up (or connect the output to the input with a cable), keep the room quiet, and try again.",
        });
        return;
      }
      update({ [measuredKey]: rt });
      setMeasure({ state: "done", message: `Measured ${ms(rt)}. Recordings will be lined up using it.` });
    } catch (error) {
      noteIssue("latency.measure", error, { report: false });
      setMeasure({
        state: "failed",
        message: native ? "Couldn't measure through the native engine - check its input in Audio settings." : "Couldn't open the audio input - check the browser's microphone permission.",
      });
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <Heading>Lining up recordings</Heading>
      <p className="text-[11px] leading-snug text-muted">
        Recordings are moved earlier by the round trip ({ms(roundTrip.seconds + info.effects)} in all, {roundTrip.measured ? "measured" : "estimated"}) so
        they land on the beat you played to. Measuring makes that exact for your setup.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={runMeasure}
          disabled={measure.state === "running"}
          className="rounded-md border border-border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-foreground hover:bg-surface-raised disabled:opacity-50"
        >
          {measure.state === "running" ? "Listening…" : "Measure latency"}
        </button>
        {prefs[measuredKey] !== null && (
          <button
            type="button"
            onClick={() => {
              update({ [measuredKey]: null });
              setMeasure({ state: "idle" });
            }}
            className="text-[11px] text-muted underline hover:text-foreground"
          >
            Use estimate instead
          </button>
        )}
      </div>
      <p className="text-[11px] leading-snug text-muted">
        {measure.message ??
          "Plays 5 clicks and listens for them: point your speakers at the mic, or connect the interface's output to its input. Not with headphones on - it's loud."}
      </p>
      <label className="flex items-center justify-between gap-3 text-[12px]">
        <span className="flex flex-col">
          <span className="text-foreground">Recording offset</span>
          <span className="text-[11px] text-muted">Fine-tune by ear: positive moves takes earlier.</span>
        </span>
        <span className="flex items-center gap-1">
          <input
            type="number"
            step={0.5}
            min={-500}
            max={500}
            value={offsetDraft}
            onChange={(e) => setOffsetDraft(e.target.value)}
            onBlur={() => {
              const v = Number(offsetDraft);
              const next = Number.isFinite(v) ? Math.max(-500, Math.min(500, v)) : 0;
              setOffsetDraft(String(next));
              update({ recordingOffsetMs: next });
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            aria-label="Recording offset in milliseconds"
            className="w-20 rounded border border-border bg-surface px-2 py-1 text-right font-mono text-foreground"
          />
          <span className="text-muted">ms</span>
        </span>
      </label>
      <Toggle
        label="Offer to measure after a take"
        hint="A note after recording, until the latency has been measured."
        value={!prefs.latencyHintDismissed}
        onChange={(v) => update({ latencyHintDismissed: !v })}
      />
    </section>
  );
}

const formatDb = (db: number) => `${db > 0 ? "+" : ""}${db.toFixed(1)}dB`;

function MetronomeTab() {
  const [prefs, update] = useAudioPrefs();
  return (
    <section className="flex flex-col gap-3">
      <Heading>The click</Heading>
      <p className="text-[11px] leading-snug text-muted">For the metronome and the count-in, in every project. Each project keeps whether its metronome is on.</p>
      <Choice label="Sound" hint="What each beat sounds like; the first of each bar is higher.">
        <select aria-label="Click sound" value={prefs.metronomeSound} onChange={(e) => update({ metronomeSound: e.target.value as ClickSound })} className={SELECT}>
          {CLICK_SOUNDS.map((sound) => (
            <option key={sound} value={sound}>
              {CLICK_SOUND_LABELS[sound]}
            </option>
          ))}
        </select>
      </Choice>
      <Choice label="Level" hint="From its standard level; at the top the count-in peaks at full scale.">
        <ValueBar
          label="Click"
          value={prefs.metronomeDb}
          min={METRONOME_DB_RANGE.min}
          max={METRONOME_DB_RANGE.max}
          defaultValue={0}
          onChange={(metronomeDb) => update({ metronomeDb })}
          formatValue={formatDb}
        />
      </Choice>
    </section>
  );
}

const COUNT_IN_LABELS: Record<StudioPrefs["defaultCountInBars"], string> = { 0: "None", 1: "1 bar", 2: "2 bars", 4: "4 bars" };

function ProjectsTab() {
  const [prefs, update] = useStudioPrefs();
  return (
    <section className="flex flex-col gap-3">
      <Heading>Saving</Heading>
      <Choice
        label="Autosave"
        hint="Saves a project that's in a folder on your computer into that folder while it has unsaved changes. The browser keeps a working copy either way, so a closed tab loses nothing."
      >
        <select
          aria-label="Autosave"
          value={prefs.autosaveMinutes}
          onChange={(e) => update({ autosaveMinutes: Number(e.target.value) as StudioPrefs["autosaveMinutes"] })}
          className={SELECT}
        >
          {AUTOSAVE_CHOICES.map((m) => (
            <option key={m} value={m}>
              {m === 0 ? "Off" : `Every ${m} minute${m === 1 ? "" : "s"}`}
            </option>
          ))}
        </select>
      </Choice>
      <Heading>New projects</Heading>
      <Choice label="Count-in" hint="For a new empty project or beat. The recording templates choose their own; each project keeps its count-in.">
        <select
          aria-label="Count-in for new projects"
          value={prefs.defaultCountInBars}
          onChange={(e) => update({ defaultCountInBars: Number(e.target.value) as StudioPrefs["defaultCountInBars"] })}
          className={SELECT}
        >
          {COUNT_IN_CHOICES.map((n) => (
            <option key={n} value={n}>
              {COUNT_IN_LABELS[n]}
            </option>
          ))}
        </select>
      </Choice>
    </section>
  );
}

const THEME_LABELS: Record<ThemeChoice, string> = { system: "Like the system", dark: "Dark", light: "Light" };

function AppearanceTab() {
  const [prefs, update] = useStudioPrefs();
  const [desktop] = useState(isDesktopApp);
  return (
    <section className="flex flex-col gap-3">
      <Heading>Theme</Heading>
      <div role="radiogroup" aria-label="Theme" className="flex gap-2">
        {THEME_CHOICES.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={prefs.theme === t}
            onClick={() => update({ theme: t })}
            className={`flex-1 rounded-lg border px-3 py-2 text-[12px] ${prefs.theme === t ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted hover:bg-surface hover:text-foreground"}`}
          >
            {THEME_LABELS[t]}
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-muted">
        The studio&apos;s colors. Effect and instrument windows keep their dark look, like hardware, in either theme.
      </p>
      <Heading>Size</Heading>
      {desktop ? (
        <Choice label="Interface size" hint="Makes everything in the window larger or smaller.">
          <select aria-label="Interface size" value={prefs.uiScale} onChange={(e) => update({ uiScale: Number(e.target.value) })} className={SELECT}>
            {UI_SCALES.map((s) => (
              <option key={s} value={s}>
                {Math.round(s * 100)}%
              </option>
            ))}
          </select>
        </Choice>
      ) : (
        <p className="text-[11px] leading-snug text-muted">
          Use the browser&apos;s zoom to make the studio larger or smaller: {keyLabel("mod+=")} zooms in, {keyLabel("mod+-")} zooms out
          and {keyLabel("mod+0")} goes back. The browser remembers it for Dawn.
        </p>
      )}
    </section>
  );
}

const TAB_ICONS: Record<PrefsTab, React.ReactNode> = {
  audio: <AudioLines size={13} />,
  recording: <Mic size={13} />,
  metronome: <Timer size={13} />,
  projects: <FolderOpen size={13} />,
  appearance: <Palette size={13} />,
};

/** Preferences: the settings of this computer and this browser, not of a
 * project - the audio device and buffer, recording latency, the click,
 * saving, and how the studio looks. */
export function PreferencesWindow({ tab, onTab, onClose }: { tab: PrefsTab; onTab: (tab: PrefsTab) => void; onClose: () => void }) {
  useShortcuts("dialog", [{ keys: "escape", label: "Close", run: onClose, whileTyping: true }]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Preferences" className="flex h-[560px] max-h-full w-[680px] max-w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Settings size={15} className="text-accent" />
          <h2 className="flex-1 text-sm font-semibold">Preferences</h2>
          <button type="button" title="Close" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded border border-border hover:bg-surface">
            <X size={13} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div role="tablist" aria-orientation="vertical" aria-label="Preferences" className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border p-2">
            {PREFS_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => onTab(t.id)}
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] ${tab === t.id ? "bg-accent/15 text-foreground" : "text-muted hover:bg-surface hover:text-foreground"}`}
              >
                {TAB_ICONS[t.id]}
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" aria-label={PREFS_TABS.find((t) => t.id === tab)?.label} className="min-w-0 flex-1 overflow-y-auto p-5">
            {tab === "audio" ? (
              <AudioTab />
            ) : tab === "recording" ? (
              <RecordingTab />
            ) : tab === "metronome" ? (
              <MetronomeTab />
            ) : tab === "projects" ? (
              <ProjectsTab />
            ) : (
              <AppearanceTab />
            )}
          </div>
        </div>
        <p className="border-t border-border px-5 py-2 text-[10.5px] text-muted">Kept in this browser on this computer, for every project.</p>
      </div>
    </div>
  );
}
