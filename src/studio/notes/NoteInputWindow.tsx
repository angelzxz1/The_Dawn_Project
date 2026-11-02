"use client";

import type { ReactNode } from "react";
import { Keyboard } from "lucide-react";
import { DEVICE, DeviceWindow } from "@/ui/DeviceWindow";

// The on-screen keyboard / drum pads, in a window that floats over the
// studio instead of taking a row of it, in the device windows' style: drag
// it by its title row, close it with ✕ or the Keys button. It stays mounted
// while closed, so the computer keyboard keeps playing the armed track
// either way.

export function NoteInputWindow({ open, channelName, onClose, children }: { open: boolean; channelName?: string; onClose: () => void; children: ReactNode }) {
  return (
    <DeviceWindow
      title="Keys"
      subtitle={channelName}
      mark={<Keyboard size={18} color={DEVICE.accent} aria-hidden="true" />}
      onClose={onClose}
      floating={{ open, posKey: "dawn.noteInputPos" }}
      gap={12}
    >
      {children}
    </DeviceWindow>
  );
}
