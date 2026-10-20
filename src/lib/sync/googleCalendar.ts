import { httpPostJson, httpRequest } from "../net/http";

export interface GoogleCalendar {
  id: string;
  summary: string;
  primary?: boolean;
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

const ALL_DAY_HINT_REGEX = /\b(all day|throughout the day|during the day|whole day|anytime)\b/i;
const DURATION_HOURS_REGEX = /\bfor\s+(\d{1,2})\s*(h|hr|hrs|hour|hours)\b/i;
const DURATION_MINUTES_REGEX = /\bfor\s+(\d{1,3})\s*(m|min|mins|minute|minutes)\b/i;

function formatLocalDate(input: Date): string {
  const year = input.getFullYear();
  const month = String(input.getMonth() + 1).padStart(2, "0");
  const day = String(input.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveDurationMinutes(text: string): number {
  const hours = text.match(DURATION_HOURS_REGEX);
  if (hours) {
    return Math.min(Math.max(Number(hours[1]) * 60, 15), 8 * 60);
  }

  const minutes = text.match(DURATION_MINUTES_REGEX);
  if (minutes) {
    return Math.min(Math.max(Number(minutes[1]), 15), 8 * 60);
  }

  return 30;
}

function computeEventWindow(input: {
  reminderTime?: string;
  hintText?: string;
}): { allDay: boolean; start: string; end: string } {
  const hintText = input.hintText ?? "";
  const reminderTime = input.reminderTime;
  const startDate = reminderTime ? new Date(reminderTime) : new Date();

  if (!reminderTime) {
    const minutes = startDate.getMinutes();
    const rounded = Math.ceil((minutes + 1) / 15) * 15;
    startDate.setMinutes(rounded, 0, 0);
  }

  const isAllDay = ALL_DAY_HINT_REGEX.test(hintText);
  if (isAllDay) {
    const dayStart = new Date(startDate);
    dayStart.setHours(0, 0, 0, 0);

    const nextDay = new Date(dayStart);
    nextDay.setDate(nextDay.getDate() + 1);

    return {
      allDay: true,
      start: formatLocalDate(dayStart),
      end: formatLocalDate(nextDay),
    };
  }

  const durationMinutes = resolveDurationMinutes(hintText);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60_000);
  return {
    allDay: false,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };
}

export async function listGoogleCalendars(accessToken: string): Promise<GoogleCalendar[]> {
  const response = await httpRequest("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    method: "GET",
    headers: authHeaders(accessToken),
  });
  const payload = (await response.json()) as { items?: GoogleCalendar[] };
  return payload.items ?? [];
}

/**
 * Derives a deterministic Google Calendar event id from a capture id.
 *
 * Google requires event ids to be base32hex (characters a-v and 0-9), 5-1024
 * chars. A capture UUID with dashes stripped is 32 hex chars (0-9a-f) which is a
 * valid subset, and the "fc" prefix keeps us clear of reserved/empty ids.
 *
 * Using a deterministic id makes calendar inserts idempotent: a retried request
 * whose response was lost collides with the already-created event (HTTP 409)
 * instead of creating a duplicate.
 */
export function calendarEventId(captureId: string): string {
  return `fc${captureId.replace(/-/g, "")}`.toLowerCase();
}

export async function createGoogleCalendarEvent(input: {
  accessToken: string;
  calendarId: string;
  summary: string;
  description?: string;
  reminderTime?: string | null;
  eventId?: string;
}): Promise<void> {
  const window = computeEventWindow({
    reminderTime: input.reminderTime ?? undefined,
    hintText: `${input.summary} ${input.description ?? ""}`,
  });

  const payload: Record<string, unknown> = {
    summary: input.summary,
    description: input.description ?? "",
  };

  if (input.eventId) {
    payload.id = input.eventId;
  }

  if (window.allDay) {
    payload.start = { date: window.start };
    payload.end = { date: window.end };
  } else {
    payload.start = { dateTime: window.start };
    payload.end = { dateTime: window.end };
  }

  try {
    await httpPostJson(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
      payload,
      authHeaders(input.accessToken),
    );
  } catch (error) {
    // With a deterministic id, a 409 means the event already exists (a previous
    // attempt succeeded server-side). That is the idempotent success case.
    if (input.eventId && error instanceof Error && /HTTP 409\b/.test(error.message)) {
      return;
    }
    throw error;
  }
}

/** Add a line to the description of an event Chute created earlier. */
export async function appendToGoogleEventDescription(input: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  addition: string;
}): Promise<void> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`;
  const current = await httpRequest(url, { method: "GET", headers: authHeaders(input.accessToken) });
  const event = (await current.json()) as { description?: string };
  const description = event.description?.trim() ? `${event.description}\n${input.addition}` : input.addition;
  await httpRequest(url, {
    method: "PATCH",
    headers: { ...authHeaders(input.accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
}

export async function testGoogleCalendarConnection(
  accessToken: string,
  calendarId: string,
): Promise<void> {
  await httpRequest(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
    {
      method: "GET",
      headers: authHeaders(accessToken),
    },
  );
}
