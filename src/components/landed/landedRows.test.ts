import { describe, expect, it } from "vitest";
import type { Capture } from "../../types";
import { countLanded, toLandedRow } from "./landedRows";

function makeCapture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: "c1",
    content: "call mom\n tomorrow at 5pm",
    tag: "untagged",
    capture_lane: "focus",
    list_name: "Inbox",
    created_at: "2026-10-19 20:00:00",
    synced_slack: 0,
    synced_discord: 0,
    synced_google_tasks: 0,
    synced_google_calendar: 0,
    synced_notion: 0,
    synced_apple_reminders: 0,
    synced_reminders: 0,
    synced_apple_calendar: 0,
    target_slack: 0,
    target_discord: 0,
    target_notion: 0,
    target_google_tasks: 0,
    target_google_calendar: 0,
    target_apple_reminders: 0,
    target_reminders: 0,
    target_apple_calendar: 0,
    reminder_time: null,
    recurrence_rule: null,
    recurrence_next_at: null,
    routing_source: null,
    routing_reason: null,
    ...overrides,
  };
}

describe("toLandedRow", () => {
  it("is landed once every destination synced, on one line", () => {
    const row = toLandedRow(makeCapture({ target_reminders: 1, synced_reminders: 1 }));
    expect(row).toEqual({ id: "c1", text: "call mom tomorrow at 5pm", where: "Reminders", status: "landed" });
  });

  it("names the legacy apple_reminders columns as Notes", () => {
    const row = toLandedRow(makeCapture({ target_apple_reminders: 1 }));
    expect(row.where).toBe("Notes");
    expect(row.status).toBe("pending");
  });

  it("needs attention when a destination is unsynced and an error was recorded", () => {
    const row = toLandedRow(
      makeCapture({
        target_apple_calendar: 1,
        target_slack: 1,
        synced_slack: 1,
        last_sync_error: "Calendar: -1743",
      }),
    );
    expect(row).toMatchObject({ where: "Calendar + Slack", status: "failed" });
  });

  it("shortens three or more destinations", () => {
    const row = toLandedRow(makeCapture({ target_reminders: 1, target_notion: 1, target_slack: 1 }));
    expect(row.where).toBe("Reminders +2");
  });

  it("keeps captures with no destination in Chute", () => {
    expect(toLandedRow(makeCapture()).status).toBe("kept");
  });
});

describe("countLanded", () => {
  it("counts failures and pending rows", () => {
    const rows = [
      toLandedRow(makeCapture({ id: "a", target_slack: 1, synced_slack: 1 })),
      toLandedRow(makeCapture({ id: "b", target_slack: 1, last_sync_error: "x" })),
      toLandedRow(makeCapture({ id: "c", target_slack: 1 })),
    ];
    expect(countLanded(rows)).toEqual({ total: 3, failed: 1, pending: 1 });
  });
});
