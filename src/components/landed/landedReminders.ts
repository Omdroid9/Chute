import { emit } from "@tauri-apps/api/event";
import { getCaptureById, setCaptureCompleted, setCaptureReminder } from "../../lib/db";
import { findOriginalAppleItem } from "../../lib/sync/appendEngine";
import { setAppleReminderCompleted, snoozeAppleReminder } from "../../lib/sync/appleRemindersSync";
import { loadSyncConfig } from "../../lib/sync/syncManager";
import type { LandedRow } from "./landedRows";

/** The reminder's id in Reminders: the one Chute kept, else found by its title (and kept). */
async function reminderIdFor(row: LandedRow): Promise<string> {
  const link = row.targets.find((target) => target.destination === "reminders")?.link;
  if (link) return link.externalId;
  const [capture, config] = await Promise.all([getCaptureById(row.id), loadSyncConfig()]);
  const found = capture ? await findOriginalAppleItem("reminders", capture, config) : null;
  if (!found) throw new Error("Couldn't find the reminder in Reminders.");
  return found.externalId;
}

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
