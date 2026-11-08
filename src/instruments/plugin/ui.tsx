"use client";

// A plugin instrument's card in the FX rack, and its window. The plugin's
// own window is a window of the desktop app's (opened by the native
// engine, which knows the plugin by its track's id), so the studio's
// window for it only opens that one.

import { useEffect } from "react";
import { AppWindow, Plug } from "lucide-react";
import type { InstrumentCardProps, InstrumentUi, InstrumentWindowProps } from "@/instruments/ui/types";
import { usePluginState } from "@/effects/plugin/PluginEffectCard";
import { DeviceWindow } from "@/ui/DeviceWindow";
import { nativeEngine } from "@/engine/native/nativeEngine";

const FORMATS = { clap: "CLAP", vst3: "VST3" } as const;

function TrackCard({ channelId, settings }: InstrumentCardProps) {
  const plugin = settings.pluginInstrument;
  const { canOpen, why, open } = usePluginState(channelId ?? "", plugin);
  const name = plugin?.name ?? "Plugin";
  return (
    <div className="flex flex-col gap-1.5 rounded border border-border bg-surface px-2 py-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">{name}</span>
        {plugin?.id && <span className="shrink-0 rounded border border-border px-1 text-[9px] font-semibold tracking-wide text-muted">{FORMATS[plugin.format]}</span>}
      </div>
      {plugin?.vendor && <span className="truncate text-[11px] text-muted">{plugin.vendor}</span>}
      <button
        type="button"
        onClick={() => channelId && void nativeEngine.openPluginWindow(channelId, name)}
        disabled={!canOpen || !channelId}
        title={why ?? `Open ${name}'s own window`}
        className="flex items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-[11px] font-semibold text-foreground hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-border disabled:hover:text-foreground"
      >
        <AppWindow size={12} />
        {open ? "Bring its window forward" : "Open its window"}
      </button>
      {why && (
        <p role="status" className="text-[10.5px] leading-snug text-muted">
          {why}
        </p>
      )}
    </div>
  );
}

/** Opening it opens the plugin's own window (and closes this one); where
 * it can't, this says why. */
function TrackWindow({ channelId, channelName, settings, onClose }: InstrumentWindowProps) {
  const plugin = settings.pluginInstrument;
  const { canOpen, why } = usePluginState(channelId, plugin);
  const name = plugin?.name ?? "Plugin";
  useEffect(() => {
    if (!canOpen) return;
    void nativeEngine.openPluginWindow(channelId, name);
    onClose();
  }, [canOpen, channelId, name, onClose]);
  if (canOpen) return null;
  return (
    <DeviceWindow title={name} subtitle={channelName} onClose={onClose} width={360}>
      <p className="text-[12px] leading-snug text-muted">{why}</p>
    </DeviceWindow>
  );
}

export const pluginInstrumentUi: InstrumentUi = { icon: Plug, slotWidth: "w-56", RackCard: TrackCard, Window: TrackWindow };
