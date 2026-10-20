/**
 * Plain-language reading of a stored sync error (`last_sync_error`), which is
 * "<Label>: <raw error>" entries joined with " | ".
 */

export type SyncProblemKind = "permission" | "reconnect" | "offline" | "other";

export interface SyncProblem {
  kind: SyncProblemKind;
  /** The app it's about, e.g. "Calendar", or null if unknown. */
  app: string | null;
  message: string;
}

// The labels syncEngine/syncManager prefix errors with.
const APP_FOR_LABEL: Record<string, string> = {
  Slack: "Slack",
  Discord: "Discord",
  Notion: "Notion",
  "Google Tasks": "Google Tasks",
  "Google Calendar": "Google Calendar",
  "Apple Notes": "Notes",
  Reminders: "Reminders",
  "Apple Calendar": "Calendar",
  "Recurring reminder": "Reminders",
};

const PERMISSION = /-1743|not authori[sz]ed to send apple events|not allowed to send apple events|erraeventnotpermitted/i;
const RECONNECT = /http 401|http 403|invalid_grant|unauthori[sz]ed|invalid (access )?token/i;
const OFFLINE = /network|offline|timed out|timeout|failed to fetch|could not connect|error sending request|dns/i;

function shorten(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** The first problem in a stored sync error, or null if there is none. */
export function describeSyncError(raw: string | null | undefined): SyncProblem | null {
  const first = raw?.split(" | ")[0]?.trim();
  if (!first) return null;

  const colon = first.indexOf(": ");
  const label = colon > 0 ? first.slice(0, colon) : "";
  const detail = colon > 0 ? first.slice(colon + 2) : first;
  const app = APP_FOR_LABEL[label] ?? null;
  const name = app ?? "this app";

  if (PERMISSION.test(detail)) {
    return { kind: "permission", app, message: `Chute needs permission to use ${name}` };
  }
  if (RECONNECT.test(detail)) {
    return { kind: "reconnect", app, message: `Reconnect ${name} in Settings` };
  }
  if (OFFLINE.test(detail)) {
    return { kind: "offline", app, message: `Couldn't reach ${app ?? "the app"}; will retry` };
  }
  return { kind: "other", app, message: app ? `${app}: ${shorten(detail)}` : shorten(detail) };
}
