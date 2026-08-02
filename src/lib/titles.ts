import { parseReminderSyntax } from "./parser";

// Leading filler that reads fine in a captured thought but not as a title:
// "i should really call the bank" → "call the bank".
const LEADING_FILLER =
  /^(?:i\s+(?:should(?:\s+really)?|really\s+should|need(?:\s+to)?|have\s+to|got(?:ta|\s+to)|want(?:\s+to)?|must|ought\s+to)|really|please|kindly|remember\s+to|remind\s+me(?:\s+to)?|note\s+to\s+self:?\s*|make\s+sure(?:\s+to)?|don'?t\s+forget(?:\s+to)?|let'?s|lets|gonna|going\s+to)\s+/i;

// A trailing schedule/deadline phrase — the time already lives in the event's
// date, so repeating it in the title is noise ("get api work done by this
// weekend" → "get api work done"). Requires a real marker (by/before/…, or
// this/next) so meaningful tails like "plan for the week" survive.
const TRAILING_TIME =
  /[\s,]+(?:(?:by|before|until|due|on)\s+(?:the\s+|this\s+|next\s+)?|(?:this|next)\s+)(?:weekend|week|month|morning|afternoon|evening|tonight|today|tomorrow|eod|end\s+of\s+(?:day|week|month)|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s*$/i;
const TRAILING_ABSOLUTE = /[\s,]+(?:tonight|today|tomorrow)\s*$/i;

/**
 * A crisp title for a timed capture (calendar event or reminder): the parser's
 * de-timed text with leading filler and any trailing schedule phrase removed,
 * sentence-cased. Falls back to the raw first line if cleaning empties it, so
 * a title is never blank.
 */
export function eventTitle(content: string): string {
  const firstLine = (content.split("\n")[0] ?? content).trim();
  let t = (parseReminderSyntax(firstLine).cleanedContent || firstLine).trim();
  t = t.replace(LEADING_FILLER, "").trim();

  let prev = "";
  while (t !== prev) {
    prev = t;
    t = t.replace(TRAILING_TIME, "").replace(TRAILING_ABSOLUTE, "").trim();
  }

  if (t.length === 0) {
    t = firstLine;
  }
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 80);
}
