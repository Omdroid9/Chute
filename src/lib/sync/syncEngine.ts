import { setSetting } from "../db";
import { createAppleNote } from "./appleNotes";
import { appleNoteBody } from "./noteFormat";
import { eventTitle } from "../titles";
import { createAppleReminder } from "./appleRemindersSync";
import { createAppleCalendarEvent } from "./appleCalendar";
import type { Capture } from "../../types";
import { calendarEventId, createGoogleCalendarEvent } from "./googleCalendar";
import { sendDiscordCapture } from "./discord";
import { createGoogleTask, refreshGoogleAccessToken } from "./googleTasks";
import { appendNotionCapture } from "./notion";
import { sendSlackCapture } from "./slack";
import { recurrenceLabelFromRule } from "../recurrence";

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

function shouldSyncSlack(capture: Capture, config: SyncConfig): boolean {
  return Boolean(config.slackWebhookUrl && capture.target_slack === 1 && capture.synced_slack === 0);
}

function shouldSyncDiscord(capture: Capture, config: SyncConfig): boolean {
  return Boolean(config.discordWebhookUrl && capture.target_discord === 1 && capture.synced_discord === 0);
}

function shouldSyncNotion(capture: Capture, config: SyncConfig): boolean {
  return Boolean(
    config.notionToken &&
      config.notionPageId &&
      capture.target_notion === 1 &&
      capture.synced_notion === 0,
  );
}

function shouldSyncGoogle(capture: Capture, config: SyncConfig): boolean {
  return Boolean(
    config.googleTasksAccessToken &&
      config.googleTasksListId &&
      capture.target_google_tasks === 1 &&
      capture.synced_google_tasks === 0,
  );
}

function shouldSyncGoogleCalendar(capture: Capture, config: SyncConfig): boolean {
  return Boolean(
    config.googleTasksAccessToken &&
      config.googleCalendarId &&
      capture.target_google_calendar === 1 &&
      capture.synced_google_calendar === 0 &&
      // Only create a calendar event when the capture has an actual time.
      // Otherwise every untimed note becomes a "now + 30 min" event.
      capture.reminder_time,
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

function shouldSyncAppleReminders(capture: Capture, config: SyncConfig): boolean {
  return Boolean(
    config.appleNotesEnabled &&
      capture.target_apple_reminders === 1 &&
      capture.synced_apple_reminders === 0,
  );
}

function shouldSyncReminders(capture: Capture, config: SyncConfig): boolean {
  return Boolean(
    config.appleRemindersEnabled &&
      capture.target_reminders === 1 &&
      capture.synced_reminders === 0,
  );
}

function shouldSyncAppleCalendar(capture: Capture, config: SyncConfig): boolean {
  return Boolean(
    config.appleCalendarEnabled &&
      capture.target_apple_calendar === 1 &&
      capture.synced_apple_calendar === 0 &&
      capture.reminder_time,
  );
}

export function requiresSync(capture: Capture, config: SyncConfig): boolean {
  return (
    shouldSyncSlack(capture, config) ||
    shouldSyncDiscord(capture, config) ||
    shouldSyncNotion(capture, config) ||
    shouldSyncGoogle(capture, config) ||
    shouldSyncGoogleCalendar(capture, config) ||
    shouldSyncAppleReminders(capture, config) ||
    shouldSyncReminders(capture, config) ||
    shouldSyncAppleCalendar(capture, config)
  );
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

async function syncGoogleCapture(capture: Capture, config: SyncConfig): Promise<void> {
  const createTask = async (accessToken: string) => {
    await createGoogleTask({
      accessToken,
      listId: config.googleTasksListId!,
      title: eventTitle(capture.content),
      notes: `Chute list: ${capture.list_name}`,
      due: capture.reminder_time ?? undefined,
    });
  };

  try {
    await createTask(config.googleTasksAccessToken!);
    return;
  } catch (error) {
    if (
      !isUnauthorizedError(error) ||
      !config.googleTasksRefreshToken ||
      !config.integrationBackendUrl
    ) {
      throw error;
    }
  }

  const refreshedAccessToken = await refreshGoogleAccessToken(
    config.integrationBackendUrl,
    config.googleTasksRefreshToken,
  );

  await setSetting("google_tasks_access_token", refreshedAccessToken);
  config.googleTasksAccessToken = refreshedAccessToken;

  await createTask(refreshedAccessToken);
}

async function syncGoogleCalendarCapture(capture: Capture, config: SyncConfig): Promise<void> {
  const createEvent = async (accessToken: string) => {
    await createGoogleCalendarEvent({
      accessToken,
      calendarId: config.googleCalendarId!,
      summary: eventTitle(capture.content),
      description: `Chute list: ${capture.list_name}\nTag: ${capture.tag}`,
      reminderTime: capture.reminder_time,
      eventId: calendarEventId(capture.id),
    });
  };

  try {
    await createEvent(config.googleTasksAccessToken!);
    return;
  } catch (error) {
    if (
      !isUnauthorizedError(error) ||
      !config.googleTasksRefreshToken ||
      !config.integrationBackendUrl
    ) {
      throw error;
    }
  }

  const refreshedAccessToken = await refreshGoogleAccessToken(
    config.integrationBackendUrl,
    config.googleTasksRefreshToken,
  );

  await setSetting("google_tasks_access_token", refreshedAccessToken);
  config.googleTasksAccessToken = refreshedAccessToken;

  await createEvent(refreshedAccessToken);
}

export async function syncCapture(capture: Capture, config: SyncConfig): Promise<SyncResult> {
  const errors: string[] = [];

  async function attempt(
    label: string,
    task: () => Promise<void>,
    noRetry?: (error: unknown) => boolean,
  ): Promise<boolean> {
    const outcome = await runWithRetry(task, noRetry);
    if (!outcome.ok && outcome.error) {
      errors.push(`${label}: ${outcome.error}`);
    }
    return outcome.ok;
  }

  const slackSynced = shouldSyncSlack(capture, config)
    ? await attempt("Slack", () =>
        sendSlackCapture(config.slackWebhookUrl!, capture.content, capture.tag, capture.list_name),
      )
    : false;

  const discordSynced = shouldSyncDiscord(capture, config)
    ? await attempt("Discord", () =>
        sendDiscordCapture(config.discordWebhookUrl!, capture.content, capture.tag, capture.list_name),
      )
    : false;

  const notionSynced = shouldSyncNotion(capture, config)
    ? await attempt("Notion", () =>
        appendNotionCapture({
          token: config.notionToken!,
          pageId: config.notionPageId!,
          content: capture.content,
          tag: capture.tag,
          listName: capture.list_name,
        }),
      )
    : false;

  const googleSynced = shouldSyncGoogle(capture, config)
    ? await attempt("Google Tasks", () => syncGoogleCapture(capture, config))
    : false;

  const googleCalendarSynced = shouldSyncGoogleCalendar(capture, config)
    ? await attempt("Google Calendar", () => syncGoogleCalendarCapture(capture, config))
    : false;

  const appleRemindersSynced = shouldSyncAppleReminders(capture, config)
    ? await attempt("Apple Notes", () =>
        createAppleNote({
          title: appleNoteTitle(capture.content),
          body: appleNoteBody(capture.content, capture.list_name, capture.tag),
          folder: config.appleNotesFolder,
        }),
      )
    : false;

  const remindersSynced = shouldSyncReminders(capture, config)
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
      )
    : false;

  const appleCalendarSynced = shouldSyncAppleCalendar(capture, config)
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
    errors,
  };
}
