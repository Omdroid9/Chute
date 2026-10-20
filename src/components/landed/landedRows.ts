import type { Capture, CaptureLink } from "../../types";
import type { AppendState } from "../../lib/db";
import {
  DESTINATION_LABELS,
  describeDestinations,
  isSynced,
  targetedDestinations,
  type SyncDestination,
} from "../../lib/sync/destinations";
import { describeSyncError, type SyncProblem } from "../../lib/sync/syncErrors";
import { destinationReady, type SyncConfig } from "../../lib/sync/syncEngine";

export type LandedStatus = "landed" | "pending" | "failed" | "kept";

/** What a capture became, for the row's icon. */
export type LandedKind = "event" | "reminder" | "note" | "task" | "page" | "message" | "chute";

const KIND_BY_DESTINATION: Record<SyncDestination, LandedKind> = {
  apple_calendar: "event",
  google_calendar: "event",
  reminders: "reminder",
  apple_notes: "note",
  google_tasks: "task",
  notion: "page",
  slack: "message",
  discord: "message",
};

export const KIND_LABELS: Record<LandedKind, string> = {
  event: "Event",
  reminder: "Reminder",
  note: "Note",
  task: "Task",
  page: "Notion page",
  message: "Message",
  chute: "Saved in Chute",
};

export interface LandedTarget {
  destination: SyncDestination;
  label: string;
  synced: boolean;
  /** The created item, when Chute kept its id. */
  link: CaptureLink | null;
}

export interface LandedRow {
  id: string;
  /** One line, for the collapsed row. */
  text: string;
  /** The whole capture with its line breaks (additions included). */
  fullText: string;
  /** What it became where it first landed (or will land). */
  kind: LandedKind;
  /** Where it went, e.g. "Reminders" or "Notes + Slack". */
  where: string;
  status: LandedStatus;
  /** Destinations Chute can actually send to (connected, and timed for calendars). */
  targets: LandedTarget[];
  problem: SyncProblem | null;
  reminderTime: string | null;
  /** When it was captured, as stored (UTC). */
  createdAt: string;
}

export interface LandedCounts {
  total: number;
  failed: number;
  pending: number;
}

export function toLandedRow(
  capture: Capture,
  config: SyncConfig,
  links: CaptureLink[] = [],
  appends?: AppendState,
): LandedRow {
  const text = capture.content.replace(/\s+/g, " ").trim();
  const fullText = capture.content.trim();
  // A destination that isn't connected was never going to be sent to, so the
  // capture simply stayed in Chute as far as that app is concerned.
  const targets: LandedTarget[] = targetedDestinations(capture)
    .filter((destination) => destinationReady(capture, destination, config))
    .map((destination) => ({
      destination,
      label: DESTINATION_LABELS[destination],
      synced: isSynced(capture, destination),
      link: links.find((link) => link.destination === destination) ?? null,
    }));

  const primary = targets.find((target) => target.synced) ?? targets[0];
  const base = {
    id: capture.id,
    text,
    fullText,
    kind: primary ? KIND_BY_DESTINATION[primary.destination] : ("chute" as const),
    reminderTime: capture.reminder_time,
    createdAt: capture.created_at,
  };
  if (targets.length === 0) {
    return { ...base, where: "Chute", status: "kept", targets, problem: null };
  }

  const sendProblem = describeSyncError(capture.last_sync_error);
  const allSynced = targets.every((target) => target.synced);
  let status: LandedStatus = allSynced ? "landed" : sendProblem ? "failed" : "pending";
  let problem = status === "failed" ? sendProblem : null;

  // Additions ("Add to") still on their way, or stuck, count too.
  if (appends && appends.pending > 0) {
    if (appends.error && status !== "failed") {
      status = "failed";
      problem = describeSyncError(appends.error);
    } else if (status === "landed") {
      status = "pending";
    }
  }

  return {
    ...base,
    where: describeDestinations(targets.map((target) => target.destination)),
    status,
    targets,
    problem,
  };
}

/** What a click on the row opens: the first place it landed, else the first target. */
export function primaryTarget(row: LandedRow): LandedTarget | null {
  return row.targets.find((target) => target.synced) ?? row.targets[0] ?? null;
}

export function countLanded(rows: LandedRow[]): LandedCounts {
  return {
    total: rows.length,
    failed: rows.filter((row) => row.status === "failed").length,
    pending: rows.filter((row) => row.status === "pending").length,
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * A reminder time (stored as a local ISO string) the way people say it:
 * "Today 6:00 PM", "Tomorrow 9:00 AM", "Tue 4:00 PM", "Oct 28, 4:00 PM".
 */
export function formatWhen(localIso: string | null, now = new Date()): string | null {
  const match = localIso?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const when = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  const time = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth())}-${pad(date.getDate())}`;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime() - today.getTime()) / 86_400_000);
  if (dayKey(when) === dayKey(now)) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  if (days > 1 && days < 7) return `${when.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return `${when.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
