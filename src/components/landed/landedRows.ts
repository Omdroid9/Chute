import type { Capture, CaptureLink } from "../../types";
import {
  DESTINATION_LABELS,
  isSynced,
  targetedDestinations,
  type SyncDestination,
} from "../../lib/sync/destinations";
import { describeSyncError, type SyncProblem } from "../../lib/sync/syncErrors";
import { destinationReady, type SyncConfig } from "../../lib/sync/syncEngine";

export type LandedStatus = "landed" | "pending" | "failed" | "kept";

export interface LandedTarget {
  destination: SyncDestination;
  label: string;
  synced: boolean;
  /** The created item, when Chute kept its id. */
  link: CaptureLink | null;
}

export interface LandedRow {
  id: string;
  text: string;
  /** Where it went, e.g. "Reminders" or "Notes + Slack". */
  where: string;
  status: LandedStatus;
  /** Destinations Chute can actually send to (connected, and timed for calendars). */
  targets: LandedTarget[];
  problem: SyncProblem | null;
  reminderTime: string | null;
}

export interface LandedCounts {
  total: number;
  failed: number;
  pending: number;
}

/** "Reminders", "Notes + Slack", "Reminders +2". */
export function describeDestinations(destinations: SyncDestination[]): string {
  const labels = destinations.map((destination) => DESTINATION_LABELS[destination]);
  return labels.length > 2 ? `${labels[0]} +${labels.length - 1}` : labels.join(" + ");
}

export function toLandedRow(capture: Capture, config: SyncConfig, links: CaptureLink[] = []): LandedRow {
  const text = capture.content.replace(/\s+/g, " ").trim();
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

  const base = { id: capture.id, text, reminderTime: capture.reminder_time };
  if (targets.length === 0) {
    return { ...base, where: "Chute", status: "kept", targets, problem: null };
  }

  const problem = describeSyncError(capture.last_sync_error);
  const allSynced = targets.every((target) => target.synced);
  const status: LandedStatus = allSynced ? "landed" : problem ? "failed" : "pending";
  return {
    ...base,
    where: describeDestinations(targets.map((target) => target.destination)),
    status,
    targets,
    problem: status === "failed" ? problem : null,
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
