import { describe, expect, it } from "vitest";
import { isStoredToday, parseStoredTimestamp } from "./timestamps";

describe("parseStoredTimestamp", () => {
  it("reads SQLite's zoneless CURRENT_TIMESTAMP as UTC", () => {
    expect(parseStoredTimestamp("2026-10-19 20:00:00").toISOString()).toBe("2026-10-19T20:00:00.000Z");
  });

  it("keeps a timestamp that already has a zone", () => {
    expect(parseStoredTimestamp("2026-10-19T20:00:00+02:00").toISOString()).toBe("2026-10-19T18:00:00.000Z");
  });

  it("returns an invalid date for junk rather than throwing", () => {
    expect(Number.isNaN(parseStoredTimestamp("not a date").getTime())).toBe(true);
  });
});

describe("isStoredToday", () => {
  it("compares on the local date of the UTC instant", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    expect(isStoredToday(now.toISOString().replace("T", " ").slice(0, 19), now)).toBe(true);
    expect(isStoredToday("2026-10-10 12:00:00", now)).toBe(false);
  });
});
