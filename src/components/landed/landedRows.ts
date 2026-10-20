import type { Capture } from "../../types";

export type LandedStatus = "landed" | "pending" | "failed" | "kept";

export interface LandedRow {
  id: string;
  text: string;
  /** Where it went, e.g. "Reminders" or "Notes + Slack". */
  where: string;
  status: LandedStatus;
}

export interface LandedCounts {
  total: number;
  failed: number;
  pending: number;
}

// `target_apple_reminders` / `synced_apple_reminders` are Apple Notes (legacy
// column names); `target_reminders` is the Reminders app.
const DESTINATIONS: Array<[label: string, target: keyof Capture, synced: keyof Capture]> = [
  ["Reminders", "target_reminders", "synced_reminders"],
  ["Calendar", "target_apple_calendar", "synced_apple_calendar"],
  ["Notes", "target_apple_reminders", "synced_apple_reminders"],
  ["Google Calendar", "target_google_calendar", "synced_google_calendar"],
  ["Google Tasks", "target_google_tasks", "synced_google_tasks"],
  ["Notion", "target_notion", "synced_notion"],
  ["Slack", "target_slack", "synced_slack"],
  ["Discord", "target_discord", "synced_discord"],
];

export function toLandedRow(capture: Capture): LandedRow {
  const targets = DESTINATIONS.filter(([, target]) => Boolean(capture[target]));
  const text = capture.content.replace(/\s+/g, " ").trim();
  if (targets.length === 0) {
    return { id: capture.id, text, where: "Chute", status: "kept" };
  }
  const allSynced = targets.every(([, , synced]) => Boolean(capture[synced]));
  const status: LandedStatus = allSynced ? "landed" : capture.last_sync_error ? "failed" : "pending";
  const where = targets.length > 2
    ? `${targets[0][0]} +${targets.length - 1}`
    : targets.map(([label]) => label).join(" + ");
  return { id: capture.id, text, where, status };
}

export function countLanded(rows: LandedRow[]): LandedCounts {
  return {
    total: rows.length,
    failed: rows.filter((row) => row.status === "failed").length,
    pending: rows.filter((row) => row.status === "pending").length,
  };
}
