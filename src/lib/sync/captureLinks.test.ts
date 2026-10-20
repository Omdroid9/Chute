import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Capture } from "../../types";

vi.mock("../db", () => ({ setSetting: vi.fn() }));
vi.mock("./appleNotes", () => ({ createAppleNote: vi.fn() }));
vi.mock("./appleRemindersSync", () => ({ createAppleReminder: vi.fn() }));
vi.mock("./appleCalendar", () => ({ createAppleCalendarEvent: vi.fn() }));
vi.mock("./slack", () => ({ sendSlackCapture: vi.fn() }));
vi.mock("./discord", () => ({ sendDiscordCapture: vi.fn() }));
vi.mock("./notion", () => ({ appendNotionCapture: vi.fn() }));
vi.mock("./googleTasks", () => ({ createGoogleTask: vi.fn(), refreshGoogleAccessToken: vi.fn() }));

const { syncCapture } = await import("./syncEngine");
const { createAppleNote } = await import("./appleNotes");
const { createAppleReminder } = await import("./appleRemindersSync");
const { createAppleCalendarEvent } = await import("./appleCalendar");
const { sendSlackCapture } = await import("./slack");
const { sendDiscordCapture } = await import("./discord");
const { appendNotionCapture } = await import("./notion");
const { discordWaitUrl } = await vi.importActual<typeof import("./discord")>("./discord");
const { readJsonId } = await import("../net/http");

function makeCapture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: "c1",
    content: "call mom tomorrow at 5pm",
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
    ...overrides,
  };
}

describe("syncCapture links", () => {
  beforeEach(() => vi.clearAllMocks());

  it("links each Apple item to the id its writer returned", async () => {
    vi.mocked(createAppleNote).mockResolvedValue("x-coredata://note/p1");
    vi.mocked(createAppleReminder).mockResolvedValue("x-apple-reminder://r1");
    vi.mocked(createAppleCalendarEvent).mockResolvedValue("EVT-UID-1");
    const result = await syncCapture(
      makeCapture({
        target_apple_reminders: 1,
        target_reminders: 1,
        target_apple_calendar: 1,
        reminder_time: "2026-10-20T17:00:00",
      }),
      { appleNotesEnabled: true, appleRemindersEnabled: true, appleCalendarEnabled: true },
    );
    expect(result.links).toEqual([
      { destination: "apple_notes", externalId: "x-coredata://note/p1" },
      { destination: "reminders", externalId: "x-apple-reminder://r1" },
      { destination: "apple_calendar", externalId: "EVT-UID-1" },
    ]);
  });

  it("records no link for a destination that failed", async () => {
    vi.mocked(createAppleCalendarEvent).mockRejectedValue(
      new Error("Not authorized to send Apple events to Calendar. (-1743)"),
    );
    const result = await syncCapture(
      makeCapture({ target_apple_calendar: 1, reminder_time: "2026-10-20T17:00:00" }),
      { appleCalendarEnabled: true },
    );
    expect(result.appleCalendarSynced).toBe(false);
    expect(result.attempted).toEqual(["apple_calendar"]);
    expect(result.links).toEqual([]);
  });

  it("never links Slack (webhooks return no id) and skips empty ids", async () => {
    vi.mocked(sendSlackCapture).mockResolvedValue(undefined);
    vi.mocked(sendDiscordCapture).mockResolvedValue("");
    const result = await syncCapture(makeCapture({ target_slack: 1, target_discord: 1 }), {
      slackWebhookUrl: "https://hooks.slack.com/services/x",
      discordWebhookUrl: "https://discord.com/api/webhooks/1/abc",
    });
    expect(result.slackSynced).toBe(true);
    expect(result.discordSynced).toBe(true);
    expect(result.links).toEqual([]);
  });

  it("keeps the kind of Notion item that was created", async () => {
    vi.mocked(appendNotionCapture).mockResolvedValue({ kind: "page", id: "notion-page-1" });
    const result = await syncCapture(makeCapture({ target_notion: 1 }), {
      notionToken: "secret_x",
      notionPageId: "page_x",
    });
    expect(result.links).toEqual([{ destination: "notion", externalId: "notion-page-1", kind: "page" }]);
  });
});

describe("discordWaitUrl", () => {
  it("asks Discord to return the posted message", () => {
    expect(discordWaitUrl("https://discord.com/api/webhooks/1/abc")).toBe(
      "https://discord.com/api/webhooks/1/abc?wait=true",
    );
  });

  it("keeps existing query parameters such as a thread", () => {
    expect(discordWaitUrl("https://discord.com/api/webhooks/1/abc?thread_id=9")).toBe(
      "https://discord.com/api/webhooks/1/abc?thread_id=9&wait=true",
    );
  });

  it("leaves an unparseable URL alone", () => {
    expect(discordWaitUrl("not a url")).toBe("not a url");
  });
});

describe("readJsonId", () => {
  it("reads the id the picker selects", async () => {
    const response = new Response(JSON.stringify({ id: "task-1" }));
    expect(await readJsonId(response, (body) => body.id)).toBe("task-1");
  });

  it("returns an empty id instead of throwing on a body that isn't JSON", async () => {
    expect(await readJsonId(new Response("ok"), (body) => body.id)).toBe("");
  });

  it("ignores ids that aren't strings", async () => {
    expect(await readJsonId(new Response(JSON.stringify({ id: 42 })), (body) => body.id)).toBe("");
  });
});
