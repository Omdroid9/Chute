import { describe, expect, it } from "vitest";
import { formatReminderTime, parseReminderTime } from "./reminderTime";

// Built from local parts so the tests hold in any time zone.
const now = new Date(2026, 9, 19, 12, 0, 0);

// Some ICU versions put a narrow no-break space before AM/PM.
function format(value: string, at = now, locale = "en-US"): string {
  return formatReminderTime(value, at, locale).replace(/\s/g, " ");
}

describe("parseReminderTime", () => {
  it("reads a zoneless ISO string as local time", () => {
    const date = parseReminderTime("2026-10-20T16:00:00");
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()]).toEqual([
      2026, 9, 20, 16, 0,
    ]);
  });

  it("reads a bare date as local midnight", () => {
    expect(parseReminderTime("2026-10-20").getTime()).toBe(new Date(2026, 9, 20).getTime());
  });

  it("keeps a timestamp that already has a zone", () => {
    expect(parseReminderTime("2026-10-20T16:00:00Z").toISOString()).toBe("2026-10-20T16:00:00.000Z");
  });

  it("returns an invalid date for junk rather than throwing", () => {
    expect(Number.isNaN(parseReminderTime("not a date").getTime())).toBe(true);
  });
});

describe("formatReminderTime", () => {
  it("says Today for a time later today", () => {
    expect(format("2026-10-19T16:00:00")).toBe("Today 4:00 PM");
  });

  it("says Tomorrow for the next day", () => {
    expect(format("2026-10-20T09:00:00")).toBe("Tomorrow 9:00 AM");
  });

  it("says Tomorrow just after midnight even when under 24 hours away", () => {
    const lateNight = new Date(2026, 9, 19, 23, 30);
    expect(format("2026-10-20T00:15:00", lateNight)).toBe("Tomorrow 12:15 AM");
  });

  it("says Yesterday for the previous day", () => {
    expect(format("2026-10-18T18:30:00")).toBe("Yesterday 6:30 PM");
  });

  it("uses weekday and date further out", () => {
    expect(format("2026-10-27T16:00:00")).toBe("Tue, Oct 27 4:00 PM");
  });

  it("adds the year when it isn't this year", () => {
    expect(format("2027-01-05T08:00:00")).toBe("Tue, Jan 5, 2027 8:00 AM");
  });

  it("follows the locale", () => {
    expect(format("2026-10-19T16:00:00", now, "en-GB")).toBe("Today 16:00");
  });

  it("returns unparseable values unchanged", () => {
    expect(format("someday")).toBe("someday");
  });
});
