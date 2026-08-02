/**
 * Task-vs-note intent heuristic (Stage 1 of smart routing).
 *
 * Deterministic and explainable by design: every classification carries the
 * signal that produced it, so the routing preview can answer "why there?" and
 * the user can correct it once via a rule. When nothing matches confidently,
 * the answer is "unsure" and routing falls through to the existing defaults.
 */

export type CaptureIntent = "task" | "note" | "unsure";

export interface IntentResult {
  intent: CaptureIntent;
  /** Human-readable trigger, e.g. `starts with "buy"` — embedded in routing reasons. */
  signal: string | null;
}

/** High-precision action verbs that open a to-do ("buy milk", "call the bank"). */
const IMPERATIVE_VERBS = new Set([
  "apply",
  "ask",
  "backup",
  "book",
  "bring",
  "buy",
  "call",
  "cancel",
  "charge",
  "check",
  "clean",
  "collect",
  "complete",
  "deposit",
  "drop",
  "email",
  "feed",
  "fill",
  "finish",
  "fix",
  "get",
  "grab",
  "install",
  "invite",
  "mail",
  "message",
  "order",
  "pay",
  "pick",
  "practice",
  "print",
  "read",
  "refill",
  "register",
  "renew",
  "reply",
  "return",
  "review",
  "schedule",
  "sell",
  "send",
  "ship",
  "sign",
  "submit",
  "take",
  "tell",
  "text",
  "transfer",
  "update",
  "upgrade",
  "walk",
  "wash",
  "water",
]);

const CHECKLIST_REGEX = /(^|\n)\s*-\s*\[[ xX]?\]/;
const TASK_PHRASE_REGEX =
  /\b(don'?t forget|need to|have to|has to|remember to|make sure (?:to|i|we)|to-?do)\b/i;
const URL_REGEX = /\bhttps?:\/\/|\bwww\./i;
const NOTE_OPENER_REGEX =
  /^(idea|ideas|note|notes|thought|thoughts|journal|draft|brainstorm|observation|quote)\b/i;
const QUESTION_OPENER_REGEX =
  /^(what|why|how|when|where|which|who|should|could|would|can|is|are|do|does|did)\b/i;
const NOTE_LENGTH_THRESHOLD = 200;

// Words that mark a timed capture as an appointment (belongs on a calendar,
// occupies a slot) rather than a task (a to-do with a nudge). Presence of one
// of these alongside a time routes to a calendar event instead of Reminders.
const EVENT_NOUN_REGEX =
  /\b(meeting|meet|appt|appointment|call with|sync|standup|stand-up|1:1|one[- ]on[- ]one|interview|lunch|dinner|breakfast|brunch|coffee|drinks|reservation|booking|flight|train|checkup|check-up|doctor|dentist|therapy|gym|class|lesson|session|demo|webinar|conference|party|date night|haircut|viewing|showing|catch[- ]?up|review with|biometrics|visa|embassy|consulate|dmv|notary|immigration|bloodwork|blood test|x-?ray|scan|vaccination|vaccine|physical exam|court|hearing|inspection|orientation|open house|ceremony|screening)\b/i;
// A "with <name>" or "2-3pm" range also reads as a booked slot.
const EVENT_WITH_REGEX = /\bwith\s+[A-Z]/;
const TIME_RANGE_REGEX =
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\bfrom\s+\d{1,2}.*\bto\s+\d{1,2}\b/i;
// "get X done", "drop off X", "pick up X" at a specific time usually means
// being somewhere — an errand slot, not a nudge.
const EVENT_ERRAND_REGEX =
  /\b(?:get(?:ting)?\s+(?:\w+\s+){0,3}done|drop(?:ping)?\s?-?\s?off|pick(?:ing)?\s?-?\s?up)\b/i;
// "by/before/until 5pm" is a deadline: the time bounds the task, it does not
// reserve the slot. Deadlines are tasks no matter what nouns appear.
const DEADLINE_REGEX =
  /\b(?:by|before|until|due)\s+(?:the\s+|this\s+|next\s+)?(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight|eod|end of (?:day|week|month)|tonight|today|tomorrow|weekend|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

export interface EventResult {
  isEvent: boolean;
  /** Human-readable trigger for the routing reason, e.g. `has "meeting"`. */
  signal: string | null;
}

/**
 * Event-vs-task for a capture that already carries a time. An imperative
 * action opener ("call the dentist…", "pay rent…") stays a task even with a
 * time; appointment nouns, a "with <Name>", or an explicit range make it an
 * event. Deterministic and explainable, like the rest of routing.
 */
export function classifyTimedEvent(rawText: string): EventResult {
  const text = rawText.trim();
  if (text.length === 0) {
    return { isEvent: false, signal: null };
  }

  // A deadline bounds a task; it never reserves a slot. "Submit the report
  // by 5pm" and even "get biometrics done by Friday" stay to-dos.
  if (DEADLINE_REGEX.test(text)) {
    return { isEvent: false, signal: null };
  }

  const noun = text.match(EVENT_NOUN_REGEX);
  if (noun) {
    return { isEvent: true, signal: `has "${noun[0].toLowerCase()}"` };
  }
  if (TIME_RANGE_REGEX.test(text)) {
    return { isEvent: true, signal: "spans a time range" };
  }
  const errand = text.match(EVENT_ERRAND_REGEX);
  if (errand) {
    return { isEvent: true, signal: "a timed errand" };
  }
  // "…with Sarah at 4pm" reads as a meeting only when it doesn't open with a
  // task verb ("call mom" stays a reminder even though mom is capitalized).
  if (EVENT_WITH_REGEX.test(text) && !IMPERATIVE_VERBS.has(firstWord(text))) {
    return { isEvent: true, signal: "a meeting with someone" };
  }
  return { isEvent: false, signal: null };
}

function firstWord(text: string): string {
  return text.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z'-]/g, "") ?? "";
}

function nonEmptyLineCount(text: string): number {
  return text.split("\n").filter((line) => line.trim().length > 0).length;
}

export function classifyIntent(rawText: string): IntentResult {
  const text = rawText.trim();
  if (text.length === 0) {
    return { intent: "unsure", signal: null };
  }

  // Task signals first: checklists and to-do phrasing are unambiguous even
  // inside longer text, and an imperative opener is the classic to-do shape.
  if (CHECKLIST_REGEX.test(text)) {
    return { intent: "task", signal: "has a checklist" };
  }

  const taskPhrase = text.match(TASK_PHRASE_REGEX);
  if (taskPhrase) {
    return { intent: "task", signal: `says "${taskPhrase[0].toLowerCase()}"` };
  }

  const opener = firstWord(text);
  const wordCount = text.split(/\s+/).length;
  if (
    IMPERATIVE_VERBS.has(opener) &&
    wordCount >= 2 &&
    nonEmptyLineCount(text) === 1 &&
    !URL_REGEX.test(text)
  ) {
    return { intent: "task", signal: `starts with "${opener}"` };
  }

  // Note signals: reference material and open-ended thinking.
  if (URL_REGEX.test(text)) {
    return { intent: "note", signal: "contains a link" };
  }
  if (NOTE_OPENER_REGEX.test(text)) {
    return { intent: "note", signal: `starts with "${firstWord(text)}"` };
  }
  if (QUESTION_OPENER_REGEX.test(text) && text.endsWith("?")) {
    return { intent: "note", signal: "is a question" };
  }
  if (nonEmptyLineCount(text) >= 3 || text.length > NOTE_LENGTH_THRESHOLD) {
    return { intent: "note", signal: "long-form text" };
  }

  return { intent: "unsure", signal: null };
}
