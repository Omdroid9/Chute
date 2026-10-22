import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Capture } from "../../types";
import type { SyncConfig } from "./syncEngine";

vi.mock("../db", () => ({
  getCaptureById: vi.fn(),
  getCaptureLinks: vi.fn(),
  getLinkedExternalIds: vi.fn(),
  saveCaptureLinks: vi.fn(),
  listPendingAppends: vi.fn(),
  markAppendDone: vi.fn(),
  markAppendFailed: vi.fn(),
  setSetting: vi.fn(),
}));
vi.mock("./appleItems", () => ({ findAppleItem: vi.fn() }));
vi.mock("./appleNotes", () => ({ appendToAppleNote: vi.fn(), createAppleNote: vi.fn() }));
vi.mock("./appleRemindersSync", () => ({ appendToAppleReminder: vi.fn(), createAppleReminder: vi.fn() }));
vi.mock("./appleCalendar", () => ({ appendToAppleCalendarEvent: vi.fn(), createAppleCalendarEvent: vi.fn() }));
vi.mock("./slack", () => ({ sendSlackFollowUp: vi.fn(), sendSlackCapture: vi.fn() }));
vi.mock("./discord", () => ({ editDiscordMessage: vi.fn(), sendDiscordFollowUp: vi.fn(), sendDiscordCapture: vi.fn() }));
vi.mock("./notion", () => ({ appendNotionAddition: vi.fn(), appendNotionCapture: vi.fn() }));
vi.mock("./googleTasks", () => ({
  appendToGoogleTaskNotes: vi.fn(),
  createGoogleTask: vi.fn(),
  refreshGoogleAccessToken: vi.fn(),
}));

const db = await import("../db");
const { appendToDestination, runAppendPass } = await import("./appendEngine");
const { appendToAppleReminder, createAppleReminder } = await import("./appleRemindersSync");
const { appendToAppleCalendarEvent } = await import("./appleCalendar");
const { sendSlackFollowUp } = await import("./slack");
const { editDiscordMessage } = await import("./discord");
const { appendNotionAddition } = await import("./notion");
const { findAppleItem } = await import("./appleItems");

const CONFIG: SyncConfig = {
  slackWebhookUrl: "https://hooks.slack.com/services/x",
  discordWebhookUrl: "https://discord.com/api/webhooks/1/abc",
  notionToken: "secret_x",
  notionPageId: "page_x",
  appleRemindersEnabled: true,
  appleCalendarEnabled: true,
};

function makeCapture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: "c1",
    content: "Pay rent Friday\nalso call the landlord",
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

describe("appendToDestination", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds a line to the reminder Chute created", async () => {
    await appendToDestination(
      "reminders",
      makeCapture(),
      { destination: "reminders", externalId: "x-apple-reminder://r1" },
      "also call the landlord",
      CONFIG,
    );
    expect(appendToAppleReminder).toHaveBeenCalledWith("x-apple-reminder://r1", "also call the landlord");
    expect(createAppleReminder).not.toHaveBeenCalled();
  });

  it("sends the addition as its own reminder when the original's id was never kept", async () => {
    await appendToDestination("reminders", makeCapture(), null, "also call the landlord", CONFIG);
    expect(createAppleReminder).toHaveBeenCalledWith(
      expect.objectContaining({ title: "also call the landlord", body: "Added to “Pay rent Friday”" }),
    );
  });

  it("refuses a Calendar addition without the event, rather than guessing", async () => {
    await expect(appendToDestination("apple_calendar", makeCapture(), null, "bring docs", CONFIG)).rejects.toThrow(
      /Couldn't find the original event/,
    );
    expect(appendToAppleCalendarEvent).not.toHaveBeenCalled();
  });

  it("edits the Discord message to the merged text", async () => {
    await appendToDestination(
      "discord",
      makeCapture(),
      { destination: "discord", externalId: "msg-1" },
      "also call the landlord",
      CONFIG,
    );
    expect(editDiscordMessage).toHaveBeenCalledWith(
      CONFIG.discordWebhookUrl,
      "msg-1",
      expect.stringContaining("Pay rent Friday\nalso call the landlord"),
    );
  });

  it("follows up in Slack, naming the original", async () => {
    await appendToDestination("slack", makeCapture(), null, "also call the landlord", CONFIG);
    expect(sendSlackFollowUp).toHaveBeenCalledWith(CONFIG.slackWebhookUrl, "Pay rent Friday", "also call the landlord");
  });

  it("puts a Notion addition right after the original block", async () => {
    await appendToDestination(
      "notion",
      makeCapture(),
      { destination: "notion", externalId: "blk-1", kind: "block" },
      "more",
      CONFIG,
    );
    expect(appendNotionAddition).toHaveBeenCalledWith({
      token: "secret_x",
      pageId: "page_x",
      ref: { kind: "block", id: "blk-1" },
      addition: "more",
    });
  });
});

describe("runAppendPass", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends in order, and holds later additions to an app after one fails", async () => {
    vi.mocked(db.listPendingAppends).mockResolvedValue([
      { id: "a1", captureId: "c1", destination: "reminders", content: "first", attempts: 0, error: null },
      { id: "a2", captureId: "c1", destination: "reminders", content: "second", attempts: 0, error: null },
      { id: "a3", captureId: "c1", destination: "slack", content: "first", attempts: 0, error: null },
    ]);
    vi.mocked(db.getCaptureById).mockResolvedValue(makeCapture({ target_reminders: 1, synced_reminders: 1 }));
    vi.mocked(db.getCaptureLinks).mockResolvedValue([{ destination: "reminders", externalId: "r1" }]);
    vi.mocked(appendToAppleReminder).mockRejectedValueOnce(new Error("Not authorized to send Apple events (-1743)"));
    const outcomes: unknown[] = [];

    const result = await runAppendPass(CONFIG, (outcome) => outcomes.push(outcome));

    expect(appendToAppleReminder).toHaveBeenCalledTimes(1);
    expect(db.markAppendFailed).toHaveBeenCalledWith("a1", "Reminders: Not authorized to send Apple events (-1743)");
    expect(db.markAppendDone).toHaveBeenCalledWith("a3");
    expect(result).toEqual({ succeeded: 1, failed: 1 });
    expect(outcomes).toEqual([{ captureId: "c1", landed: ["slack"], failed: ["reminders"] }]);
  });

  it("drops additions to a capture that was deleted", async () => {
    vi.mocked(db.listPendingAppends).mockResolvedValue([
      { id: "a1", captureId: "gone", destination: "slack", content: "x", attempts: 0, error: null },
    ]);
    vi.mocked(db.getCaptureById).mockResolvedValue(null);
    vi.mocked(db.getCaptureLinks).mockResolvedValue([]);
    await runAppendPass(CONFIG);
    expect(db.markAppendDone).toHaveBeenCalledWith("a1");
    expect(sendSlackFollowUp).not.toHaveBeenCalled();
  });

  it("waits while an app is disconnected", async () => {
    vi.mocked(db.listPendingAppends).mockResolvedValue([
      { id: "a1", captureId: "c1", destination: "slack", content: "x", attempts: 0, error: null },
    ]);
    vi.mocked(db.getCaptureById).mockResolvedValue(makeCapture());
    vi.mocked(db.getCaptureLinks).mockResolvedValue([]);
    await runAppendPass({});
    expect(db.markAppendDone).not.toHaveBeenCalled();
    expect(db.markAppendFailed).not.toHaveBeenCalled();
  });
});

describe("additions to captures sent before Chute kept ids", () => {
  beforeEach(() => vi.clearAllMocks());

  const erin = makeCapture({
    id: "erin",
    content: "Call with Erin\nand call jatin",
    created_at: "2026-10-19 20:29:52",
    reminder_time: "2026-10-19T18:00:00",
    target_apple_calendar: 1,
    synced_apple_calendar: 1,
  });

  it("finds the original event, remembers it, and adds to it", async () => {
    vi.mocked(db.listPendingAppends).mockResolvedValue([
      { id: "a1", captureId: "erin", destination: "apple_calendar", content: "and call jatin", attempts: 1, error: "x" },
    ]);
    vi.mocked(db.getCaptureById).mockResolvedValue(erin);
    vi.mocked(db.getCaptureLinks).mockResolvedValue([]);
    vi.mocked(db.getLinkedExternalIds).mockResolvedValue(["OTHER-UID"]);
    vi.mocked(findAppleItem).mockResolvedValue("EVENT-UID");

    await runAppendPass(CONFIG);

    expect(findAppleItem).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: "apple_calendar",
        title: "Call with Erin",
        container: "",
        start: "2026-10-19T18:00:00",
        excluded: ["OTHER-UID"],
      }),
    );
    // The capture's UTC time, as local time, bounds how old the event can be.
    const notBefore = vi.mocked(findAppleItem).mock.calls[0][0].notBefore;
    expect(new Date(notBefore).getTime()).toBe(new Date("2026-10-19T20:29:52Z").getTime());
    expect(db.saveCaptureLinks).toHaveBeenCalledWith("erin", [
      { destination: "apple_calendar", externalId: "EVENT-UID" },
    ]);
    expect(appendToAppleCalendarEvent).toHaveBeenCalledWith("EVENT-UID", "and call jatin", "");
    expect(db.markAppendDone).toHaveBeenCalledWith("a1");
  });

  it("reports a missing event when nothing matches", async () => {
    vi.mocked(db.listPendingAppends).mockResolvedValue([
      { id: "a1", captureId: "erin", destination: "apple_calendar", content: "and call jatin", attempts: 0, error: null },
    ]);
    vi.mocked(db.getCaptureById).mockResolvedValue(erin);
    vi.mocked(db.getCaptureLinks).mockResolvedValue([]);
    vi.mocked(db.getLinkedExternalIds).mockResolvedValue([]);
    vi.mocked(findAppleItem).mockResolvedValue("");

    await runAppendPass(CONFIG);

    expect(db.saveCaptureLinks).not.toHaveBeenCalled();
    expect(db.markAppendFailed).toHaveBeenCalledWith(
      "a1",
      "Apple Calendar: Couldn't find the original event in Calendar.",
    );
  });

  it("looks up a note by its first line, without list markers", async () => {
    vi.mocked(db.listPendingAppends).mockResolvedValue([
      { id: "a1", captureId: "n", destination: "apple_notes", content: "more", attempts: 0, error: null },
    ]);
    vi.mocked(db.getCaptureById).mockResolvedValue(
      makeCapture({ id: "n", content: "- buy milk\n- eggs", target_apple_reminders: 1, synced_apple_reminders: 1 }),
    );
    vi.mocked(db.getCaptureLinks).mockResolvedValue([]);
    vi.mocked(db.getLinkedExternalIds).mockResolvedValue([]);
    vi.mocked(findAppleItem).mockResolvedValue("NOTE-1");

    await runAppendPass({ ...CONFIG, appleNotesEnabled: true, appleNotesFolder: "Chute" });

    expect(findAppleItem).toHaveBeenCalledWith(
      expect.objectContaining({ destination: "apple_notes", title: "buy milk", container: "Chute" }),
    );
  });
});
