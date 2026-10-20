import { invoke } from "@tauri-apps/api/core";
import type { CaptureLink } from "../../types";
import type { LandedRow, LandedTarget } from "./landedRows";

const compactId = (id: string) => id.trim().replace(/-/g, "");

/** A Notion page opens directly; a block opens on the page it was appended to. */
export function notionUrl(link: CaptureLink | null, pageId: string | undefined): string {
  if (link?.kind === "page") return `https://www.notion.so/${compactId(link.externalId)}`;
  if (link && pageId) return `https://www.notion.so/${compactId(pageId)}#${compactId(link.externalId)}`;
  if (pageId) return `https://www.notion.so/${compactId(pageId)}`;
  return "https://www.notion.so/";
}

/** Google Calendar's day view for a local ISO datetime. */
export function googleCalendarDayUrl(reminderTime: string | null): string {
  const day = reminderTime?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!day) return "https://calendar.google.com/";
  return `https://calendar.google.com/calendar/r/day/${day[1]}/${Number(day[2])}/${Number(day[3])}`;
}

/** Web destinations open as URLs; Apple apps need AppleScript. */
export function targetUrl(row: LandedRow, target: LandedTarget, notionPageId?: string): string | null {
  switch (target.destination) {
    case "google_calendar":
      return googleCalendarDayUrl(row.reminderTime);
    case "google_tasks":
      return "https://tasks.google.com/";
    case "notion":
      return notionUrl(target.link, notionPageId);
    case "slack":
      return "slack://open";
    case "discord":
      return "https://discord.com/app";
    default:
      return null;
  }
}

/** Bring a capture forward where it landed; captures kept in Chute open the Library. */
export async function openTarget(
  row: LandedRow,
  target: LandedTarget | null,
  notionPageId?: string,
): Promise<void> {
  if (!target) {
    await invoke("show_library_window");
    return;
  }
  const url = targetUrl(row, target, notionPageId);
  if (url) {
    await invoke("open_external_url", { url });
    return;
  }
  await invoke("open_in_apple_app", {
    destination: target.destination,
    externalId: target.link?.externalId ?? "",
    date: target.destination === "apple_calendar" ? row.reminderTime : null,
  });
}
