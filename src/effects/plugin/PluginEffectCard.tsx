"use client";

// A plugin effect's rack card and window. The plugin's own window is a
// window of the desktop app's (opened by the native engine), so the
// studio's window for it only opens that one.

import { useEffect, useSyncExternalStore } from "react";
import { AppWindow } from "lucide-react";
import { RackCardHeader, PluginWindow } from "@/effects/ui/PluginChrome";
import type { EffectCardProps, EffectWindowProps } from "@/effects/ui/types";
import type { PluginRef } from "@/effects/types";
import { nativeEngine } from "@/engine/native/nativeEngine";
import { spaceGrotesk } from "@/ui/pluginFonts";

const FORMATS: Record<PluginRef["format"], string> = { clap: "CLAP", vst3: "VST3" };

/** Whether the plugin can run now, and if not, why. */
function usePluginState(effectId: string, plugin: PluginRef | undefined) {
  const native = useSyncExternalStore(nativeEngine.subscribe, () => nativeEngine.current, () => nativeEngine.current);
  const error = native.plugins.errors[effectId] ?? null;
  const why = !plugin
    ? "This plugin's details are missing."
    : plugin.format !== "clap"
      ? "VST3 plugins play in the native engine soon; for now only CLAP ones do."
      : !native.active
        ? "Plays in the desktop app's native engine: turn it on in Audio settings."
        : error;
  return { canOpen: why === null, why, open: native.plugins.windows.includes(effectId) };
}

export function PluginRackCard({ effectId, plugin, bypass, onBypassToggle, onRemove, onExpand }: EffectCardProps) {
  const { canOpen, why, open } = usePluginState(effectId, plugin);
  const name = plugin?.name ?? "Plugin";
  return (
    <div className={`${spaceGrotesk.className} flex h-full flex-col gap-2`}>
      <RackCardHeader title={name} status={plugin ? FORMATS[plugin.format] : undefined} bypass={bypass} onBypassToggle={onBypassToggle} onRemove={onRemove} onExpand={onExpand} />
      <div className="flex flex-1 flex-col justify-center gap-2 rounded-lg px-2 py-2" style={{ background: "#14151A" }}>
        {plugin?.vendor && <span className="truncate text-[11px] text-muted">{plugin.vendor}</span>}
        <button
          type="button"
          onClick={() => void nativeEngine.openPluginWindow(effectId, name)}
          disabled={!canOpen}
          title={why ?? `Open ${name}'s own window`}
          className="flex items-center justify-center gap-1.5 rounded-md border border-[#3A3B44] px-2 py-1.5 text-[11px] font-semibold text-[#F4EDE2] hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-[#3A3B44] disabled:hover:text-[#F4EDE2]"
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
    </div>
  );
}

/** Opening a plugin effect's window opens the plugin's own (and closes
 * this one); where it can't, this says why. */
export function PluginEffectWindow({ effectId, channelName, bypass, onBypassToggle, onClose, plugin }: EffectWindowProps) {
  const { canOpen, why } = usePluginState(effectId, plugin);
  const name = plugin?.name ?? "Plugin";
  useEffect(() => {
    if (!canOpen) return;
    void nativeEngine.openPluginWindow(effectId, name);
    onClose();
  }, [canOpen, effectId, name, onClose]);
  if (canOpen) return null;
  return (
    <PluginWindow title={name} channelName={channelName} bypass={bypass} onBypassToggle={onBypassToggle} onClose={onClose} width={360}>
      <p className="text-[12px] leading-snug text-muted">{why}</p>
    </PluginWindow>
  );
}
