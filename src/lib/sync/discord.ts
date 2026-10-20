import type { CaptureTag } from "../../types";
import { httpPostJson, httpRequest, readJsonId } from "../net/http";
import { followUpMessage, formatTaggedListMessage } from "./messageFormat";

/**
 * Discord only returns the posted message (and its id, which lets a webhook
 * edit it later) when the request asks it to wait.
 */
export function discordWaitUrl(webhookUrl: string): string {
  try {
    const url = new URL(webhookUrl);
    url.searchParams.set("wait", "true");
    return url.toString();
  } catch {
    return webhookUrl;
  }
}

/** Resolves to the posted message's id (empty if Discord didn't return one). */
export async function sendDiscordCapture(
  webhookUrl: string,
  content: string,
  tag: CaptureTag,
  listName: string,
): Promise<string> {
  const response = await httpPostJson(
    discordWaitUrl(webhookUrl),
    {
      content: formatTaggedListMessage(content, tag, listName),
    },
  );
  return readJsonId(response, (message) => message.id);
}

/**
 * Replace a message the webhook posted earlier (Discord lets a webhook edit
 * its own messages), keeping any thread the webhook URL targets.
 */
export async function editDiscordMessage(webhookUrl: string, messageId: string, content: string): Promise<void> {
  const url = new URL(webhookUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/messages/${encodeURIComponent(messageId)}`;
  url.searchParams.delete("wait");
  await httpRequest(url.toString(), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

/** Without the original's id, an addition goes out as a follow-up. */
export async function sendDiscordFollowUp(webhookUrl: string, originalTitle: string, addition: string): Promise<void> {
  await httpPostJson(webhookUrl, { content: followUpMessage(originalTitle, addition) });
}

export async function testDiscordWebhook(webhookUrl: string): Promise<void> {
  await httpPostJson(
    webhookUrl,
    {
      content: "\u2705 Chute test message",
    },
  );
}
