"use client";

import { useEffect, useRef, useState } from "react";
import { Cpu, Settings, Timer } from "lucide-react";
import { audioEngine } from "@/engine/audioEngine";
import { cpuReading, type CpuReading } from "@/engine/cpuMeter";
import { useAudioPrefs } from "./useAudioPrefs";
import { useShortcuts } from "@/ui/shortcuts";
import { isDesktopApp } from "@/services/desktop";
import { openPreferences } from "@/studio/dialogs/preferences";
import { useNativeEngine } from "./NativeEngineSection";

const ms = (seconds: number) => `${(seconds * 1000).toFixed(1)} ms`;

/** Opens Preferences at Recording (from the note offered after a take). */
export function showRecordingSettings(): void {
  openPreferences("recording");
}

function loadColor(load: number): string {
  return load >= 0.85 ? "#FF6B6B" : load >= 0.6 ? "var(--warn)" : "#6BD68B";
}

function Row({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]" title={title}>
      <span className="text-muted">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

/** The CPU meter in the transport bar, and the panel it opens: the load
 * and the latency figures. The settings behind them (delay compensation,
 * the device, recording latency) are in Preferences; they belong to this
 * computer, so they're kept in the browser (audioPrefs.ts). This stays
 * mounted, so it's what keeps the engine following them. */
export function AudioStatus() {
  const [prefs] = useAudioPrefs();
  const [cpu, setCpu] = useState<CpuReading | null>(null);
  const [open, setOpen] = useState(false);
  const [, setLatencyTick] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const [deviceRates, setDeviceRates] = useState<{ output: number | null; input: number | null } | null>(null);
  const [desktop] = useState(isDesktopApp);
  useNativeEngine(prefs, desktop);

  // The engine follows the settings.
  useEffect(() => {
    audioEngine.setDelayCompensation(prefs.delayCompensation);
    audioEngine.setReducedLatencyMonitoring(prefs.reducedLatencyMonitoring);
    audioEngine.setRecordingCorrection(prefs.measuredRoundTrip, prefs.recordingOffsetMs, prefs.measuredNativeRoundTrip);
    audioEngine.setMetronomeLevel(prefs.metronomeDb);
    audioEngine.setMetronomeSound(prefs.metronomeSound);
  }, [prefs]);
  // The browser's output device (Preferences > Audio), where it can choose.
  useEffect(() => {
    if (prefs.outputDevice) void audioEngine.setOutputDevice(prefs.outputDevice);
  }, [prefs.outputDevice]);

  useEffect(() => {
    const t = setInterval(() => setCpu(cpuReading()), 250);
    return () => clearInterval(t);
  }, []);
  useEffect(() => audioEngine.onLatencyChange(() => setLatencyTick((n) => n + 1)), []);

  // The devices' rates, checked each time the panel opens (the device may
  // have changed).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void audioEngine.getDeviceRates().then((rates) => !cancelled && setDeviceRates(rates));
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  useShortcuts("menu", [{ keys: "escape", label: "Close", run: () => setOpen(false), whileTyping: true }], { enabled: open });

  const info = audioEngine.getLatencyInfo();
  const roundTrip = audioEngine.getRoundTrip();
  const load = cpu?.average ?? 0;
  const pct = cpu ? `${Math.round(load * 100)}%` : "–";

  return (
    <div ref={rootRef} className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Audio engine load and latency"
        className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted hover:bg-surface-raised"
      >
        <Cpu size={13} />
        <span className="font-mono text-foreground">CPU {pct}</span>
        <span className="h-1.5 w-10 overflow-hidden rounded-full" style={{ background: "var(--switch-off)" }}>
          <span className="block h-full" style={{ width: `${Math.min(100, load * 100)}%`, background: loadColor(load) }} />
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 flex max-h-[calc(100vh-140px)] w-[360px] flex-col gap-3 overflow-y-auto rounded-xl p-4 shadow-2xl"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          role="dialog"
          aria-label="Audio settings"
        >
          <section className="flex flex-col gap-1.5">
            <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
              <Cpu size={12} /> CPU
            </h3>
            <Row label={cpu?.source === "native" ? "Native engine load" : "Audio engine load"} value={cpu ? `${Math.round(load * 100)}%` : "idle"} />
            <Row label="Peak (last few seconds)" value={cpu ? `${Math.round(cpu.peak * 100)}%` : "–"} />
            {cpu?.source === "native" ? (
              <p className="text-[11px] leading-snug text-muted">
                The share of each audio buffer&apos;s time the native engine spends rendering the project&apos;s audio. Near 100% it
                can&apos;t keep up and you&apos;ll hear dropouts - choose a larger buffer size in Preferences, or remove or bypass
                heavy effects.
              </p>
            ) : (
              <p className="text-[11px] leading-snug text-muted">
                The share of real time the browser spends rendering the project&apos;s audio. Near 100% it can&apos;t keep up and
                you&apos;ll hear crackles - remove or bypass heavy effects (NAM Amp, Multiband).
              </p>
            )}
          </section>

          <section className="flex flex-col gap-1.5 border-t border-border pt-3">
            <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
              <Timer size={12} /> Latency
            </h3>
            <Row label="Sample rate" value={`${(info.sampleRate / 1000).toFixed(1)} kHz`} />
            {deviceRates?.output && (
              <Row label="Output device rate" value={`${(deviceRates.output / 1000).toFixed(1)} kHz`} title="The rate your speakers or interface run at, as set in the system's sound settings." />
            )}
            {deviceRates?.input && (
              <Row label="Input device rate" value={`${(deviceRates.input / 1000).toFixed(1)} kHz`} title="The rate your microphone or interface input runs at." />
            )}
            {[deviceRates?.output, deviceRates?.input].some((r) => r && r !== info.sampleRate) && (
              <p className="rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-[11px] leading-snug text-warn">
                Your audio device runs at a different rate than Dawn ({(info.sampleRate / 1000).toFixed(1)} kHz), so the browser
                converts the audio on the way in and out, which adds delay. Set the device to {(info.sampleRate / 1000).toFixed(1)} kHz
                (on Windows: Sound settings → the device → Properties → Advanced, for both the output and the input), then reload.
              </p>
            )}
            <Row label="Output (engine → speakers)" value={ms(info.output)} title="The browser's audio buffer plus the device's." />
            <Row label="Input (mic → engine)" value={info.input ? ms(info.input) : "unknown"} title="As the browser reports it - it may not know all of it." />
            <Row
              label={roundTrip.measured ? "Round trip (measured)" : "Round trip (estimated)"}
              value={ms(roundTrip.seconds)}
            />
            <Row label="Effect delay being compensated" value={ms(info.compensated)} title="The most latent track/bus effects chain, which the others wait for." />
            <Row label="Mix → output (incl. master)" value={ms(info.effects)} />
            <p className="text-[11px] leading-snug text-muted">
              What you hear live always lags by the round trip - a browser can&apos;t go below its audio buffer. Use wired
              headphones or speakers (Bluetooth adds 100+ ms), and close other audio apps.
            </p>
          </section>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              openPreferences("audio");
            }}
            className="flex items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-foreground hover:bg-surface-raised"
          >
            <Settings size={12} />
            Audio preferences…
          </button>
        </div>
      )}
    </div>
  );
}
