import { setSetting } from "../db";
import { createAppleNote } from "./appleNotes";
import { appleNoteBody } from "./noteFormat";
import { eventTitle } from "../titles";
import { createAppleReminder } from "./appleRemindersSync";
import { createAppleCalendarEvent } from "./appleCalendar";
import type { Capture, CaptureLink, LinkDestination } from "../../types";
import { calendarEventId, createGoogleCalendarEvent } from "./googleCalendar";
import { sendDiscordCapture } from "./discord";
import { createGoogleTask, refreshGoogleAccessToken } from "./googleTasks";
import { appendNotionCapture } from "./notion";
import { sendSlackCapture } from "./slack";
import { recurrenceLabelFromRule } from "../recurrence";
import { isSynced, isTargeted, SYNC_DESTINATIONS, type SyncDestination } from "./destinations";

export interface SyncConfig {
  slackWebhookUrl?: string;
  discordWebhookUrl?: string;
  notionToken?: string;
  notionPageId?: string;
  googleTasksAccessToken?: string;
  googleTasksRefreshToken?: string;
  googleTasksListId?: string;
  googleCalendarId?: string;
  integrationBackendUrl?: string;
  // Apple Notes writes happen natively (AppleScript) on macOS only. No bridge.
  appleNotesEnabled?: boolean;
  appleNotesFolder?: string;
  // Apple Reminders — same native path, separate destination.
  appleRemindersEnabled?: boolean;
  appleRemindersList?: string;
  // Apple Calendar — native events on macOS. Empty name = default calendar.
  appleCalendarEnabled?: boolean;
  appleCalendarName?: string;
}

export interface SyncResult {
  slackSynced: boolean;
  discordSynced: boolean;
  notionSynced: boolean;
  googleSynced: boolean;
  googleCalendarSynced: boolean;
  appleRemindersSynced: boolean;
  remindersSynced: boolean;
  appleCalendarSynced: boolean;
  /** Destinations this pass tried (succeeded or not). */
  attempted: SyncDestination[];
  /** Links for every destination that succeeded this pass and returned an id. */
  links: CaptureLink[];
  errors: string[];
}

interface RetryOutcome {
  ok: boolean;
  error: string | null;
}

function backoffMs(attempt: number): number {
  return Math.min(1_000 * 2 ** attempt, 10_000);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runWithRetry(
  task: () => Promise<void>,
  noRetry?: (error: unknown) => boolean,
): Promise<RetryOutcome> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await task();
      return { ok: true, error: null };
    } catch (error) {
      lastError = error;
      if (attempt === 2 || noRetry?.(error)) {
        console.error("Sync task failed", error);
        return { ok: false, error: toErrorMessage(error) };
      }
      await new Promise((resolve) => {
        setTimeout(resolve, backoffMs(attempt));
      });
    }
  }
  return { ok: false, error: lastError ? toErrorMessage(lastError) : "Unknown sync error" };
}

/**
 * Whether Chute can send to this destination at all: the app is connected,
 * and calendars only take captures that have a time (otherwise every untimed
 * note would become a "now + 30 min" event).
 */
export function destinationReady(
  capture: Capture,
  destination: SyncDestination,
  config: SyncConfig,
): boolean {
  switch (destination) {
    case "slack":
      return Boolean(config.slackWebhookUrl);
    case "discord":
      return Boolean(config.discordWebhookUrl);
    case "notion":
      return Boolean(config.notionToken && config.notionPageId);
    case "google_tasks":
      return Boolean(config.googleTasksAccessToken && config.googleTasksListId);
    case "google_calendar":
      return Boolean(config.googleTasksAccessToken && config.googleCalendarId && capture.reminder_time);
    case "apple_notes":
      return Boolean(config.appleNotesEnabled);
    case "reminders":
      return Boolean(config.appleRemindersEnabled);
    case "apple_calendar":
      return Boolean(config.appleCalendarEnabled && capture.reminder_time);
  }
}

function shouldSync(capture: Capture, destination: SyncDestination, config: SyncConfig): boolean {
  return (
    isTargeted(capture, destination) &&
    !isSynced(capture, destination) &&
    destinationReady(capture, destination, config)
  );
}

function appleNoteTitle(content: string): string {
  const firstLine = content.split("\n")[0]?.trim() ?? "";
  const normalized = firstLine.length > 0 ? firstLine : content.trim();
  if (normalized.length === 0) {
    return "Chute";
  }
  return normalized.slice(0, 80);
}

function appleReminderBody(capture: Capture): string {
  const parts = [`${capture.list_name} • ${capture.tag}`];
  const recurrenceLabel = recurrenceLabelFromRule(capture.recurrence_rule);
  if (recurrenceLabel) {
    parts.push(`Repeat request: ${recurrenceLabel}`);
  }
  return parts.join("\n");
}

export function requiresSync(capture: Capture, config: SyncConfig): boolean {
  return SYNC_DESTINATIONS.some((destination) => shouldSync(capture, destination, config));
}

/** The destinations a sync pass would try for this capture right now. */
export function pendingDestinations(capture: Capture, config: SyncConfig): SyncDestination[] {
  return SYNC_DESTINATIONS.filter((destination) => shouldSync(capture, destination, config));
}

function isUnauthorizedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("HTTP 401");
}

function isPermissionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("not allowed to send apple events") ||
    msg.includes("-1743") ||
    msg.includes("erraeventnotpermitted") ||
    msg.includes("automation")
  );
}

/**
 * Run a Google call with the saved access token; on a 401, refresh it once
 * through the integration backend (saving the new token) and try again.
 */
export async function withGoogleAccess<T>(config: SyncConfig, task: (accessToken: string) => Promise<T>): Promise<T> {
  try {
    return await task(config.googleTasksAccessToken!);
  } catch (error) {
    if (!isUnauthorizedError(error) || !config.googleTasksRefreshToken || !config.integrationBackendUrl) {
      throw error;
    }
  }

  const refreshedAccessToken = await refreshGoogleAccessToken(
    config.integrationBackendUrl,
    config.googleTasksRefreshToken,
  );

  await setSetting("google_tasks_access_token", refreshedAccessToken);
  config.googleTasksAccessToken = refreshedAccessToken;

  return task(refreshedAccessToken);
}

function syncGoogleCapture(capture: Capture, config: SyncConfig): Promise<string> {
  return withGoogleAccess(config, (accessToken) =>
    createGoogleTask({
      accessToken,
      listId: config.googleTasksListId!,
      title: eventTitle(capture.content),
      notes: `Chute list: ${capture.list_name}`,
      due: capture.reminder_time ?? undefined,
    }),
  );
}

/** Resolves to the event id, which is derived from the capture id (so it's stable). */
async function syncGoogleCalendarCapture(capture: Capture, config: SyncConfig): Promise<string> {
  await withGoogleAccess(config, (accessToken) =>
    createGoogleCalendarEvent({
      accessToken,
      calendarId: config.googleCalendarId!,
      summary: eventTitle(capture.content),
      description: `Chute list: ${capture.list_name}\nTag: ${capture.tag}`,
      reminderTime: capture.reminder_time,
      eventId: calendarEventId(capture.id),
    }),
  );
  return calendarEventId(capture.id);
}

export async function syncCapture(capture: Capture, config: SyncConfig): Promise<SyncResult> {
  const errors: string[] = [];
  const links: CaptureLink[] = [];
  const attempted = pendingDestinations(capture, config);

  async function attempt<T>(
    label: string,
    task: () => Promise<T>,
    noRetry?: (error: unknown) => boolean,
    toLink?: (value: T) => Omit<CaptureLink, "destination"> & { destination: LinkDestination },
  ): Promise<boolean> {
    let value: T | undefined;
    const outcome = await runWithRetry(async () => {
      value = await task();
    }, noRetry);
    if (!outcome.ok && outcome.error) {
      errors.push(`${label}: ${outcome.error}`);
    }
    if (outcome.ok && toLink && value !== undefined) {
      const link = toLink(value);
      if (link.externalId) links.push(link);
    }
    return outcome.ok;
  }

  const slackSynced = shouldSync(capture, "slack", config)
    ? await attempt("Slack", () =>
        sendSlackCapture(config.slackWebhookUrl!, capture.content, capture.tag, capture.list_name),
      )
    : false;

  const discordSynced = shouldSync(capture, "discord", config)
    ? await attempt("Discord", () =>
        sendDiscordCapture(config.discordWebhookUrl!, capture.content, capture.tag, capture.list_name),
        undefined,
        (id) => ({ destination: "discord", externalId: id }),
      )
    : false;

  const notionSynced = shouldSync(capture, "notion", config)
    ? await attempt("Notion", () =>
        appendNotionCapture({
          token: config.notionToken!,
          pageId: config.notionPageId!,
          content: capture.content,
          tag: capture.tag,
          listName: capture.list_name,
        }),
        undefined,
        (ref) => ({ destination: "notion", externalId: ref.id, kind: ref.kind }),
      )
    : false;

  const googleSynced = shouldSync(capture, "google_tasks", config)
    ? await attempt("Google Tasks", () => syncGoogleCapture(capture, config), undefined, (id) => ({
        destination: "google_tasks",
        externalId: id,
      }))
    : false;

  const googleCalendarSynced = shouldSync(capture, "google_calendar", config)
    ? await attempt("Google Calendar", () => syncGoogleCalendarCapture(capture, config), undefined, (id) => ({
        destination: "google_calendar",
        externalId: id,
      }))
    : false;

  const appleRemindersSynced = shouldSync(capture, "apple_notes", config)
    ? await attempt("Apple Notes", () =>
        createAppleNote({
          title: appleNoteTitle(capture.content),
          body: appleNoteBody(capture.content, capture.list_name, capture.tag),
          folder: config.appleNotesFolder,
        }),
        undefined,
        (id) => ({ destination: "apple_notes", externalId: id }),
      )
    : false;

  const remindersSynced = shouldSync(capture, "reminders", config)
    ? await attempt(
        "Reminders",
        () =>
          createAppleReminder({
            list: config.appleRemindersList,
            title: eventTitle(capture.content),
            body: appleReminderBody(capture),
            dueDate: capture.reminder_time ?? null,
          }),
        isPermissionError,
        (id) => ({ destination: "reminders", externalId: id }),
      )
    : false;

  const appleCalendarSynced = shouldSync(capture, "apple_calendar", config)
    ? await attempt(
        "Apple Calendar",
        () =>
          createAppleCalendarEvent({
            calendar: config.appleCalendarName,
            title: eventTitle(capture.content),
            notes: appleReminderBody(capture),
            start: capture.reminder_time!,
          }),
        isPermissionError,
        (id) => ({ destination: "apple_calendar", externalId: id }),
      )
    : false;

  return {
    slackSynced,
    discordSynced,
    notionSynced,
    googleSynced,
    googleCalendarSynced,
    appleRemindersSynced,
    remindersSynced,
    appleCalendarSynced,
    attempted,
    links,
    errors,
  };
}
