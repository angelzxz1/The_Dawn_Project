"use client";

import { Maximize2, Power, X } from "lucide-react";
import { PluginIcon } from "./PluginIcon";
import { fraunces, spaceGrotesk } from "@/ui/pluginFonts";
import { WindowPresetMenu } from "./PresetMenu";
import { DeviceWindow } from "@/ui/DeviceWindow";

/** The top row of a compact FX rack card: icon, name, a short status, and
 * expand / bypass / remove. */
export function RackCardHeader({
  title,
  status,
  bypass,
  onBypassToggle,
  onRemove,
  onExpand,
}: {
  title: string;
  status?: React.ReactNode;
  bypass: boolean;
  onBypassToggle: () => void;
  onRemove: () => void;
  onExpand: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex min-w-0 items-center gap-1.5">
        <PluginIcon size={15} />
        <h2 className={`${fraunces.className} text-[13px] font-semibold text-[#F4EDE2]`}>{title}</h2>
        {status !== undefined && (
          <span className={`${spaceGrotesk.className} truncate text-[10px] font-semibold uppercase tracking-wider text-muted`}>{status}</span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button type="button" title="Expand" onClick={onExpand} className="flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-black/20">
          <Maximize2 size={11} />
        </button>
        <button
          type="button"
          title={bypass ? "Enable effect" : "Bypass effect"}
          onClick={onBypassToggle}
          className="flex h-5 w-5 items-center justify-center rounded"
          style={{ background: "#23242B", border: "1px solid #2E2F37" }}
        >
          <Power size={11} color={bypass ? "#5A5B64" : "#E6AD5E"} />
        </button>
        <button type="button" title="Remove effect" onClick={onRemove} className="flex h-5 w-5 items-center justify-center rounded text-record hover:bg-black/20">
          <X size={11} />
        </button>
      </div>
    </div>
  );
}

/** An effect's full window: the device frame (ui/DeviceWindow.tsx) with the
 * effect's presets and its bypass in the title row. Escape closes it. */
export function PluginWindow({
  title,
  channelName,
  bypass,
  onBypassToggle,
  onClose,
  width,
  gap,
  panelRef,
  onPanelKeyDown,
  children,
}: {
  title: string;
  channelName: string;
  bypass: boolean;
  onBypassToggle: () => void;
  onClose: () => void;
  width: number;
  gap?: number;
  panelRef?: React.RefObject<HTMLDivElement | null>;
  onPanelKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <DeviceWindow
      title={title}
      subtitle={channelName}
      mark={<PluginIcon />}
      tools={<WindowPresetMenu />}
      bypass={{ on: bypass, toggle: onBypassToggle }}
      onClose={onClose}
      width={width}
      gap={gap}
      panelRef={panelRef}
      onPanelKeyDown={onPanelKeyDown}
    >
      {children}
    </DeviceWindow>
  );
}

/** An on/off pill button for a plugin setting. */
export function PluginToggle({
  label,
  active,
  onClick,
  title,
  danger = false,
  small = false,
}: {
  label: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title?: string;
  danger?: boolean;
  small?: boolean;
}) {
  const on = danger ? "#FF6B6B" : "#E6AD5E";
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={`whitespace-nowrap rounded-md font-bold uppercase tracking-wide ${small ? "px-1.5 py-0.5 text-[9.5px]" : "px-2.5 py-1 text-[11px]"}`}
      style={
        active
          ? { background: danger ? "rgba(255,107,107,0.16)" : "rgba(230,173,94,0.18)", color: on, border: `1px solid ${on}` }
          : { color: "#9A9AA4", border: "1px solid #2E2F37" }
      }
    >
      {label}
    </button>
  );
}
