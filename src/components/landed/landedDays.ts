import type { Capture } from "../../types";
import { addRecurrenceInterval } from "../../lib/recurrence";
import { parseReminderTime } from "../../lib/reminderTime";
import type { LandedRow } from "./landedRows";

export type LandedDay = "yesterday" | "today" | "tomorrow";

/**
 * The day pill, left to right. Yesterday lists what was captured that day;
 * Today, what's due today and then what was captured; Tomorrow, what's due
 * then, since nothing is captured tomorrow.
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

/** A capture due on the day, at its time that day. */
export interface DueRow {
  row: LandedRow;
  dueAt: Date;
  /** Its time had gone by when the panel last refreshed. */
  past: boolean;
}

export interface LandedView {
  /** Due that day, earliest first (Today and Tomorrow). */
  due: DueRow[];
  /** Captured that day, newest first, including any that are also due (Yesterday and Today). */
  captured: LandedRow[];
}

export type LandedViews = Record<LandedDay, LandedView>;

export const EMPTY_VIEWS: LandedViews = {
  yesterday: { due: [], captured: [] },
  today: { due: [], captured: [] },
  tomorrow: { due: [], captured: [] },
};

/** Midnight of the local day `offset` days from `now`. */
export function startOfLocalDay(offset: number, now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
}

/** Bound on walking a repeating reminder through time (every minute for ~69 days). */
const MAX_STEPS = 100_000;

/**
 * A repeating reminder's times on the day [start, end). Times already gone by
 * count too: walk back from its next time to the day's start (never before
 * its first, the reminder itself), then forward through the day.
 */
function repeatsOn(capture: Capture, start: number, end: number): Date[] {
  const rule = capture.recurrence_rule;
  if (!rule || !capture.recurrence_next_at) return [];
  let time: Date | null = parseReminderTime(capture.recurrence_next_at);
  const first = capture.reminder_time ? parseReminderTime(capture.reminder_time).getTime() : Number.NaN;
  const floor = Math.max(start, Number.isNaN(first) ? time.getTime() : first);

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const previous = addRecurrenceInterval(time, rule, -1);
    if (!previous || !(previous.getTime() >= floor)) break;
    time = previous;
  }

  const times: Date[] = [];
  for (let step = 0; time && time.getTime() < end && step < MAX_STEPS; step += 1) {
    if (time.getTime() >= start) times.push(time);
    time = addRecurrenceInterval(time, rule);
  }
  return times;
}

/**
 * When a capture is due on the local day starting at `dayStart`, as of `now`:
 * its next time that day still to come, else its last one that day. That's
 * its reminder time, or an occurrence of a repeating reminder.
 */
export function dueTimeOn(capture: Capture, dayStart: Date, now: Date): Date | null {
  const start = dayStart.getTime();
  const end = startOfLocalDay(1, dayStart).getTime();

  const times = repeatsOn(capture, start, end);
  // Its reminder time, and the day it was moved to from Landed if it has no date of its own.
  for (const value of [capture.reminder_time, capture.planned_at]) {
    const once = value ? parseReminderTime(value) : null;
    if (once && once.getTime() >= start && once.getTime() < end) times.push(once);
  }
  if (times.length === 0) return null;

  const upcoming = times.filter((time) => time >= now);
  if (upcoming.length > 0) return upcoming.reduce((earliest, time) => (time < earliest ? time : earliest));
  return times.reduce((latest, time) => (time > latest ? time : latest));
}

export interface DueCapture {
  capture: Capture;
  dueAt: Date;
  past: boolean;
}

/** The captures due on that day with their time, earliest first, as of `now`. */
export function dueOn(captures: Capture[], dayStart: Date, now: Date): DueCapture[] {
  return captures
    .map((capture) => ({ capture, dueAt: dueTimeOn(capture, dayStart, now) }))
    .filter((item): item is { capture: Capture; dueAt: Date } => item.dueAt !== null)
    .map((item) => ({ ...item, past: item.dueAt < now }))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

/**
 * What a view lists, each capture once: what's due first, then the rest of
 * what was captured. A capture made today that's due today is listed as due,
 * since its time is what matters today.
 */
export function groupsOf(view: LandedView): { due: DueRow[]; captured: LandedRow[] } {
  const dueIds = new Set(view.due.map((item) => item.row.id));
  return { due: view.due, captured: view.captured.filter((row) => !dueIds.has(row.id)) };
}

/** Every row a view shows. */
export function rowsOf(view: LandedView): LandedRow[] {
  const { due, captured } = groupsOf(view);
  return [...due.map((item) => item.row), ...captured];
}

/**
 * The count by the day pill: on Tomorrow, how many are still due (not marked
 * done); otherwise how many were captured that day, the same number the peek
 * calls landed (what's due today from earlier days didn't land today).
 */
export function headCount(day: LandedDay, view: LandedView): string {
  return day === "tomorrow"
    ? `${view.due.filter((item) => !item.row.done).length} due`
    : String(view.captured.length);
}

/** Due rows whose time has gone by and that aren't marked done. */
export function pastDue(view: LandedView): DueRow[] {
  return view.due.filter((item) => item.past && !item.row.done);
}

/** Days a row can be dragged onto: things only move forward. */
export const DROP_DAYS: ReadonlyArray<LandedDay> = ["today", "tomorrow"];

/** Whether a row can be dropped on a day: not one it's already due on. */
export function canDropOn(views: LandedViews, rowId: string, day: LandedDay): boolean {
  return DROP_DAYS.includes(day) && !views[day].due.some((item) => item.row.id === rowId);
}

/** Hour a moved item without a time of its own lands at. */
const MOVE_HOUR = 9;

/**
 * When a moved item lands on the day starting at `dayStart`: at its own time
 * of day, else 9 AM. Moved to today it never lands in the past: a time already
 * gone becomes the next whole hour (at most the day's last minute). An all-day
 * event keeps its midnight.
 */
export function moveTime(from: Date | null, dayStart: Date, now: Date, allDay = false): Date {
  const at = new Date(
    dayStart.getFullYear(),
    dayStart.getMonth(),
    dayStart.getDate(),
    from ? from.getHours() : MOVE_HOUR,
    from ? from.getMinutes() : 0,
  );
  if (allDay || at > now) return at;
  const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1);
  const lastMinute = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 23, 59);
  return nextHour < lastMinute ? nextHour : lastMinute;
}

/** Captures that failed anywhere the panel can show, counted once each. */
export function failedIds(views: LandedViews): Set<string> {
  const ids = new Set<string>();
  for (const view of Object.values(views)) {
    for (const row of rowsOf(view)) if (row.status === "failed") ids.add(row.id);
  }
  return ids;
}

/** The views with one capture changed wherever it shows (it can be due and captured, on more than one day). */
export function patchRow(views: LandedViews, id: string, patch: Partial<LandedRow>): LandedViews {
  const patchOne = (row: LandedRow) => (row.id === id ? { ...row, ...patch } : row);
  const patchView = (view: LandedView): LandedView => ({
    due: view.due.map((item) => (item.row.id === id ? { ...item, row: patchOne(item.row) } : item)),
    captured: view.captured.map(patchOne),
  });
  return { yesterday: patchView(views.yesterday), today: patchView(views.today), tomorrow: patchView(views.tomorrow) };
}
