import type { CaptureTag } from "../../types";
import { httpPostJson } from "../net/http";
import { followUpMessage, formatTaggedListMessage } from "./messageFormat";

export async function sendSlackCapture(
  webhookUrl: string,
  content: string,
  tag: CaptureTag,
  listName: string,
): Promise<void> {
  await httpPostJson(
    webhookUrl,
    {
      text: formatTaggedListMessage(content, tag, listName),
    },
  );
}

/** Webhooks can't edit, so an addition goes out as a short follow-up. */
export async function sendSlackFollowUp(webhookUrl: string, originalTitle: string, addition: string): Promise<void> {
  await httpPostJson(webhookUrl, { text: followUpMessage(originalTitle, addition) });
}

export async function testSlackWebhook(webhookUrl: string): Promise<void> {
  await httpPostJson(
    webhookUrl,
    {
      text: "\u2705 Chute test message",
    },
  );
}
