/**
 * "Add to": send additions to the item a capture already became in each app.
 * Each app gets the closest thing to editing the original: a line in a
 * reminder's/task's/event's notes, a block after the original in Notion, an
 * edit of the Discord message. Slack webhooks can't edit, so Slack gets a
 * short follow-up. Without the original's id, the addition goes out as its
 * own item rather than being lost.
 */
import type { Capture, CaptureLink } from "../../types";
import { getCaptureById, getCaptureLinks, listPendingAppends, markAppendDone, markAppendFailed } from "../db";
import { eventTitle } from "../titles";
import { appendToAppleCalendarEvent } from "./appleCalendar";
import { appendToAppleNote, createAppleNote } from "./appleNotes";
import { appendToAppleReminder, createAppleReminder } from "./appleRemindersSync";
import { SYNC_ERROR_LABELS, type SyncDestination } from "./destinations";
import { editDiscordMessage, sendDiscordFollowUp } from "./discord";
import { appendToGoogleEventDescription, calendarEventId } from "./googleCalendar";
import { appendToGoogleTaskNotes, createGoogleTask } from "./googleTasks";
import { formatTaggedListMessage } from "./messageFormat";
import { appendNotionAddition } from "./notion";
import { appleNoteBody } from "./noteFormat";
import { sendSlackFollowUp } from "./slack";
import { destinationReady, withGoogleAccess, type SyncConfig } from "./syncEngine";

/** Discord rejects messages over 2000 characters. */
const DISCORD_MAX_CHARS = 2000;

/** What one capture's additions did this pass, for the Landed confirmation. */
export interface AppendOutcome {
  captureId: string;
  landed: SyncDestination[];
  failed: SyncDestination[];
}

/**
 * Send one addition. `capture` already holds the merged text (original plus
 * every addition), so its first line is still the original's title.
 */
export async function appendToDestination(
  destination: SyncDestination,
  capture: Capture,
  link: CaptureLink | null,
  addition: string,
  config: SyncConfig,
): Promise<void> {
  const title = eventTitle(capture.content);
  switch (destination) {
    case "slack":
      return sendSlackFollowUp(config.slackWebhookUrl!, title, addition);
    case "discord":
      return link
        ? editDiscordMessage(
            config.discordWebhookUrl!,
            link.externalId,
            formatTaggedListMessage(capture.content, capture.tag, capture.list_name).slice(0, DISCORD_MAX_CHARS),
          )
        : sendDiscordFollowUp(config.discordWebhookUrl!, title, addition);
    case "notion":
      return appendNotionAddition({
        token: config.notionToken!,
        pageId: config.notionPageId!,
        ref: link ? { kind: link.kind === "page" ? "page" : "block", id: link.externalId } : null,
        addition,
      });
    case "google_tasks":
      if (!link) {
        await withGoogleAccess(config, (accessToken) =>
          createGoogleTask({
            accessToken,
            listId: config.googleTasksListId!,
            title: addition,
            notes: `Added to “${title}”`,
          }),
        );
        return;
      }
      return withGoogleAccess(config, (accessToken) =>
        appendToGoogleTaskNotes({ accessToken, listId: config.googleTasksListId!, taskId: link.externalId, addition }),
      );
    case "google_calendar":
      // The event id is derived from the capture id, so no link is needed.
      return withGoogleAccess(config, (accessToken) =>
        appendToGoogleEventDescription({
          accessToken,
          calendarId: config.googleCalendarId!,
          eventId: link?.externalId || calendarEventId(capture.id),
          addition,
        }),
      );
    case "apple_notes":
      if (!link) {
        await createAppleNote({
          title,
          body: appleNoteBody(`Added to “${title}”\n${addition}`, capture.list_name, capture.tag),
          folder: config.appleNotesFolder,
        });
        return;
      }
      return appendToAppleNote(link.externalId, addition);
    case "reminders":
      if (!link) {
        await createAppleReminder({
          list: config.appleRemindersList,
          title: addition,
          body: `Added to “${title}”`,
          dueDate: null,
        });
        return;
      }
      return appendToAppleReminder(link.externalId, addition);
    case "apple_calendar":
      // An event can't be recreated without its time; say so instead.
      if (!link) throw new Error("Couldn't find the original event in Calendar.");
      return appendToAppleCalendarEvent(link.externalId, addition);
  }
}

/**
 * Send queued additions, oldest first. After a failure, later additions to
 * the same app wait for the next pass so they never land out of order.
 */
export async function runAppendPass(
  config: SyncConfig,
  onOutcome?: (outcome: AppendOutcome) => void,
): Promise<{ succeeded: number; failed: number }> {
  const pending = await listPendingAppends();
  const captures = new Map<string, Capture | null>();
  const links = new Map<string, CaptureLink[]>();
  const blocked = new Set<string>();
  const outcomes = new Map<string, AppendOutcome>();
  let succeeded = 0;
  let failed = 0;

  for (const item of pending) {
    const key = `${item.captureId}:${item.destination}`;
    if (blocked.has(key)) continue;

    if (!captures.has(item.captureId)) {
      captures.set(item.captureId, await getCaptureById(item.captureId));
      links.set(item.captureId, await getCaptureLinks(item.captureId));
    }
    const capture = captures.get(item.captureId);
    if (!capture) {
      // The capture was deleted; there's nothing left to add to.
      await markAppendDone(item.id);
      continue;
    }
    // Disconnected since: keep it queued until the app is connected again.
    if (!destinationReady(capture, item.destination, config)) continue;

    const link = links.get(item.captureId)?.find((candidate) => candidate.destination === item.destination) ?? null;
    const outcome = outcomes.get(item.captureId) ?? { captureId: item.captureId, landed: [], failed: [] };
    outcomes.set(item.captureId, outcome);
    try {
      await appendToDestination(item.destination, capture, link, item.content, config);
      await markAppendDone(item.id);
      succeeded += 1;
      if (!outcome.landed.includes(item.destination)) outcome.landed.push(item.destination);
    } catch (error) {
      blocked.add(key);
      const message = error instanceof Error ? error.message : String(error);
      await markAppendFailed(item.id, `${SYNC_ERROR_LABELS[item.destination]}: ${message}`);
      failed += 1;
      if (!outcome.failed.includes(item.destination)) outcome.failed.push(item.destination);
    }
  }

  outcomes.forEach((outcome) => onOutcome?.(outcome));
  return { succeeded, failed };
}
