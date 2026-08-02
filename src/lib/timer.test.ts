import { describe, expect, it } from "vitest";
import { parseTimer, formatCountdown } from "./timer";

describe("parseTimer", () => {
  it("needs an explicit timer/pomodoro keyword", () => {
    expect(parseTimer("call mom in 10 minutes")).toBeNull();
    expect(parseTimer("buy milk at 6pm")).toBeNull();
    expect(parseTimer("finish the deck in 30 min")).toBeNull();
  });

  it("defaults pomodoro to 25 minutes", () => {
    expect(parseTimer("pomodoro")).toEqual({ seconds: 1500, label: "Pomodoro" });
    expect(parseTimer("start a pomodoro")).toEqual({ seconds: 1500, label: "Pomodoro" });
  });

  it("parses explicit durations after a timer keyword", () => {
    expect(parseTimer("timer for 25 min")).toEqual({ seconds: 1500, label: "25m timer" });
    expect(parseTimer("set a 10 minute timer")).toEqual({ seconds: 600, label: "10m timer" });
    expect(parseTimer("90 second timer")).toEqual({ seconds: 90, label: "1m 30s timer" });
    expect(parseTimer("1 hour timer")).toEqual({ seconds: 3600, label: "1h timer" });
  });

  it("sums compound durations", () => {
    expect(parseTimer("timer for 1h 30m")).toEqual({ seconds: 5400, label: "1h 30m timer" });
  });

  it("gives break a 5-minute default", () => {
    expect(parseTimer("short break")).toEqual({ seconds: 300, label: "Break" });
  });

  it("ignores a bare timer with no duration", () => {
    expect(parseTimer("buy a kitchen timer")).toBeNull();
  });

  it("caps absurd durations at 24h", () => {
    expect(parseTimer("timer for 9999 hours")?.seconds).toBe(24 * 3600);
  });
});

describe("formatCountdown", () => {
  it("formats mm:ss and h:mm:ss", () => {
    expect(formatCountdown(1500)).toBe("25:00");
    expect(formatCountdown(90)).toBe("1:30");
    expect(formatCountdown(3661)).toBe("1:01:01");
    expect(formatCountdown(-5)).toBe("0:00");
  });
});
