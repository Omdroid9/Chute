// Chute-native countdown timers. A capture like "pomodoro", "timer for 25 min",
// or "set a 90 second timer" starts a timer that dings when it's done — handled
// entirely in-app, no external destination. Requires an explicit "timer" (or
// "pomodoro") keyword so "call mom in 10 minutes" stays a reminder.

export interface TimerParse {
  /** Total duration in seconds. */
  seconds: number;
  /** Human label for the toast and the fired alert. */
  label: string;
}

const POMODORO = /\bpomodoros?\b/i;
const TIMER_KEYWORD = /\btimers?\b/i;
const BREAK_KEYWORD = /\b(?:short\s+break|coffee\s+break|tea\s+break|break)\b/i;
// "25 min", "1 hour", "90 sec", "25m", "1h", "30s" — captured repeatedly.
const DURATION = /(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi;

const POMODORO_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;

function formatLabel(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);
  return `${parts.join(" ") || "0m"} timer`;
}

/** Returns a timer when the capture is an explicit timer/pomodoro request. */
export function parseTimer(text: string): TimerParse | null {
  const t = text.trim();
  const isPomodoro = POMODORO.test(t);
  const isBreak = BREAK_KEYWORD.test(t);
  const hasTimer = TIMER_KEYWORD.test(t);
  if (!isPomodoro && !hasTimer && !isBreak) {
    return null;
  }

  let seconds = 0;
  DURATION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DURATION.exec(t)) !== null) {
    const n = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit.startsWith("h")) seconds += n * 3600;
    else if (unit.startsWith("m")) seconds += n * 60;
    else seconds += n;
  }

  if (seconds === 0) {
    if (isPomodoro) seconds = POMODORO_SECONDS;
    else if (isBreak) seconds = BREAK_SECONDS;
    else return null; // "timer" with no duration is ambiguous — leave it be.
  }

  // Cap at 24h so a fat-fingered "timer for 9999 hours" can't hang around.
  seconds = Math.min(seconds, 24 * 3600);

  let label: string;
  if (isPomodoro && seconds === POMODORO_SECONDS) label = "Pomodoro";
  else if (isBreak && seconds === BREAK_SECONDS) label = "Break";
  else label = formatLabel(seconds);

  return { seconds, label };
}

/** "25:00" style remaining-time string for UI. */
export function formatCountdown(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
