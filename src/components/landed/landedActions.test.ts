import { describe, expect, it } from "vitest";
import { googleCalendarDayUrl, notionUrl } from "./landedActions";

describe("notionUrl", () => {
  it("opens a database page directly", () => {
    expect(notionUrl({ destination: "notion", externalId: "a1b2-c3", kind: "page" }, "page-1")).toBe(
      "https://www.notion.so/a1b2c3",
    );
  });

  it("opens an appended block on its page", () => {
    expect(notionUrl({ destination: "notion", externalId: "blk-9", kind: "block" }, "pa-ge")).toBe(
      "https://www.notion.so/page#blk9",
    );
  });

  it("falls back to the configured page, then Notion itself", () => {
    expect(notionUrl(null, "pa-ge")).toBe("https://www.notion.so/page");
    expect(notionUrl(null, undefined)).toBe("https://www.notion.so/");
  });
});

describe("googleCalendarDayUrl", () => {
  it("opens the day of the event", () => {
    expect(googleCalendarDayUrl("2026-10-07T16:30:00")).toBe("https://calendar.google.com/calendar/r/day/2026/10/7");
  });

  it("falls back to the calendar for untimed captures", () => {
    expect(googleCalendarDayUrl(null)).toBe("https://calendar.google.com/");
  });
});
