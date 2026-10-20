import { describe, expect, it } from "vitest";
import type { Capture } from "../../types";
import type { SyncConfig } from "../../lib/sync/syncEngine";
import { describeDestinations } from "../../lib/sync/destinations";
import { countLanded, primaryTarget, toLandedRow } from "./landedRows";

const CONFIG: SyncConfig = {
  slackWebhookUrl: "https://hooks.slack.com/services/x",
  notionToken: "secret_x",
  notionPageId: "page_x",
  appleNotesEnabled: true,
  appleRemindersEnabled: true,
  appleCalendarEnabled: true,
};

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
    const row = toLandedRow(makeCapture({ target_reminders: 1, synced_reminders: 1 }), CONFIG, [
      { destination: "reminders", externalId: "x-apple-reminder://r1" },
    ]);
    expect(row).toMatchObject({ text: "call mom tomorrow at 5pm", where: "Reminders", status: "landed" });
    expect(row.targets[0].link?.externalId).toBe("x-apple-reminder://r1");
  });

  it("names the legacy apple_reminders columns as Notes", () => {
    const row = toLandedRow(makeCapture({ target_apple_reminders: 1 }), CONFIG);
    expect(row).toMatchObject({ where: "Notes", status: "pending" });
  });

  it("needs attention when a destination is unsynced and an error was recorded", () => {
    const row = toLandedRow(
      makeCapture({
        target_apple_calendar: 1,
        target_slack: 1,
        synced_slack: 1,
        reminder_time: "2026-10-20T16:00:00",
        last_sync_error: "Apple Calendar: Not authorized to send Apple events to Calendar. (-1743)",
      }),
      CONFIG,
    );
    expect(row).toMatchObject({ where: "Calendar + Slack", status: "failed" });
    expect(row.problem).toEqual({
      kind: "permission",
      app: "Calendar",
      message: "Chute needs permission to use Calendar",
    });
  });

  it("treats destinations that aren't connected as kept in Chute", () => {
    // Discord isn't configured, and an untimed capture never goes to a calendar.
    const row = toLandedRow(makeCapture({ target_discord: 1, target_apple_calendar: 1 }), CONFIG);
    expect(row).toMatchObject({ where: "Chute", status: "kept", targets: [] });
  });

  it("drops a stale error once everything landed", () => {
    const row = toLandedRow(
      makeCapture({ target_slack: 1, synced_slack: 1, last_sync_error: "Slack: HTTP 500: oops" }),
      CONFIG,
    );
    expect(row.status).toBe("landed");
    expect(row.problem).toBeNull();
  });
});

describe("toLandedRow with additions", () => {
  const landed = makeCapture({ target_reminders: 1, synced_reminders: 1 });

  it("reads as on its way while an addition is queued", () => {
    expect(toLandedRow(landed, CONFIG, [], { pending: 1, error: null }).status).toBe("pending");
  });

  it("needs attention when an addition is stuck", () => {
    const row = toLandedRow(landed, CONFIG, [], {
      pending: 1,
      error: "Reminders: Not authorized to send Apple events to Reminders. (-1743)",
    });
    expect(row.status).toBe("failed");
    expect(row.problem?.kind).toBe("permission");
  });
});

describe("primaryTarget", () => {
  it("opens the first place the capture landed", () => {
    const row = toLandedRow(
      makeCapture({ target_reminders: 1, target_notion: 1, synced_notion: 1 }),
      CONFIG,
    );
    expect(primaryTarget(row)?.destination).toBe("notion");
  });

  it("has nothing to open for captures kept in Chute", () => {
    expect(primaryTarget(toLandedRow(makeCapture(), CONFIG))).toBeNull();
  });
});

describe("describeDestinations", () => {
  it("joins two and shortens three or more", () => {
    expect(describeDestinations(["apple_notes", "slack"])).toBe("Notes + Slack");
    expect(describeDestinations(["reminders", "notion", "slack"])).toBe("Reminders +2");
  });
});

describe("countLanded", () => {
  it("counts failures and pending rows", () => {
    const rows = [
      toLandedRow(makeCapture({ id: "a", target_slack: 1, synced_slack: 1 }), CONFIG),
      toLandedRow(makeCapture({ id: "b", target_slack: 1, last_sync_error: "Slack: HTTP 500" }), CONFIG),
      toLandedRow(makeCapture({ id: "c", target_slack: 1 }), CONFIG),
    ];
    expect(countLanded(rows)).toEqual({ total: 3, failed: 1, pending: 1 });
  });
});
