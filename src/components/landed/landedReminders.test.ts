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
}));

vi.mock("@tauri-apps/api/event", () => ({ emit: (...args: unknown[]) => record("emit")(...args) }));
vi.mock("../../lib/db", () => ({
  getCaptureById: (...args: unknown[]) => record("getCaptureById", { id: "c1", content: "pay rent" })(...args),
  setCaptureCompleted: (...args: unknown[]) => record("setCaptureCompleted")(...args),
  setCaptureReminder: (...args: unknown[]) => record("setCaptureReminder")(...args),
}));
vi.mock("../../lib/sync/appendEngine", () => ({ findOriginalAppleItem: mocks.findOriginalAppleItem }));
vi.mock("../../lib/sync/appleRemindersSync", () => ({
  setAppleReminderCompleted: mocks.setAppleReminderCompleted,
  snoozeAppleReminder: (...args: unknown[]) => record("snoozeAppleReminder")(...args),
}));
vi.mock("../../lib/sync/syncManager", () => ({ loadSyncConfig: () => Promise.resolve({}) }));

const { setReminderDone, snoozeReminder } = await import("./landedReminders");

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
    createdAt: "2026-10-22 15:00:00",
  };
}

beforeEach(() => {
  calls.length = 0;
  mocks.setAppleReminderCompleted.mockImplementation(record("setAppleReminderCompleted"));
  mocks.findOriginalAppleItem.mockImplementation(record("findOriginalAppleItem", null));
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
