// An audio track's input channel picker (TrackHeader): which of its
// device's inputs it can record.

/** The channels an audio track can pick from its device (0 = input 1):
 * none when the device has one channel or the browser doesn't say how many
 * (the default device is the one listed as "default", else the first),
 * but always the one already picked. */
export function inputChannelChoices(devices: { deviceId: string; channels?: number }[], deviceId: string, picked: number | undefined): number[] {
  const device = devices.find((d) => d.deviceId === (deviceId || "default")) ?? (deviceId ? undefined : devices[0]);
  const count = device?.channels ?? 0;
  const choices = count > 1 ? Array.from({ length: count }, (_, i) => i) : [];
  if (picked !== undefined && !choices.includes(picked)) choices.push(picked);
  return choices;
}
