// The arrangement's right-click menus: on a clip, on an empty spot of a
// track's lane, in the time selection, and on a track's header. Each is
// built from where it was opened and what the studio can do there
// (MenuActions); an item with a keyboard shortcut shows it.

import {
  AlignHorizontalJustifyStart,
  ArrowDown,
  ArrowUp,
  AudioLines,
  ChevronsDownUp,
  Circle,
  Clipboard,
  Combine,
  Copy,
  CopyPlus,
  Download,
  Eraser,
  FileAudio,
  FilePlus2,
  FlipHorizontal2,
  FoldHorizontal,
  FolderInput,
  FolderOutput,
  FolderPlus,
  Gauge,
  Headphones,
  Layers,
  Pencil,
  Repeat,
  ScanSearch,
  Scissors,
  Sliders,
  Spline,
  TextCursorInput,
  Trash2,
  Upload,
  UnfoldHorizontal,
  VolumeX,
  X,
} from "lucide-react";
import { canMoveTrack } from "@/engine/routing";
import { audioEngine } from "@/engine/audioEngine";
import { getCopiedClip, getCopiedRange } from "@/state/clipboard";
import { FADE_PRESETS, presetFades, type FadePreset } from "@/project/clipEdits";
import { bpmAtSeconds, type TempoMap } from "@/project/tempoMap";
import { TRACK_COLOR_PALETTE, trackColorOf, type TrackColorPick } from "@/project/colors";
import type { AudioClipInstance, AudioWarp, ChannelConfig, ClipInstance } from "@/project/types";
import type { ContextMenuEntry, ContextMenuItem } from "@/studio/shell/ContextMenu";

export type ContextMenuState =
  | { kind: "clip"; channelId: string; clipId: string; x: number; y: number }
  | { kind: "lane"; channelId: string; x: number; y: number; atSeconds: number }
  /** In the time selection: acts on it. */
  | { kind: "range"; x: number; y: number }
  | { kind: "header"; channelId: string; x: number; y: number };

type MenuItems = ContextMenuEntry[];

export interface MenuActions {
  editClip: (channelId: string, clipId: string) => void;
  copyClip: (channelId: string, clipId: string) => void;
  /** Pastes the copied clip over this one. */
  pasteOver: (channelId: string, clipId: string) => void;
  exportClipMidi: (channelId: string, clipId: string) => void;
  splitAtPlayhead: (channelId: string, clipId: string) => void;
  toggleLoop: (channelId: string, clipId: string) => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  renameClip: (channelId: string, clipId: string) => void;
  /** Colors the selected clips; null gives them back their track's. */
  recolorSelected: (color: string | null) => void;
  consolidateSelected: () => void;
  reverseSelected: () => void;
  normalizeSelected: () => void;
  fadeSelected: (preset: FadePreset) => void;
  /** Warps the selected audio clips (they follow the tempo), or unwarps
   * them (warp.ts). */
  warpSelected: (on: boolean) => void;
  warpModeSelected: (mode: AudioWarp["mode"]) => void;
  /** Finds the selected audio clips' tempos and warps them by it. */
  detectTempoSelected: () => void;
  /** Moves the hits in the selected audio clips onto the grid. */
  quantizeAudioSelected: () => void;
  clearWarpMarkersSelected: () => void;
  addEmptyClip: (channelId: string, atSeconds: number) => void;
  importAudio: (channelId: string, atSeconds: number) => void;
  /** Pastes the copied clip on the lane at the nearest bar. */
  pasteAt: (channelId: string, atSeconds: number) => void;
  groupTracks: (ids: string[]) => void;
  setTrackGroup: (id: string, groupId: string | null) => void;
  toggleFold: (id: string) => void;
  /** Removes a track (ungroups a group). */
  removeTrack: (id: string) => void;
  /** Shows or hides a track's take lanes. */
  toggleTakes: (id: string) => void;
  /** Deletes a track's takes, keeping what it plays. */
  deleteAllTakes: (id: string) => void;
  /** Makes a track's name a text field. */
  renameTrack: (id: string) => void;
  recolorTrack: (id: string, pick: TrackColorPick) => void;
  toggleMute: (id: string) => void;
  toggleSolo: (id: string) => void;
  toggleArm: (id: string) => void;
  toggleMonitor: (id: string) => void;
  openFx: (id: string) => void;
  toggleAutomation: (id: string) => void;
  moveTrack: (id: string, direction: -1 | 1) => void;
  /** Asks for a .mid file and adds it to the track. */
  importMidi: (id: string) => void;
  exportMidi: (id: string) => void;
  /** Deletes every clip on a track. */
  clearTrack: (id: string) => void;
  /** What's done to the time selection (rangeActions.ts). */
  time: TimeSelectionActions;
}

export interface TimeSelectionActions {
  consolidate: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  clear: () => void;
  insertSilence: () => void;
  deleteTime: () => void;
  loop: () => void;
}

export interface MenuContext {
  channels: ChannelConfig[];
  clipsOf: (channelId: string) => ClipInstance[];
  /** How many clips are selected (the menu acts on all of them). */
  selectedClips: number;
  /** Tracks Ctrl/Cmd-clicked for grouping. */
  trackPicks: ReadonlySet<string>;
  /** How many takes a track has (takes.ts). */
  takeCount: (channelId: string) => number;
  /** Audio tracks monitoring their input. */
  monitored: ReadonlySet<string>;
  /** The track whose automation lane shows. */
  automationChannelId: string | null;
  /** For the fade presets: a beat and a bar (at the clip). */
  tempo: TempoMap;
  beatsPerBar: number;
}

export function contextMenuItems(menu: ContextMenuState, ctx: MenuContext, actions: MenuActions): MenuItems {
  const typeOf = (id: string) => ctx.channels.find((c) => c.id === id)?.type ?? "midi";
  const copied = getCopiedClip();
  const canPaste = (channelId: string) => !!copied && copied.kind === typeOf(channelId);
  if (menu.kind === "clip") return clipMenu(menu.channelId, menu.clipId, ctx, actions, canPaste(menu.channelId));
  if (menu.kind === "lane") return laneMenu(menu.channelId, menu.atSeconds, typeOf(menu.channelId), actions, canPaste(menu.channelId));
  if (menu.kind === "range") return rangeMenu(actions.time);
  return headerMenu(menu.channelId, ctx, actions);
}

function clipMenu(channelId: string, clipId: string, ctx: MenuContext, actions: MenuActions, canPaste: boolean): MenuItems {
  const clip = ctx.clipsOf(channelId).find((c) => c.id === clipId);
  if (!clip) return [];
  const hasNotes = clip.kind === "midi" && clip.notes.length > 0;
  const t = audioEngine.getTransportSeconds();
  const canSplit = t > clip.offset && t < clip.offset + clip.length;
  const many = ctx.selectedClips > 1;
  const channel = ctx.channels.find((c) => c.id === channelId);
  const label: MenuItems = [
    { label: "Rename…", shortcut: "f2", icon: <TextCursorInput size={13} />, onSelect: () => actions.renameClip(channelId, clipId) },
    {
      row: "Color",
      options: [
        ...(channel ? [{ label: "Track color", title: "The track's color", swatch: trackColorOf(channel).accent, selected: !clip.color, onSelect: () => actions.recolorSelected(null) }] : []),
        ...TRACK_COLOR_PALETTE.map((c, i) => ({
          label: `Color ${i + 1}`,
          swatch: c.accent,
          selected: clip.color === c.accent,
          onSelect: () => actions.recolorSelected(c.accent),
        })),
      ],
    },
    "separator",
  ];
  const process: MenuItems = [
    { label: "Consolidate", shortcut: "mod+j", icon: <Combine size={13} />, onSelect: actions.consolidateSelected },
    { label: many ? `Reverse ${ctx.selectedClips} clips` : "Reverse", icon: <FlipHorizontal2 size={13} />, onSelect: actions.reverseSelected },
    ...(clip.kind === "audio" ? audioProcess(clip, ctx, actions, many) : []),
  ];
  const copyPaste: MenuItems = [
    { label: "Copy clip", icon: <Copy size={13} />, onSelect: () => actions.copyClip(channelId, clipId) },
    { label: "Paste clip here", icon: <Clipboard size={13} />, disabled: !canPaste, onSelect: () => actions.pasteOver(channelId, clipId) },
    "separator",
  ];
  const tail: MenuItems = [
    { label: "Split at playhead", icon: <Scissors size={13} />, disabled: !canSplit, onSelect: () => actions.splitAtPlayhead(channelId, clipId) },
    { label: many ? `Duplicate ${ctx.selectedClips} clips` : "Duplicate clip", shortcut: "mod+d", icon: <CopyPlus size={13} />, onSelect: actions.duplicateSelected },
    { label: clip.loopLength ? "Stop looping clip" : "Loop clip", icon: <Repeat size={13} />, onSelect: () => actions.toggleLoop(channelId, clipId) },
    ...process,
    "separator",
    { label: many ? `Delete ${ctx.selectedClips} clips` : "Delete clip", shortcut: "delete", icon: <Trash2 size={13} />, danger: true, onSelect: actions.deleteSelected },
  ];
  if (clip.kind === "audio") return [...label, ...copyPaste, ...tail];
  return [
    { label: "Edit in piano roll", icon: <Pencil size={13} />, onSelect: () => actions.editClip(channelId, clipId) },
    ...label,
    ...copyPaste,
    { label: "Export .mid", icon: <Download size={13} />, disabled: !hasNotes, onSelect: () => actions.exportClipMidi(channelId, clipId) },
    ...tail,
  ];
}

/** An audio clip's: normalizing, and fades from a preset (the one its
 * fades are now, if any, shows as picked). */
function audioProcess(clip: AudioClipInstance, ctx: MenuContext, actions: MenuActions, many: boolean): MenuItems {
  const current = FADE_PRESETS.find((p) => {
    const f = presetFades(p.id, clip.length, bpmAtSeconds(ctx.tempo, clip.offset), ctx.beatsPerBar);
    return Math.abs(f.fadeIn - clip.fadeIn) < 1e-6 && Math.abs(f.fadeOut - clip.fadeOut) < 1e-6;
  });
  return [
    {
      label: many ? `Normalize ${ctx.selectedClips} clips` : "Normalize",
      icon: <AudioLines size={13} />,
      onSelect: actions.normalizeSelected,
    },
    {
      row: "Fades",
      options: FADE_PRESETS.map((p) => ({ label: p.label, title: p.title, selected: p.id === current?.id, onSelect: () => actions.fadeSelected(p.id) })),
    },
    "separator",
    ...warpItems(clip, ctx, actions, many),
  ];
}

/** An audio clip's warping (warp.ts): following the tempo or not, how, and
 * finding the clip's own tempo. */
function warpItems(clip: AudioClipInstance, ctx: MenuContext, actions: MenuActions, many: boolean): MenuItems {
  const clips = many ? `${ctx.selectedClips} clips` : "clip";
  const items: MenuItems = [
    clip.warp
      ? { label: `Stop warping ${clips}`, icon: <Gauge size={13} />, onSelect: () => actions.warpSelected(false) }
      : { label: `Warp ${clips}: follow the tempo`, icon: <Gauge size={13} />, onSelect: () => actions.warpSelected(true) },
    { label: many ? "Detect the clips' tempos" : "Detect the clip's tempo", icon: <ScanSearch size={13} />, onSelect: actions.detectTempoSelected },
    { label: "Quantize audio to the grid", icon: <AlignHorizontalJustifyStart size={13} />, onSelect: actions.quantizeAudioSelected },
  ];
  if (clip.warp && clip.warp.markers.length > 0) {
    items.push({ label: "Clear warp markers", icon: <Eraser size={13} />, onSelect: actions.clearWarpMarkersSelected });
  }
  if (clip.warp) {
    const mode = clip.warp.mode;
    items.push({
      row: "Warp",
      options: [
        { label: "Stretch", title: "Keep the pitch when the tempo changes", selected: mode === "stretch", onSelect: () => actions.warpModeSelected("stretch") },
        { label: "Repitch", title: "Speed up or slow down like tape, pitch and all", selected: mode === "repitch", onSelect: () => actions.warpModeSelected("repitch") },
      ],
    });
  }
  return items;
}

function laneMenu(channelId: string, atSeconds: number, type: ChannelConfig["type"], actions: MenuActions, canPaste: boolean): MenuItems {
  // A group's lane holds no clips.
  if (type === "group") return [];
  return [
    type === "midi"
      ? { label: "Add empty MIDI clip here", icon: <FilePlus2 size={13} />, onSelect: () => actions.addEmptyClip(channelId, atSeconds) }
      : { label: "Import audio clip here…", icon: <FileAudio size={13} />, onSelect: () => actions.importAudio(channelId, atSeconds) },
    { label: "Paste clip here", icon: <Clipboard size={13} />, disabled: !canPaste, onSelect: () => actions.pasteAt(channelId, atSeconds) },
  ];
}

function rangeMenu(time: TimeSelectionActions): MenuItems {
  return [
    { label: "Cut", shortcut: "mod+x", icon: <Scissors size={13} />, onSelect: time.cut },
    { label: "Copy", shortcut: "mod+c", icon: <Copy size={13} />, onSelect: time.copy },
    { label: "Paste copied time here", shortcut: "mod+v", icon: <Clipboard size={13} />, disabled: !getCopiedRange(), onSelect: time.paste },
    { label: "Duplicate", shortcut: "mod+d", icon: <CopyPlus size={13} />, onSelect: time.duplicate },
    { label: "Consolidate", shortcut: "mod+j", icon: <Combine size={13} />, onSelect: time.consolidate },
    { label: "Loop the selection", shortcut: "mod+l", icon: <Repeat size={13} />, onSelect: time.loop },
    "separator",
    { label: "Insert silence", shortcut: "mod+i", icon: <UnfoldHorizontal size={13} />, onSelect: time.insertSilence },
    { label: "Delete time", shortcut: "shift+delete", icon: <FoldHorizontal size={13} />, onSelect: time.deleteTime },
    { label: "Empty the selection", shortcut: "delete", icon: <Eraser size={13} />, danger: true, onSelect: time.clear },
  ];
}

function headerMenu(id: string, ctx: MenuContext, actions: MenuActions): MenuItems {
  const { channels, trackPicks } = ctx;
  const channel = channels.find((c) => c.id === id);
  if (!channel) return [];
  const isGroup = channel.type === "group";
  const clips = ctx.clipsOf(id);
  const name: MenuItems = [
    { label: "Rename…", icon: <TextCursorInput size={13} />, onSelect: () => actions.renameTrack(id) },
    {
      row: "Color",
      options: TRACK_COLOR_PALETTE.map((c, i) => ({
        label: `Color ${i + 1}`,
        swatch: c.accent,
        selected: trackColorOf(channel).accent === c.accent,
        onSelect: () => actions.recolorTrack(id, { colorIndex: i }),
      })),
    },
    "separator",
  ];
  const states: ContextMenuItem[] = [
    { label: channel.muted ? "Unmute" : "Mute", icon: <VolumeX size={13} />, onSelect: () => actions.toggleMute(id) },
    { label: channel.solo ? "Unsolo" : "Solo", icon: <Headphones size={13} />, onSelect: () => actions.toggleSolo(id) },
    ...(isGroup ? [] : [{ label: channel.armed ? "Disarm" : "Arm for recording", icon: <Circle size={13} />, onSelect: () => actions.toggleArm(id) }]),
    ...(channel.type === "audio"
      ? [{ label: ctx.monitored.has(id) ? "Stop monitoring" : "Monitor the input", icon: <Headphones size={13} />, onSelect: () => actions.toggleMonitor(id) }]
      : []),
  ];
  const views: ContextMenuItem[] = [
    { label: channel.type === "midi" ? "Instrument and effects" : "Effects", icon: <Sliders size={13} />, onSelect: () => actions.openFx(id) },
    {
      label: ctx.automationChannelId === id ? "Hide automation" : "Show automation",
      icon: <Spline size={13} />,
      onSelect: () => actions.toggleAutomation(id),
    },
  ];
  // New clips go after what's already on the track.
  const end = clips.reduce((max, c) => Math.max(max, c.offset + c.length), 0);
  const clipItems: ContextMenuItem[] = isGroup
    ? []
    : channel.type === "midi"
      ? [
          { label: "Add empty MIDI clip", icon: <FilePlus2 size={13} />, onSelect: () => actions.addEmptyClip(id, end) },
          { label: "Import .mid…", icon: <Upload size={13} />, onSelect: () => actions.importMidi(id) },
          {
            label: "Export .mid",
            icon: <Download size={13} />,
            disabled: !clips.some((c) => c.kind === "midi" && c.notes.length > 0),
            onSelect: () => actions.exportMidi(id),
          },
        ]
      : [{ label: "Import audio clip…", icon: <FileAudio size={13} />, onSelect: () => actions.importAudio(id, end) }];
  // Grouping: the Ctrl/Cmd-clicked tracks (with this one), or this one.
  const picked = trackPicks.has(id) ? [...trackPicks] : [id];
  const groups = channels.filter((c) => c.type === "group" && c.id !== channel.groupId);
  const groupItems: ContextMenuItem[] = isGroup
    ? [{ label: "Ungroup (keep the tracks)", icon: <FolderOutput size={13} />, onSelect: () => actions.removeTrack(id) }]
    : [
        {
          label: picked.length > 1 ? `Group ${picked.length} tracks` : "Group this track",
          shortcut: "mod+g",
          icon: <FolderPlus size={13} />,
          onSelect: () => actions.groupTracks(picked),
        },
        ...groups.map((g) => ({ label: `Move into “${g.name}”`, icon: <FolderInput size={13} />, onSelect: () => actions.setTrackGroup(id, g.id) })),
        ...(channel.groupId ? [{ label: "Take out of the group", icon: <FolderOutput size={13} />, onSelect: () => actions.setTrackGroup(id, null) }] : []),
      ];
  const takes = ctx.takeCount(id);
  const takeItems: ContextMenuItem[] =
    takes > 0
      ? [
          { label: channel.showTakes ? "Hide take lanes" : `Show take lanes (${takes})`, icon: <Layers size={13} />, onSelect: () => actions.toggleTakes(id) },
          { label: "Delete all takes (keep what plays)", icon: <Trash2 size={13} />, onSelect: () => actions.deleteAllTakes(id) },
        ]
      : [];
  const arrange: ContextMenuItem[] = [
    {
      label: channel.folded ? (isGroup ? "Unfold the group" : "Unfold track") : isGroup ? "Fold the group (hide its tracks)" : "Fold track",
      icon: <ChevronsDownUp size={13} />,
      onSelect: () => actions.toggleFold(id),
    },
    { label: "Move up", icon: <ArrowUp size={13} />, disabled: !canMoveTrack(channels, id, -1), onSelect: () => actions.moveTrack(id, -1) },
    { label: "Move down", icon: <ArrowDown size={13} />, disabled: !canMoveTrack(channels, id, 1), onSelect: () => actions.moveTrack(id, 1) },
  ];
  const removeItems: ContextMenuItem[] = [
    ...(isGroup ? [] : [{ label: "Clear all clips", icon: <Eraser size={13} />, disabled: clips.length === 0, danger: true, onSelect: () => actions.clearTrack(id) }]),
    ...(channels.length > 1 && !isGroup ? [{ label: "Remove track", icon: <X size={13} />, danger: true, onSelect: () => actions.removeTrack(id) }] : []),
  ];
  const section = (items: ContextMenuItem[]): MenuItems => (items.length ? [...items, "separator"] : []);
  const menu: MenuItems = [
    ...name,
    ...section(states),
    ...section(views),
    ...section(clipItems),
    ...section(takeItems),
    ...section([...groupItems, ...arrange]),
    ...removeItems,
  ];
  return menu[menu.length - 1] === "separator" ? menu.slice(0, -1) : menu;
}
