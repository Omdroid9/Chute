import type { Capture } from "../../types";
import { addRecurrenceInterval } from "../../lib/recurrence";
import { parseReminderTime } from "../../lib/reminderTime";
import type { LandedRow } from "./landedRows";

export type LandedDay = "yesterday" | "today" | "tomorrow";

/**
 * The day pill, left to right. Yesterday and Today list what was captured on
 * that day; Tomorrow lists what's due then, since nothing is captured tomorrow.
 */
export const LANDED_DAYS: ReadonlyArray<{ day: LandedDay; label: string; offset: number }> = [
  { day: "yesterday", label: "Yesterday", offset: -1 },
  { day: "today", label: "Today", offset: 0 },
  { day: "tomorrow", label: "Tomorrow", offset: 1 },
];

export const EMPTY_TEXT: Record<LandedDay, string> = {
  yesterday: "Nothing captured yesterday.",
  today: "Nothing yet today. Captures show up here as they land.",
  tomorrow: "Nothing due tomorrow. Reminders with a time tomorrow show up here.",
};

export type LandedViews = Record<LandedDay, LandedRow[]>;

export const EMPTY_VIEWS: LandedViews = { yesterday: [], today: [], tomorrow: [] };

/** Midnight of the local day `offset` days from `now`. */
export function startOfLocalDay(offset: number, now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
}

/** Bound on walking a repeating reminder forward to the day (every minute for ~69 days). */
const MAX_STEPS = 100_000;

/**
 * When a capture is first due on the local day starting at `dayStart`: its
 * reminder time, or the first occurrence of a repeating reminder that day.
 */
export function firstDueOn(capture: Capture, dayStart: Date): Date | null {
  const start = dayStart.getTime();
  const end = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1).getTime();
  const onDay = (date: Date | null): date is Date => {
    const time = date?.getTime() ?? Number.NaN;
    return time >= start && time < end;
  };

  const due: Date[] = [];
  const once = capture.reminder_time ? parseReminderTime(capture.reminder_time) : null;
  if (onDay(once)) due.push(once);

  if (capture.recurrence_rule && capture.recurrence_next_at) {
    let next: Date | null = parseReminderTime(capture.recurrence_next_at);
    for (let step = 0; next && next.getTime() < start && step < MAX_STEPS; step += 1) {
      next = addRecurrenceInterval(next, capture.recurrence_rule);
    }
    if (onDay(next)) due.push(next);
  }

  if (due.length === 0) return null;
  return due.reduce((earliest, date) => (date < earliest ? date : earliest));
}

/** The captures due on that day with their time, earliest first. */
export function dueOn(captures: Capture[], dayStart: Date): Array<{ capture: Capture; dueAt: Date }> {
  return captures
    .map((capture) => ({ capture, dueAt: firstDueOn(capture, dayStart) }))
    .filter((item): item is { capture: Capture; dueAt: Date } => item.dueAt !== null)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

/** Captures that failed anywhere the panel can show, counted once each. */
export function failedIds(views: LandedViews): Set<string> {
  const ids = new Set<string>();
  for (const rows of Object.values(views)) {
    for (const row of rows) if (row.status === "failed") ids.add(row.id);
  }
  return ids;
}
