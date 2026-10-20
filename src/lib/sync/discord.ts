import type { CaptureTag } from "../../types";
import { httpPostJson, readJsonId } from "../net/http";
import { formatTaggedListMessage } from "./messageFormat";

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

export async function testDiscordWebhook(webhookUrl: string): Promise<void> {
  await httpPostJson(
    webhookUrl,
    {
      content: "\u2705 Chute test message",
    },
  );
}
