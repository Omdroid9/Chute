import type { CaptureTag } from "../../types";

const EMOJI_BY_TAG: Record<CaptureTag, string> = {
  work: "\u{1F4BC}",
  personal: "\u{1F464}",
  idea: "\u{1F4A1}",
  untagged: "\u{1F4DD}",
};

export function formatTaggedMessage(content: string, tag: CaptureTag): string {
  return `${EMOJI_BY_TAG[tag]} ${content}`;
}

export function formatTaggedListMessage(content: string, tag: CaptureTag, listName: string): string {
  const safeList = listName.trim() || "Inbox";
  const base = formatTaggedMessage(content, tag);
  if (safeList.toLowerCase() === "inbox") {
    return base;
  }
  return `${base}\n\u{1F5C2}\u{FE0F} ${safeList}`;
}

/** An addition posted after the original, for chats that can't edit it. */
export function followUpMessage(originalTitle: string, addition: string): string {
  return `\u21B3 ${addition}\n_Added to \u201C${originalTitle}\u201D_`;
}
