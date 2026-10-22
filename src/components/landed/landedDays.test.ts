import { describe, expect, it } from "vitest";
import type { Capture } from "../../types";
import type { LandedRow } from "./landedRows";
import { dueOn, failedIds, firstDueOn, patchRow, startOfLocalDay } from "./landedDays";

// Local parts throughout, so the tests hold in any time zone.
const now = new Date(2026, 9, 21, 14, 0);
const tomorrow = startOfLocalDay(1, now);

function capture(overrides: Partial<Capture>): Capture {
  return {
    id: "c1",
    content: "standup prep",
    reminder_time: null,
    recurrence_rule: null,
    recurrence_next_at: null,
    ...overrides,
  } as Capture;
}

function row(id: string, status: LandedRow["status"]): LandedRow {
  return {
    id,
    text: id,
    fullText: id,
    kind: "reminder",
    where: "Reminders",
    status,
    targets: [],
    problem: null,
    reminderTime: null,
    recurring: false,
    done: false,
    createdAt: "2026-10-21 12:00:00",
  };
}

describe("startOfLocalDay", () => {
  it("is local midnight, offset by whole days", () => {
    expect(startOfLocalDay(1, now)).toEqual(new Date(2026, 9, 22));
    expect(startOfLocalDay(-1, now)).toEqual(new Date(2026, 9, 20));
  });

  it("crosses month ends", () => {
    expect(startOfLocalDay(1, new Date(2026, 9, 31, 23, 0))).toEqual(new Date(2026, 10, 1));
  });
});

describe("firstDueOn", () => {
  it("uses a reminder time on that day", () => {
    expect(firstDueOn(capture({ reminder_time: "2026-10-22T09:00:00" }), tomorrow)).toEqual(
      new Date(2026, 9, 22, 9, 0),
    );
  });

  it("ignores reminders on other days, including just after midnight the day after", () => {
    expect(firstDueOn(capture({ reminder_time: "2026-10-21T23:59:00" }), tomorrow)).toBeNull();
    expect(firstDueOn(capture({ reminder_time: "2026-10-23T00:00:00" }), tomorrow)).toBeNull();
  });

  it("walks a repeating reminder forward to its first time that day", () => {
    const daily = capture({
      reminder_time: "2026-10-01T09:00:00",
      recurrence_rule: "every:1:day",
      recurrence_next_at: "2026-10-21T09:00:00",
    });
    expect(firstDueOn(daily, tomorrow)).toEqual(new Date(2026, 9, 22, 9, 0));
  });

  it("takes the earliest occurrence of an hourly reminder", () => {
    const hourly = capture({ recurrence_rule: "every:2:hour", recurrence_next_at: "2026-10-21T15:30:00" });
    expect(firstDueOn(hourly, tomorrow)).toEqual(new Date(2026, 9, 22, 1, 30));
  });

  it("skips a repeat that jumps over the day", () => {
    const weekly = capture({ recurrence_rule: "every:1:week", recurrence_next_at: "2026-10-20T09:00:00" });
    expect(firstDueOn(weekly, tomorrow)).toBeNull();
  });

  it("ignores a rule it can't read", () => {
    const broken = capture({ recurrence_rule: "sometimes", recurrence_next_at: "2026-10-21T09:00:00" });
    expect(firstDueOn(broken, tomorrow)).toBeNull();
  });
});

describe("dueOn", () => {
  it("keeps only what's due that day, earliest first", () => {
    const items = dueOn(
      [
        capture({ id: "late", reminder_time: "2026-10-22T17:00:00" }),
        capture({ id: "other-day", reminder_time: "2026-10-25T09:00:00" }),
        capture({ id: "early", recurrence_rule: "every:1:day", recurrence_next_at: "2026-10-21T08:00:00" }),
      ],
      tomorrow,
    );
    expect(items.map((item) => item.capture.id)).toEqual(["early", "late"]);
  });
});

describe("failedIds", () => {
  it("counts a capture once even when it shows on two days", () => {
    const ids = failedIds({
      yesterday: [row("a", "failed"), row("b", "landed")],
      today: [row("c", "failed")],
      tomorrow: [row("c", "failed"), row("d", "pending")],
    });
    expect([...ids].sort()).toEqual(["a", "c"]);
  });
});

describe("patchRow", () => {
  it("changes the capture on every day it shows, and nothing else", () => {
    const views = {
      yesterday: [row("a", "landed")],
      today: [row("b", "landed"), row("c", "landed")],
      tomorrow: [row("b", "landed")],
    };
    const next = patchRow(views, "b", { done: true });
    expect(next.today.map((item) => item.done)).toEqual([true, false]);
    expect(next.tomorrow[0].done).toBe(true);
    expect(next.yesterday[0]).toBe(views.yesterday[0]);
    expect(views.today[0].done).toBe(false);
  });
});
