import { emit } from "@tauri-apps/api/event";
import {
  getCaptureById,
  saveCaptureLinks,
  setCaptureCompleted,
  setCapturePlannedAt,
  setCaptureReminder,
} from "../../lib/db";
import { findOriginalAppleItem } from "../../lib/sync/appendEngine";
import { moveAppleCalendarEvent } from "../../lib/sync/appleCalendar";
import {
  createAppleReminder,
  setAppleReminderCompleted,
  snoozeAppleReminder,
} from "../../lib/sync/appleRemindersSync";
import type { SyncDestination } from "../../lib/sync/destinations";
import { loadSyncConfig } from "../../lib/sync/syncManager";
import { PLAN_LINK_KIND, type LandedRow, type MoveKind } from "./landedRows";

/** The item's id in its app: the one Chute kept, else found by its title (and kept). */
async function itemIdFor(row: LandedRow, destination: SyncDestination, missing: string): Promise<string> {
  const link = row.targets.find((target) => target.destination === destination)?.link;
  if (link) return link.externalId;
  const [capture, config] = await Promise.all([getCaptureById(row.id), loadSyncConfig()]);
  const found = capture ? await findOriginalAppleItem(destination, capture, config) : null;
  if (!found) throw new Error(missing);
  return found.externalId;
}

const reminderIdFor = (row: LandedRow) => itemIdFor(row, "reminders", "Couldn't find the reminder in Reminders.");

/**
 * Done (or Undo) from Landed. Reminders goes first: Chute only records what
 * Reminders accepted, so the row never claims a change that didn't happen.
 */
export async function setReminderDone(row: LandedRow, done: boolean): Promise<void> {
  await setAppleReminderCompleted(await reminderIdFor(row), done);
  await setCaptureCompleted(row.id, done);
  await emit("chute://captures-changed");
}

/** Snooze from Landed: the due date in Reminders, then the capture's reminder time (local ISO). */
export async function snoozeReminder(row: LandedRow, until: string): Promise<void> {
  await snoozeAppleReminder(await reminderIdFor(row), until);
  await setCaptureReminder(row.id, until);
  await emit("chute://captures-changed");
}

const notAuthorized = (error: unknown) => /-1743|not authori[sz]ed/i.test(String(error));

/**
 * The reminder that makes a moved note still come up on its new day: the one
 * made for an earlier move, moved again, else a new one (kept as a link).
 */
async function planReminder(row: LandedRow, at: string): Promise<void> {
  if (row.planLink) {
    try {
      await snoozeAppleReminder(row.planLink.externalId, at);
      return;
    } catch (error) {
      // Deleted in Reminders since: make a new one. Without permission, say so.
      if (notAuthorized(error)) throw error;
    }
  }
  const config = await loadSyncConfig();
  const [first = "", ...rest] = row.fullText.split("\n");
  const id = await createAppleReminder({
    list: config.appleRemindersList,
    title: (first.trim() || row.text).slice(0, 80) || "Chute",
    body: rest.join("\n").trim(),
    dueDate: at,
  });
  await saveCaptureLinks(row.id, [{ destination: "reminders", externalId: id, kind: PLAN_LINK_KIND }]);
}

/**
 * Move a capture to another day from Landed, to `at` (a local ISO datetime).
 * A reminder or event moves in its app; anything else gets the day in Chute
 * and a reminder so it still comes up. The app goes first, so Chute only
 * records a move that happened there.
 */
export async function moveToDay(row: LandedRow, kind: MoveKind, at: string): Promise<void> {
  if (kind === "reminder") {
    // Moving a reminder means it's still to do, so it's no longer done.
    await snoozeAppleReminder(await reminderIdFor(row), at);
    await setCaptureReminder(row.id, at);
    if (row.done) await setCaptureCompleted(row.id, false);
  } else if (kind === "event") {
    const [uid, config] = await Promise.all([
      itemIdFor(row, "apple_calendar", "Couldn't find the event in Calendar."),
      loadSyncConfig(),
    ]);
    await moveAppleCalendarEvent(uid, at, config.appleCalendarName);
    await setCaptureReminder(row.id, at);
  } else {
    await planReminder(row, at);
    await setCapturePlannedAt(row.id, at);
  }
  await emit("chute://captures-changed");
}
