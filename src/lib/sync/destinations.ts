import type { Capture, LinkDestination } from "../../types";

/** Every app a capture can be sent to. Slack has no link (webhooks return no id). */
export type SyncDestination = "slack" | LinkDestination;

/** Display order: Apple apps first, since they're where most captures land. */
export const SYNC_DESTINATIONS: SyncDestination[] = [
  "reminders",
  "apple_calendar",
  "apple_notes",
  "google_calendar",
  "google_tasks",
  "notion",
  "slack",
  "discord",
];

export const DESTINATION_LABELS: Record<SyncDestination, string> = {
  reminders: "Reminders",
  apple_calendar: "Calendar",
  apple_notes: "Notes",
  google_calendar: "Google Calendar",
  google_tasks: "Google Tasks",
  notion: "Notion",
  slack: "Slack",
  discord: "Discord",
};

// `target_apple_reminders` / `synced_apple_reminders` are Apple Notes (legacy
// column names); `target_reminders` is the Reminders app.
const COLUMNS: Record<SyncDestination, { target: keyof Capture; synced: keyof Capture }> = {
  reminders: { target: "target_reminders", synced: "synced_reminders" },
  apple_calendar: { target: "target_apple_calendar", synced: "synced_apple_calendar" },
  apple_notes: { target: "target_apple_reminders", synced: "synced_apple_reminders" },
  google_calendar: { target: "target_google_calendar", synced: "synced_google_calendar" },
  google_tasks: { target: "target_google_tasks", synced: "synced_google_tasks" },
  notion: { target: "target_notion", synced: "synced_notion" },
  slack: { target: "target_slack", synced: "synced_slack" },
  discord: { target: "target_discord", synced: "synced_discord" },
};

export function isTargeted(capture: Capture, destination: SyncDestination): boolean {
  return capture[COLUMNS[destination].target] === 1;
}

export function isSynced(capture: Capture, destination: SyncDestination): boolean {
  return capture[COLUMNS[destination].synced] === 1;
}

/** The capture's chosen destinations, in display order. */
export function targetedDestinations(capture: Capture): SyncDestination[] {
  return SYNC_DESTINATIONS.filter((destination) => isTargeted(capture, destination));
}
