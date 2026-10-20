/**
 * SQLite's CURRENT_TIMESTAMP (every `created_at`) is UTC written as
 * "YYYY-MM-DD HH:MM:SS" with no zone, which `new Date()` reads as local time,
 * putting captures hours off. Read it as UTC; anything with a zone is kept.
 */
export function parseStoredTimestamp(value: string): Date {
  const trimmed = value.trim();
  const bare = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/);
  return new Date(bare ? `${bare[1]}T${bare[2]}Z` : trimmed);
}

/** Whether a stored timestamp falls on today's local date. */
export function isStoredToday(value: string, now = new Date()): boolean {
  const date = parseStoredTimestamp(value);
  return !Number.isNaN(date.getTime()) && date.toDateString() === now.toDateString();
}
