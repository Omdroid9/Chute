import {
  getCaptureById,
  getSetting,
  getSettings,
  listDueRecurringReminderCaptures,
  listCaptures,
  saveCaptureLinks,
  setCaptureRecurrenceNextAt,
  setCaptureSyncError,
  setSetting,
  updateCaptureSyncStatus,
} from "../db";
import type { Capture } from "../../types";
import { isMacOS } from "../platform";
import { nextRecurrenceAfter, recurrenceLabelFromRule, toLocalIso } from "../recurrence";
import { createAppleReminder } from "./appleRemindersSync";
import type { SyncDestination } from "./destinations";
import {
  pendingDestinations,
  requiresSync,
  syncCapture,
  type SyncConfig,
  type SyncResult,
} from "./syncEngine";

const SYNC_SETTING_KEYS = [
  "integration_backend_url",
  "slack_webhook_url",
  "discord_webhook_url",
  "notion_token",
  "notion_page_id",
  "google_tasks_access_token",
  "google_tasks_refresh_token",
  "google_tasks_list_id",
  "google_calendar_id",
  "apple_notes_folder",
  "apple_reminders_list",
] as const;

export interface SyncRunStats {
  capturesConsidered: number;
  capturesSynced: number;
  syncAttempts: number;
  syncSucceeded: number;
  syncFailed: number;
}

export interface RecurringReminderStats {
  considered: number;
  created: number;
  failed: number;
}

function normalizeSetting(value: string | null): string | undefined {
  const next = value?.trim() ?? "";
  return next.length > 0 ? next : undefined;
}

export async function loadSyncConfig(): Promise<SyncConfig> {
  const settings = await getSettings([...SYNC_SETTING_KEYS]);
  return {
    integrationBackendUrl: normalizeSetting(settings.integration_backend_url),
    slackWebhookUrl: normalizeSetting(settings.slack_webhook_url),
    discordWebhookUrl: normalizeSetting(settings.discord_webhook_url),
    notionToken: normalizeSetting(settings.notion_token),
    notionPageId: normalizeSetting(settings.notion_page_id),
    googleTasksAccessToken: normalizeSetting(settings.google_tasks_access_token),
    googleTasksRefreshToken: normalizeSetting(settings.google_tasks_refresh_token),
    googleTasksListId: normalizeSetting(settings.google_tasks_list_id),
    googleCalendarId: normalizeSetting(settings.google_calendar_id),
    appleNotesEnabled: isMacOS(),
    appleNotesFolder: normalizeSetting(settings.apple_notes_folder) ?? "Chute",
    appleRemindersEnabled: isMacOS(),
    appleRemindersList: normalizeSetting(settings.apple_reminders_list) ?? "Chute",
    appleCalendarEnabled: isMacOS(),
    appleCalendarName: normalizeSetting(settings.apple_calendar_name) ?? "",
  };
}

/** Destinations a sync result landed in, in display order. */
function landedDestinations(result: SyncResult): SyncDestination[] {
  const landed: Record<SyncDestination, boolean> = {
    slack: result.slackSynced,
    discord: result.discordSynced,
    notion: result.notionSynced,
    google_tasks: result.googleSynced,
    google_calendar: result.googleCalendarSynced,
    apple_notes: result.appleRemindersSynced,
    reminders: result.remindersSynced,
    apple_calendar: result.appleCalendarSynced,
  };
  return result.attempted.filter((destination) => landed[destination]);
}

/** What one capture's sync did, for the Landed confirmation. */
export interface CaptureSyncOutcome {
  captureId: string;
  landed: SyncDestination[];
  failed: SyncDestination[];
}

function toDisplayTime(input: Date): string {
  return input.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function reminderTitle(content: string): string {
  const firstLine = content.split("\n")[0]?.trim() ?? "";
  const normalized = firstLine.length > 0 ? firstLine : content.trim();
  return normalized.length > 0 ? normalized.slice(0, 80) : "Chute";
}

function recurringReminderBody(capture: Capture): string {
  const parts = [`${capture.list_name} • ${capture.tag}`];
  const recurrenceLabel = recurrenceLabelFromRule(capture.recurrence_rule);
  if (recurrenceLabel) {
    parts.push(`Managed by Chute: ${recurrenceLabel}`);
  }
  return parts.join("\n");
}

export async function getLastSyncLabel(): Promise<string> {
  const raw = await getSetting("last_sync_at");
  if (!raw) {
    return "Never";
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "Never";
  }

  return toDisplayTime(parsed);
}

export async function runSyncPass(options?: {
  captureId?: string;
  limit?: number;
  /** Called after each capture this pass tried to send. */
  onCaptureSynced?: (outcome: CaptureSyncOutcome) => void;
}): Promise<{
  stats: SyncRunStats;
  lastSyncLabel: string;
}> {
  const config = await loadSyncConfig();
  const candidates = options?.captureId
    ? [await getCaptureById(options.captureId)].filter((capture): capture is Capture => Boolean(capture))
    : await listCaptures(options?.limit ?? 400);

  const pending = candidates.filter((capture) => requiresSync(capture, config));

  const stats: SyncRunStats = {
    capturesConsidered: pending.length,
    capturesSynced: 0,
    syncAttempts: 0,
    syncSucceeded: 0,
    syncFailed: 0,
  };

  for (const capture of pending) {
    const expectedTargets = pendingDestinations(capture, config).length;
    if (expectedTargets === 0) {
      continue;
    }

    stats.syncAttempts += expectedTargets;

    const result = await syncCapture(capture, config);

    const updatePayload: Parameters<typeof updateCaptureSyncStatus>[1] = {};
    if (result.slackSynced) {
      updatePayload.synced_slack = 1;
      stats.syncSucceeded += 1;
    }
    if (result.discordSynced) {
      updatePayload.synced_discord = 1;
      stats.syncSucceeded += 1;
    }
    if (result.notionSynced) {
      updatePayload.synced_notion = 1;
      stats.syncSucceeded += 1;
    }
    if (result.googleSynced) {
      updatePayload.synced_google_tasks = 1;
      stats.syncSucceeded += 1;
    }
    if (result.googleCalendarSynced) {
      updatePayload.synced_google_calendar = 1;
      stats.syncSucceeded += 1;
    }
    if (result.appleRemindersSynced) {
      updatePayload.synced_apple_reminders = 1;
      stats.syncSucceeded += 1;
    }
    if (result.remindersSynced) {
      updatePayload.synced_reminders = 1;
      stats.syncSucceeded += 1;
    }
    if (result.appleCalendarSynced) {
      updatePayload.synced_apple_calendar = 1;
      stats.syncSucceeded += 1;
    }

    const failedTargets =
      expectedTargets -
      Number(result.slackSynced) -
      Number(result.discordSynced) -
      Number(result.notionSynced) -
      Number(result.googleSynced) -
      Number(result.googleCalendarSynced) -
      Number(result.appleRemindersSynced) -
      Number(result.remindersSynced) -
      Number(result.appleCalendarSynced);
    stats.syncFailed += Math.max(failedTargets, 0);

    if (Object.keys(updatePayload).length > 0) {
      await updateCaptureSyncStatus(capture.id, updatePayload);
      stats.capturesSynced += 1;
    }

    // Remember where it landed (after the sent flags are saved: a lost link is
    // better than a capture that gets re-sent because this write failed).
    try {
      await saveCaptureLinks(capture.id, result.links);
    } catch (error) {
      console.error("Could not save capture links", error);
    }

    if (result.errors.length > 0) {
      await setCaptureSyncError(capture.id, result.errors.join(" | ").slice(0, 500));
    } else if (capture.last_sync_error) {
      // Everything that was attempted this pass succeeded; clear the stale error.
      await setCaptureSyncError(capture.id, null);
    }

    const landed = landedDestinations(result);
    options?.onCaptureSynced?.({
      captureId: capture.id,
      landed,
      failed: result.attempted.filter((destination) => !landed.includes(destination)),
    });
  }

  let lastSyncLabel = await getLastSyncLabel();
  if (stats.syncSucceeded > 0) {
    const now = new Date();
    await setSetting("last_sync_at", now.toISOString());
    lastSyncLabel = toDisplayTime(now);
  }

  return { stats, lastSyncLabel };
}

export async function runRecurringReminderPass(limit = 25): Promise<RecurringReminderStats> {
  const config = await loadSyncConfig();
  const stats: RecurringReminderStats = { considered: 0, created: 0, failed: 0 };

  if (!config.appleRemindersEnabled) {
    return stats;
  }

  const now = new Date();
  const dueCaptures = await listDueRecurringReminderCaptures(toLocalIso(now), limit);
  stats.considered = dueCaptures.length;

  for (const capture of dueCaptures) {
    const dueAt = capture.recurrence_next_at ? new Date(capture.recurrence_next_at) : now;
    const effectiveDueAt = Number.isNaN(dueAt.getTime()) || dueAt.getTime() < now.getTime()
      ? now
      : dueAt;

    try {
      await createAppleReminder({
        list: config.appleRemindersList,
        title: reminderTitle(capture.content),
        body: recurringReminderBody(capture),
        dueDate: toLocalIso(effectiveDueAt),
      });

      const nextAt = capture.recurrence_rule
        ? nextRecurrenceAfter(effectiveDueAt, capture.recurrence_rule, now)
        : null;
      await setCaptureRecurrenceNextAt(capture.id, nextAt ? toLocalIso(nextAt) : null);
      if (capture.last_sync_error) {
        await setCaptureSyncError(capture.id, null);
      }
      stats.created += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await setCaptureSyncError(capture.id, `Recurring reminder: ${message}`.slice(0, 500));
      stats.failed += 1;
    }
  }

  return stats;
}
