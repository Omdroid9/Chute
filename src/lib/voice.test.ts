import { describe, expect, it } from "vitest";
import { downloadPercent, VOICE_NOW_ALLOWED, isVoiceNowAllowed } from "./voice";

describe("downloadPercent", () => {
  it("returns 0 when total is missing or zero", () => {
    expect(downloadPercent(50, 0)).toBe(0);
    expect(downloadPercent(50, -1)).toBe(0);
  });

  it("rounds to a 0–100 percent", () => {
    expect(downloadPercent(50, 100)).toBe(50);
    expect(downloadPercent(1, 3)).toBe(33);
    expect(downloadPercent(100, 100)).toBe(100);
  });

  it("clamps above 100 if the server overshoots", () => {
    expect(downloadPercent(120, 100)).toBe(100);
  });
});

describe("the first-time voice note", () => {
  it("matches what the native side sends, so it shows as a note, not an error", async () => {
    const { readFileSync } = await import("node:fs");
    const native = readFileSync(new URL("../../src-tauri/src/mic_permission.rs", import.meta.url), "utf8");
    expect(native).toContain(`"${VOICE_NOW_ALLOWED}"`);
    expect(isVoiceNowAllowed(` ${VOICE_NOW_ALLOWED} `)).toBe(true);
    expect(isVoiceNowAllowed("Microphone access is denied.")).toBe(false);
  });

  it("never mentions the microphone, which would offer System Settings", () => {
    expect(VOICE_NOW_ALLOWED).not.toMatch(/microphone/i);
  });
});
