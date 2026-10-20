/**
 * `reminder_time` is stored as a local ISO string with no zone
 * ("2026-10-20T16:00:00"), unlike `created_at` (UTC, see timestamps.ts).
 * Build the Date from its parts so it always reads as local time; anything
 * carrying a zone is passed through as-is.
 */
export function parseReminderTime(value: string): Date {
  const trimmed = value.trim();
  const bare = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/);
  if (!bare) return new Date(trimmed);
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = bare;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * A stored reminder time for people: "Today 4:00 PM", "Tomorrow 9:00 AM",
 * "Yesterday 6:00 PM", otherwise "Tue, Oct 20 4:00 PM" (plus the year when it
 * isn't this year). Unparseable values are returned unchanged.
 */
export function formatReminderTime(value: string, now = new Date(), locale?: string): string {
  const date = parseReminderTime(value);
  if (Number.isNaN(date.getTime())) return value;

  const time = date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const dayOffset = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
  if (dayOffset === 0) return `Today ${time}`;
  if (dayOffset === 1) return `Tomorrow ${time}`;
  if (dayOffset === -1) return `Yesterday ${time}`;

  const day = date.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
  return `${day} ${time}`;
}
