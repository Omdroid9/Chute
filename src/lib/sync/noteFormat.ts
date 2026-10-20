/**
 * Builds the HTML body for an Apple Note so structure the user typed
 * survives the trip: dash/star lines become real bullets, numbered lines
 * a real ordered list, and checkbox syntax keeps its box glyph. Apple
 * Notes' AppleScript bridge accepts simple HTML (div/ul/ol/li/b/i) but
 * cannot create interactive checklists, so ☐/☑ is the honest rendering.
 *
 * Notes titles the note from its first body line — there is no separate
 * title field. Plain lines stay plain divs so that behavior is unchanged.
 */

const CHECKBOX_LINE_REGEX = /^\s*- \[([ xX])\]\s+(.*)$/;
const BULLET_LINE_REGEX = /^\s*[-*]\s+(.*)$/;
const ORDERED_LINE_REGEX = /^\s*\d+\.\s+(.*)$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Note HTML for typed content: bullets, numbered lines and checkboxes kept. */
export function noteContentHtml(content: string): string {
  const html: string[] = [];
  let items: string[] = [];
  let listTag: "ul" | "ol" | null = null;

  const flushList = () => {
    if (listTag && items.length > 0) {
      html.push(`<${listTag}>${items.join("")}</${listTag}>`);
    }
    items = [];
    listTag = null;
  };

  for (const line of content.split("\n")) {
    const checkbox = line.match(CHECKBOX_LINE_REGEX);
    const bullet = checkbox ? null : line.match(BULLET_LINE_REGEX);
    const ordered = checkbox || bullet ? null : line.match(ORDERED_LINE_REGEX);

    if (checkbox) {
      if (listTag !== "ul") {
        flushList();
        listTag = "ul";
      }
      const box = checkbox[1] === " " ? "☐" : "☑";
      items.push(`<li>${box} ${escapeHtml(checkbox[2])}</li>`);
    } else if (bullet) {
      if (listTag !== "ul") {
        flushList();
        listTag = "ul";
      }
      items.push(`<li>${escapeHtml(bullet[1])}</li>`);
    } else if (ordered) {
      if (listTag !== "ol") {
        flushList();
        listTag = "ol";
      }
      items.push(`<li>${escapeHtml(ordered[1])}</li>`);
    } else {
      flushList();
      html.push(`<div>${escapeHtml(line) || "<br>"}</div>`);
    }
  }
  flushList();
  return html.join("");
}

export function appleNoteBody(content: string, listName: string, tag: string): string {
  const footer = `<div><br></div><div><i>${escapeHtml(listName)} • ${escapeHtml(tag)}</i></div>`;
  return `${noteContentHtml(content)}${footer}`;
}
