import { describe, expect, it } from "vitest";
import { snoozeChoices, snoozeUntil } from "./snooze";

// Months are zero-based: new Date(2026, 9, 22) is Oct 22, local time.
describe("snoozeUntil", () => {
  it("snoozes an hour from now, to the minute", () => {
    expect(snoozeUntil("hour", new Date(2026, 9, 22, 14, 37, 42, 500))).toBe("2026-10-22T15:37:00");
  });

  it("carries an hour past midnight into the next day, month and year", () => {
    expect(snoozeUntil("hour", new Date(2026, 9, 22, 23, 30))).toBe("2026-10-23T00:30:00");
    expect(snoozeUntil("hour", new Date(2026, 9, 31, 23, 15))).toBe("2026-11-01T00:15:00");
    expect(snoozeUntil("hour", new Date(2026, 11, 31, 23, 5))).toBe("2027-01-01T00:05:00");
  });

  it("snoozes to 6 PM today for this evening", () => {
    expect(snoozeUntil("evening", new Date(2026, 9, 22, 9, 15))).toBe("2026-10-22T18:00:00");
  });

  it("snoozes to 9 AM on the next calendar day", () => {
    expect(snoozeUntil("tomorrow", new Date(2026, 9, 22, 14, 37))).toBe("2026-10-23T09:00:00");
    // Just after midnight, tomorrow is still the next day, not this morning.
    expect(snoozeUntil("tomorrow", new Date(2026, 9, 23, 0, 30))).toBe("2026-10-24T09:00:00");
    expect(snoozeUntil("tomorrow", new Date(2026, 1, 28, 20, 0))).toBe("2026-03-01T09:00:00");
    expect(snoozeUntil("tomorrow", new Date(2026, 11, 31, 22, 0))).toBe("2027-01-01T09:00:00");
  });

  it("keeps the fixed times across a DST change", () => {
    // Nov 1, 2026 and Mar 8, 2026 are US DST changes; local parts hold wherever this runs.
    expect(snoozeUntil("tomorrow", new Date(2026, 9, 31, 21, 0))).toBe("2026-11-01T09:00:00");
    expect(snoozeUntil("tomorrow", new Date(2026, 2, 7, 21, 0))).toBe("2026-03-08T09:00:00");
    expect(snoozeUntil("evening", new Date(2026, 10, 1, 8, 0))).toBe("2026-11-01T18:00:00");
  });
});

describe("snoozeChoices", () => {
  it("offers this evening while 6 PM is at least half an hour away", () => {
    expect(snoozeChoices(new Date(2026, 9, 22, 9, 0))).toEqual(["hour", "evening", "tomorrow"]);
    expect(snoozeChoices(new Date(2026, 9, 22, 17, 30))).toEqual(["hour", "evening", "tomorrow"]);
  });

  it("drops this evening once 6 PM is close or past", () => {
    expect(snoozeChoices(new Date(2026, 9, 22, 17, 31))).toEqual(["hour", "tomorrow"]);
    expect(snoozeChoices(new Date(2026, 9, 22, 18, 0))).toEqual(["hour", "tomorrow"]);
    expect(snoozeChoices(new Date(2026, 9, 22, 22, 45))).toEqual(["hour", "tomorrow"]);
  });
});
