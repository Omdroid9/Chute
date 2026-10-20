import { invoke } from "@tauri-apps/api/core";
import { classifyTimedEvent } from "../intent";

const DEFAULT_DURATION_MINUTES = 30;
const DEFAULT_ALARM_MINUTES = 10;

export interface CreateAppleCalendarEventInput {
  /** Empty string targets the first writable (default) calendar. */
  calendar?: string;
  title: string;
  notes: string;
  /** Local ISO start ("2026-06-15T09:00:00"). */
  start: string;
  /** Local ISO end. Defaults to start + 30 min when omitted. */
  end?: string | null;
  alarmMinutes?: number | null;
}

/** Add `minutes` to a local ISO string, returning a local ISO string. */
function addMinutesLocalIso(iso: string, minutes: number): string {
  const [date, time] = iso.split("T");
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi, s] = (time ?? "00:00:00").split(":").map(Number);
  const dt = new Date(y, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0);
  dt.setMinutes(dt.getMinutes() + minutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

/**
 * Duration in minutes for a capture. Honors an explicit range ("2-3pm",
 * "from 2 to 4") when the text carries one; otherwise a 30-minute block.
 */
export function eventDurationMinutes(text: string): number {
  // 2-3pm / 2:30 - 4pm / 9am-10am
  const dash = text.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  );
  const range = dash ?? text.match(/\bfrom\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s.*?\bto\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!range) {
    return DEFAULT_DURATION_MINUTES;
  }
  const to24 = (h: number, mer?: string) => {
    let hh = h % 12;
    if (mer && mer.toLowerCase() === "pm") hh += 12;
    return hh;
  };
  const startH = to24(Number(range[1]), range[3] ?? range[6]);
  const startMin = startH * 60 + Number(range[2] ?? 0);
  const endH = to24(Number(range[4]), range[6]);
  const endMin = endH * 60 + Number(range[5] ?? 0);
  const delta = endMin - startMin;
  return delta > 0 && delta <= 12 * 60 ? delta : DEFAULT_DURATION_MINUTES;
}

/**
 * Create an event in macOS Calendar.app via the native Rust layer. When `end`
 * is omitted it derives the end from a duration inferred from the title text
 * (explicit range, else 30 min). On non-macOS the command returns an error.
 * Resolves to the new event's uid.
 */
export async function createAppleCalendarEvent(
  input: CreateAppleCalendarEventInput,
): Promise<string> {
  const end =
    input.end ?? addMinutesLocalIso(input.start, eventDurationMinutes(input.title));
  return invoke<string>("create_apple_calendar_event", {
    calendar: input.calendar?.trim() || "",
    title: input.title,
    notes: input.notes,
    start: input.start,
    end,
    alarmMinutes: input.alarmMinutes ?? DEFAULT_ALARM_MINUTES,
  });
}

/** Re-export so routing can share the same event/task heuristic. */
export { classifyTimedEvent };

/** Add a line to the notes of a Calendar event Chute created earlier (by uid). */
export async function appendToAppleCalendarEvent(uid: string, text: string): Promise<void> {
  await invoke("append_to_calendar_event", { uid, text });
}
