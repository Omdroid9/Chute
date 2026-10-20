import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Capture } from "../../types";

vi.mock("../db", () => ({
  enqueueCaptureAppends: vi.fn(),
  getCaptureById: vi.fn(),
  getSetting: vi.fn(),
  getSettings: vi.fn(),
  hasCaptureAppend: vi.fn(),
  listDueRecurringReminderCaptures: vi.fn(),
  listCaptures: vi.fn(),
  saveCaptureLinks: vi.fn(),
  setCaptureContent: vi.fn(),
  setCaptureRecurrenceNextAt: vi.fn(),
  setCaptureSyncError: vi.fn(),
  setSetting: vi.fn(),
  updateCaptureSyncStatus: vi.fn(),
}));

const db = await import("../db");
const { addToCapture } = await import("./syncManager");

function makeCapture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: "c1",
    content: "Standup recap  ",
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

describe("addToCapture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getSettings).mockResolvedValue({
      slack_webhook_url: "https://hooks.slack.com/services/x",
      discord_webhook_url: "https://discord.com/api/webhooks/1/abc",
    });
  });

  it("merges into a capture that hasn't been sent anywhere yet", async () => {
    vi.mocked(db.getCaptureById).mockResolvedValue(makeCapture({ target_slack: 1 }));
    const result = await addToCapture("c1", "  ship the deck  ");
    expect(db.setCaptureContent).toHaveBeenCalledWith("c1", "Standup recap\nship the deck");
    expect(db.enqueueCaptureAppends).not.toHaveBeenCalled();
    expect(result.appendedTo).toEqual([]);
  });

  it("queues the addition only for apps the capture already reached", async () => {
    vi.mocked(db.getCaptureById).mockResolvedValue(
      makeCapture({ target_slack: 1, synced_slack: 1, target_discord: 1, synced_discord: 0 }),
    );
    const result = await addToCapture("c1", "ship the deck");
    expect(db.enqueueCaptureAppends).toHaveBeenCalledWith("c1", ["slack"], "ship the deck");
    expect(result.appendedTo).toEqual(["slack"]);
  });

  it("refuses an empty addition", async () => {
    await expect(addToCapture("c1", "   ")).rejects.toThrow(/Type what to add/);
    expect(db.setCaptureContent).not.toHaveBeenCalled();
  });
});
