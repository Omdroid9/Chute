import { describe, expect, it } from "vitest";
import type { Capture } from "../../types";
import type { LandedRow } from "./landedRows";
import {
  dueOn,
  dueTimeOn,
  failedIds,
  groupsOf,
  headCount,
  rowsOf,
  startOfLocalDay,
  type DueRow,
  type LandedView,
} from "./landedDays";

// Local parts throughout, so the tests hold in any time zone.
const now = new Date(2026, 9, 21, 14, 0);
const today = startOfLocalDay(0, now);
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

function row(id: string, status: LandedRow["status"] = "landed"): LandedRow {
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
    createdAt: "2026-10-21 12:00:00",
  };
}

function due(id: string, status: LandedRow["status"] = "landed"): DueRow {
  return { row: row(id, status), dueAt: new Date(2026, 9, 21, 9, 0), past: true };
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

describe("dueTimeOn", () => {
  it("uses a reminder time on that day", () => {
    expect(dueTimeOn(capture({ reminder_time: "2026-10-22T09:00:00" }), tomorrow, now)).toEqual(
      new Date(2026, 9, 22, 9, 0),
    );
  });

  it("keeps a reminder time today that has gone by", () => {
    expect(dueTimeOn(capture({ reminder_time: "2026-10-21T09:00:00" }), today, now)).toEqual(
      new Date(2026, 9, 21, 9, 0),
    );
  });

  it("ignores reminders on other days, including just after midnight the day after", () => {
    expect(dueTimeOn(capture({ reminder_time: "2026-10-21T23:59:00" }), tomorrow, now)).toBeNull();
    expect(dueTimeOn(capture({ reminder_time: "2026-10-23T00:00:00" }), tomorrow, now)).toBeNull();
  });

  it("walks a repeating reminder forward to its first time that day", () => {
    const daily = capture({
      reminder_time: "2026-10-01T09:00:00",
      recurrence_rule: "every:1:day",
      recurrence_next_at: "2026-10-21T09:00:00",
    });
    expect(dueTimeOn(daily, tomorrow, now)).toEqual(new Date(2026, 9, 22, 9, 0));
  });

  it("keeps today's time of a repeating reminder that already went off and moved on", () => {
    const daily = capture({
      reminder_time: "2026-10-01T09:00:00",
      recurrence_rule: "every:1:day",
      recurrence_next_at: "2026-10-22T09:00:00",
    });
    expect(dueTimeOn(daily, today, now)).toEqual(new Date(2026, 9, 21, 9, 0));
  });

  it("never walks a repeating reminder back before its first time", () => {
    const startsTomorrow = capture({
      reminder_time: "2026-10-22T09:00:00",
      recurrence_rule: "every:1:day",
      recurrence_next_at: "2026-10-23T09:00:00",
    });
    expect(dueTimeOn(startsTomorrow, today, now)).toBeNull();
    // With no first time known, it doesn't walk back at all.
    const noFirst = capture({ recurrence_rule: "every:1:day", recurrence_next_at: "2026-10-22T09:00:00" });
    expect(dueTimeOn(noFirst, today, now)).toBeNull();
  });

  it("takes the earliest occurrence of an hourly reminder on a day still to come", () => {
    const hourly = capture({ recurrence_rule: "every:2:hour", recurrence_next_at: "2026-10-21T15:30:00" });
    expect(dueTimeOn(hourly, tomorrow, now)).toEqual(new Date(2026, 9, 22, 1, 30));
  });

  it("takes an hourly reminder's next time today, else its last one", () => {
    const hourly = capture({
      reminder_time: "2026-10-20T07:30:00",
      recurrence_rule: "every:2:hour",
      recurrence_next_at: "2026-10-21T15:30:00",
    });
    expect(dueTimeOn(hourly, today, now)).toEqual(new Date(2026, 9, 21, 15, 30));

    const late = new Date(2026, 9, 21, 23, 50);
    const movedOn = { ...hourly, recurrence_next_at: "2026-10-22T01:30:00" };
    expect(dueTimeOn(movedOn, today, late)).toEqual(new Date(2026, 9, 21, 23, 30));
  });

  it("skips a repeat that jumps over the day", () => {
    const weekly = capture({ recurrence_rule: "every:1:week", recurrence_next_at: "2026-10-20T09:00:00" });
    expect(dueTimeOn(weekly, tomorrow, now)).toBeNull();
    const nextWeek = capture({
      reminder_time: "2026-10-06T09:00:00",
      recurrence_rule: "every:1:week",
      recurrence_next_at: "2026-10-27T09:00:00",
    });
    expect(dueTimeOn(nextWeek, today, now)).toBeNull();
  });

  it("ignores a rule it can't read", () => {
    const broken = capture({ recurrence_rule: "sometimes", recurrence_next_at: "2026-10-21T09:00:00" });
    expect(dueTimeOn(broken, tomorrow, now)).toBeNull();
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
      now,
    );
    expect(items.map((item) => item.capture.id)).toEqual(["early", "late"]);
    expect(items.every((item) => !item.past)).toBe(true);
  });

  it("marks what's due today and has gone by as past", () => {
    const items = dueOn(
      [
        capture({ id: "evening", reminder_time: "2026-10-21T18:00:00" }),
        capture({ id: "morning", reminder_time: "2026-10-21T09:00:00" }),
        capture({ id: "on-the-minute", reminder_time: "2026-10-21T14:00:00" }),
      ],
      today,
      now,
    );
    expect(items.map((item) => [item.capture.id, item.past])).toEqual([
      ["morning", true],
      ["on-the-minute", false],
      ["evening", false],
    ]);
  });
});

describe("groupsOf", () => {
  it("lists a capture that's due once, as due, and the rest of what was captured after", () => {
    const view: LandedView = {
      due: [due("from-earlier"), due("made-today")],
      captured: [row("newest"), row("made-today"), row("oldest")],
    };
    const groups = groupsOf(view);
    expect(groups.due.map((item) => item.row.id)).toEqual(["from-earlier", "made-today"]);
    expect(groups.captured.map((item) => item.id)).toEqual(["newest", "oldest"]);
    expect(rowsOf(view).map((item) => item.id)).toEqual(["from-earlier", "made-today", "newest", "oldest"]);
  });
});

describe("headCount", () => {
  it("counts what was captured that day, wherever it's listed, and what's due tomorrow", () => {
    const todayView: LandedView = { due: [due("from-earlier"), due("made-today")], captured: [row("made-today")] };
    expect(headCount("today", todayView)).toBe("1");
    expect(headCount("tomorrow", { due: [due("a"), due("b")], captured: [] })).toBe("2 due");
  });
});

describe("failedIds", () => {
  it("counts a capture once even when it shows on two days, due or captured", () => {
    const ids = failedIds({
      yesterday: { due: [], captured: [row("a", "failed"), row("b")] },
      today: { due: [due("e", "failed")], captured: [row("c", "failed")] },
      tomorrow: { due: [due("c", "failed"), due("d", "pending")], captured: [] },
    });
    expect([...ids].sort()).toEqual(["a", "c", "e"]);
  });
});
