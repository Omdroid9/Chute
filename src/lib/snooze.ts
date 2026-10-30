import { toLocalIso } from "./recurrence";

/** When a reminder can be snoozed to, from Landed. */
export type SnoozeChoice = "hour" | "evening" | "tomorrow";

export const SNOOZE_LABELS: Record<SnoozeChoice, string> = {
  hour: "1 hour",
  evening: "This evening",
  tomorrow: "Tomorrow 9 AM",
};

const EVENING_HOUR = 18;
const MORNING_HOUR = 9;
/** "This evening" is offered until 6 PM is this close; then "1 hour" covers it. */
const EVENING_LEAD_MS = 30 * 60_000;

/**
 * When a snooze ends, as a local ISO string with no zone (how reminder_time
 * is stored). "1 hour" is an hour from now to the minute; the others are
 * built from local date parts, so they stay 6 PM and 9 AM across DST changes.
 */
export function snoozeUntil(choice: SnoozeChoice, now = new Date()): string {
  let until: Date;
  if (choice === "hour") {
    until = new Date(now.getTime() + 3_600_000);
    until.setSeconds(0, 0);
  } else if (choice === "evening") {
    until = new Date(now.getFullYear(), now.getMonth(), now.getDate(), EVENING_HOUR);
  } else {
    until = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, MORNING_HOUR);
  }
  return toLocalIso(until);
}

/** The choices that make sense now: "This evening" only while 6 PM is still a while off. */
export function snoozeChoices(now = new Date()): SnoozeChoice[] {
  const evening = new Date(now.getFullYear(), now.getMonth(), now.getDate(), EVENING_HOUR);
  const eveningAhead = evening.getTime() - now.getTime() >= EVENING_LEAD_MS;
  return eveningAhead ? ["hour", "evening", "tomorrow"] : ["hour", "tomorrow"];
}
