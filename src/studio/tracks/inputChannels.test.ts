import { describe, expect, test } from "vitest";
import { inputChannelChoices } from "./inputChannels";
import { availableChannel, inputKey, parseInputKey } from "@/engine/inputs";

const devices = [
  { deviceId: "default", label: "Default - UMC", channels: 2 },
  { deviceId: "umc", label: "UMC", channels: 2 },
  { deviceId: "webcam", label: "Webcam", channels: 1 },
  { deviceId: "old", label: "Old browser" },
];

describe("input channels", () => {
  test("a device with several channels offers each; one with one, or that doesn't say, none", () => {
    expect(inputChannelChoices(devices, "umc", undefined)).toEqual([0, 1]);
    expect(inputChannelChoices(devices, "webcam", undefined)).toEqual([]);
    expect(inputChannelChoices(devices, "old", undefined)).toEqual([]);
  });

  test("the default device is the one listed as the default", () => {
    expect(inputChannelChoices(devices, "", undefined)).toEqual([0, 1]);
    expect(inputChannelChoices([{ deviceId: "a", channels: 4 }], "", undefined)).toEqual([0, 1, 2, 3]);
  });

  test("the channel already picked stays a choice (a device not plugged in, another computer's)", () => {
    expect(inputChannelChoices(devices, "gone", 1)).toEqual([1]);
    expect(inputChannelChoices(devices, "umc", 5)).toEqual([0, 1, 5]);
  });

  test("an input is open under its device's id, and its channel after a #", () => {
    expect(inputKey({ device: null, channel: null })).toBe("");
    expect(inputKey({ device: "umc", channel: null })).toBe("umc");
    expect(inputKey({ device: "umc", channel: 1 })).toBe("umc#1");
    expect(inputKey({ device: null, channel: 0 })).toBe("#0");
    for (const key of ["", "umc", "umc#1", "#0"]) expect(inputKey(parseInputKey(key))).toBe(key);
  });

  test("a channel past a device's last is its last", () => {
    expect(availableChannel(1, 2)).toBe(1);
    expect(availableChannel(3, 2)).toBe(1);
    expect(availableChannel(0, 1)).toBe(0);
  });
});
