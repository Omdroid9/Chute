import { invoke } from "@tauri-apps/api/core";

export type AppleItemDestination = "reminders" | "apple_notes" | "apple_calendar";

/**
 * Find the reminder, note or event a capture became when Chute didn't keep
 * its id (captures sent before ids were recorded). Resolves to "" if nothing
 * matches. See `find_apple_item` for how candidates are chosen.
 */
export function findAppleItem(input: {
  destination: AppleItemDestination;
  title: string;
  /** Reminders list, Notes folder, or Calendar name ("" = writable calendars). */
  container: string;
  /** Local ISO time the capture was made; the item can't be older. */
  notBefore: string;
  /** Local ISO event start (Calendar only). */
  start?: string | null;
  /** Ids already matched to other captures. */
  excluded: string[];
}): Promise<string> {
  return invoke<string>("find_apple_item", {
    destination: input.destination,
    title: input.title,
    container: input.container,
    notBefore: input.notBefore,
    start: input.start ?? null,
    excluded: input.excluded,
  });
}
