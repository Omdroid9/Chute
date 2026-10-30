import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LandedRow } from "./landedRows";

const calls: string[] = [];
const record =
  (name: string, result?: unknown) =>
  (...args: unknown[]) => {
    calls.push(`${name} ${JSON.stringify(args)}`);
    return Promise.resolve(result);
  };

const mocks = vi.hoisted(() => ({
  setAppleReminderCompleted: vi.fn(),
  findOriginalAppleItem: vi.fn(),
  snoozeAppleReminder: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ emit: (...args: unknown[]) => record("emit")(...args) }));
vi.mock("../../lib/db", () => ({
  getCaptureById: (...args: unknown[]) => record("getCaptureById", { id: "c1", content: "pay rent" })(...args),
  setCaptureCompleted: (...args: unknown[]) => record("setCaptureCompleted")(...args),
  setCaptureReminder: (...args: unknown[]) => record("setCaptureReminder")(...args),
  setCapturePlannedAt: (...args: unknown[]) => record("setCapturePlannedAt")(...args),
  saveCaptureLinks: (...args: unknown[]) => record("saveCaptureLinks")(...args),
}));
vi.mock("../../lib/sync/appleCalendar", () => ({
  moveAppleCalendarEvent: (...args: unknown[]) => record("moveAppleCalendarEvent")(...args),
}));
vi.mock("../../lib/sync/appendEngine", () => ({ findOriginalAppleItem: mocks.findOriginalAppleItem }));
vi.mock("../../lib/sync/appleRemindersSync", () => ({
  setAppleReminderCompleted: mocks.setAppleReminderCompleted,
  snoozeAppleReminder: mocks.snoozeAppleReminder,
  createAppleReminder: (...args: unknown[]) => record("createAppleReminder", "x-apple-reminder://new")(...args),
}));
vi.mock("../../lib/sync/syncManager", () => ({
  loadSyncConfig: () => Promise.resolve({ appleRemindersList: "Chute", appleCalendarName: "Work" }),
}));

const { moveToDay, setReminderDone, snoozeReminder } = await import("./landedReminders");

function row(externalId: string | null): LandedRow {
  return {
    id: "c1",
    text: "pay rent",
    fullText: "pay rent",
    kind: "reminder",
    where: "Reminders",
    status: "landed",
    targets: [
      {
        destination: "reminders",
        label: "Reminders",
        synced: true,
        link: externalId ? { destination: "reminders", externalId } : null,
      },
    ],
    problem: null,
    reminderTime: "2026-10-22T16:00:00",
    recurring: false,
    done: false,
    plannedAt: null,
    planLink: null,
    createdAt: "2026-10-22 15:00:00",
  };
}

beforeEach(() => {
  calls.length = 0;
  mocks.setAppleReminderCompleted.mockImplementation(record("setAppleReminderCompleted"));
  mocks.findOriginalAppleItem.mockImplementation(record("findOriginalAppleItem", null));
  mocks.snoozeAppleReminder.mockImplementation(record("snoozeAppleReminder"));
});

describe("setReminderDone", () => {
  it("completes the kept reminder, then records it", async () => {
    await setReminderDone(row("x-apple-reminder://r1"), true);
    expect(calls).toEqual([
      'setAppleReminderCompleted ["x-apple-reminder://r1",true]',
      'setCaptureCompleted ["c1",true]',
      'emit ["chute://captures-changed"]',
    ]);
  });

  it("records nothing when Reminders refuses", async () => {
    mocks.setAppleReminderCompleted.mockRejectedValue(new Error("Not authorized to send Apple events (-1743)"));
    await expect(setReminderDone(row("x-apple-reminder://r1"), true)).rejects.toThrow("-1743");
    expect(calls).toEqual([]);
  });

  it("finds a reminder sent before Chute kept ids", async () => {
    mocks.findOriginalAppleItem.mockImplementation(
      record("findOriginalAppleItem", { destination: "reminders", externalId: "x-apple-reminder://old" }),
    );
    await setReminderDone(row(null), false);
    expect(calls[0]).toBe('getCaptureById ["c1"]');
    expect(calls).toContain('setAppleReminderCompleted ["x-apple-reminder://old",false]');
    expect(calls).toContain('setCaptureCompleted ["c1",false]');
  });

  it("says so when the reminder can't be found", async () => {
    await expect(setReminderDone(row(null), true)).rejects.toThrow("Couldn't find the reminder");
    expect(calls.some((call) => call.startsWith("setCaptureCompleted"))).toBe(false);
  });
});

describe("snoozeReminder", () => {
  it("moves the reminder, then the capture's reminder time", async () => {
    await snoozeReminder(row("x-apple-reminder://r1"), "2026-10-23T09:00:00");
    expect(calls).toEqual([
      'snoozeAppleReminder ["x-apple-reminder://r1","2026-10-23T09:00:00"]',
      'setCaptureReminder ["c1","2026-10-23T09:00:00"]',
      'emit ["chute://captures-changed"]',
    ]);
  });
});

describe("moveToDay", () => {
  const at = "2026-10-23T16:00:00";

  it("moves a reminder in Reminders, then in Chute, and it's no longer done", async () => {
    await moveToDay({ ...row("x-apple-reminder://r1"), done: true }, "reminder", at);
    expect(calls).toEqual([
      `snoozeAppleReminder ["x-apple-reminder://r1","${at}"]`,
      `setCaptureReminder ["c1","${at}"]`,
      'setCaptureCompleted ["c1",false]',
      'emit ["chute://captures-changed"]',
    ]);
  });

  it("moves an event in the calendar Chute writes to, then in Chute", async () => {
    const event: LandedRow = {
      ...row(null),
      kind: "event",
      targets: [
        {
          destination: "apple_calendar",
          label: "Calendar",
          synced: true,
          link: { destination: "apple_calendar", externalId: "E1" },
        },
      ],
    };
    await moveToDay(event, "event", at);
    expect(calls).toEqual([
      `moveAppleCalendarEvent ["E1","${at}","Work"]`,
      `setCaptureReminder ["c1","${at}"]`,
      'emit ["chute://captures-changed"]',
    ]);
  });

  const note: LandedRow = {
    ...row(null),
    text: "ideas for the offsite agenda",
    fullText: "ideas for the offsite\nagenda draft",
    kind: "note",
    targets: [{ destination: "apple_notes", label: "Notes", synced: true, link: null }],
    reminderTime: null,
  };

  it("gives a note its day and a reminder to bring it up", async () => {
    await moveToDay(note, "plan", at);
    expect(calls).toEqual([
      `createAppleReminder [{"list":"Chute","title":"ideas for the offsite","body":"agenda draft","dueDate":"${at}"}]`,
      'saveCaptureLinks ["c1",[{"destination":"reminders","externalId":"x-apple-reminder://new","kind":"planned"}]]',
      `setCapturePlannedAt ["c1","${at}"]`,
      'emit ["chute://captures-changed"]',
    ]);
  });

  it("moves the reminder made last time instead of making another", async () => {
    const planned = { destination: "reminders" as const, externalId: "x-apple-reminder://p1", kind: "planned" };
    await moveToDay({ ...note, planLink: planned }, "plan", at);
    expect(calls).toEqual([
      `snoozeAppleReminder ["x-apple-reminder://p1","${at}"]`,
      `setCapturePlannedAt ["c1","${at}"]`,
      'emit ["chute://captures-changed"]',
    ]);
  });

  it("makes a new reminder when the old one was deleted, but not without permission", async () => {
    const planned = { destination: "reminders" as const, externalId: "x-apple-reminder://gone", kind: "planned" };
    mocks.snoozeAppleReminder.mockRejectedValueOnce(new Error("Can't get reminder id. (-1728)"));
    await moveToDay({ ...note, planLink: planned }, "plan", at);
    expect(calls[0]).toMatch(/^createAppleReminder/);

    calls.length = 0;
    mocks.snoozeAppleReminder.mockRejectedValueOnce(new Error("Not authorized to send Apple events to Reminders. (-1743)"));
    await expect(moveToDay({ ...note, planLink: planned }, "plan", at)).rejects.toThrow(/-1743/);
    expect(calls).toEqual([]);
  });
});
