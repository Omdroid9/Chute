import { describe, expect, it } from "vitest";
import { pendingDestinations, requiresSync, type SyncConfig } from "./syncEngine";
import type { Capture } from "../../types";

function makeCapture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: "c1",
    content: "hello",
    tag: "untagged",
    capture_lane: "focus",
    list_name: "Inbox",
    created_at: "2026-06-04T10:00:00",
    synced_slack: 0,
    synced_discord: 0,
    synced_google_tasks: 0,
    synced_google_calendar: 0,
    synced_notion: 0,
    synced_apple_reminders: 0,
    target_slack: 0,
    target_discord: 0,
    target_notion: 0,
    target_google_tasks: 0,
    target_google_calendar: 0,
    target_apple_reminders: 0,
    reminder_time: null,
    recurrence_rule: null,
    recurrence_next_at: null,
    ...overrides,
  };
}

const FULL_CONFIG: SyncConfig = {
  slackWebhookUrl: "https://hooks.slack.com/services/x",
  discordWebhookUrl: "https://discord.com/api/webhooks/x",
  notionToken: "secret_x",
  notionPageId: "page_x",
  googleTasksAccessToken: "ya29.x",
  googleTasksListId: "@default",
  googleCalendarId: "primary",
  appleNotesEnabled: true,
};

describe("requiresSync", () => {
  it("returns false when nothing is targeted", () => {
    expect(requiresSync(makeCapture(), FULL_CONFIG)).toBe(false);
  });

  it("returns false when a target is enabled but its config is missing", () => {
    const capture = makeCapture({ target_slack: 1 });
    expect(requiresSync(capture, {})).toBe(false);
  });

  it("requires sync for a freshly targeted Slack capture", () => {
    expect(requiresSync(makeCapture({ target_slack: 1 }), FULL_CONFIG)).toBe(true);
  });

  it("does not re-sync a capture already synced to its only target", () => {
    const capture = makeCapture({ target_slack: 1, synced_slack: 1 });
    expect(requiresSync(capture, FULL_CONFIG)).toBe(false);
  });

  it("does NOT sync calendar when there is no reminder time", () => {
    const capture = makeCapture({ target_google_calendar: 1, reminder_time: null });
    expect(requiresSync(capture, FULL_CONFIG)).toBe(false);
  });

  it("syncs calendar once a reminder time is present", () => {
    const capture = makeCapture({
      target_google_calendar: 1,
      reminder_time: "2026-06-05T09:00:00",
    });
    expect(requiresSync(capture, FULL_CONFIG)).toBe(true);
  });

  it("requires sync for Notion only when both token and parent id are set", () => {
    const capture = makeCapture({ target_notion: 1 });
    expect(requiresSync(capture, { notionToken: "secret_x" })).toBe(false);
    expect(requiresSync(capture, { notionToken: "secret_x", notionPageId: "page_x" })).toBe(true);
  });

  it("syncs Apple Notes only when enabled (macOS)", () => {
    const capture = makeCapture({ target_apple_reminders: 1 });
    expect(requiresSync(capture, { appleNotesEnabled: false })).toBe(false);
    expect(requiresSync(capture, { appleNotesEnabled: true })).toBe(true);
  });
});

describe("pendingDestinations", () => {
  it("lists what a pass would send, in display order, skipping what already landed", () => {
    const capture = makeCapture({
      target_slack: 1,
      target_notion: 1,
      synced_notion: 1,
      target_apple_reminders: 1,
      target_google_calendar: 1,
      reminder_time: "2026-06-05T09:00:00",
    });
    expect(pendingDestinations(capture, FULL_CONFIG)).toEqual(["apple_notes", "google_calendar", "slack"]);
  });

  it("never sends an untimed capture to a calendar", () => {
    const capture = makeCapture({ target_google_calendar: 1 });
    expect(pendingDestinations(capture, FULL_CONFIG)).toEqual([]);
  });
});
