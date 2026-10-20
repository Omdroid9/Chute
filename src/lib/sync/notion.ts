import type { CaptureTag } from "../../types";
import { httpRequest, readJsonId } from "../net/http";
import { formatTaggedListMessage } from "./messageFormat";

const NOTION_VERSION = "2022-06-28";

function notionHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

function normalizeParentId(value: string): string {
  return value.trim().replaceAll("-", "");
}

function formatHttpError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function clampTitle(value: string): string {
  return value.length <= 1800 ? value : `${value.slice(0, 1797)}...`;
}

/** Appends a paragraph to the page; resolves to the new block's id. */
async function appendToPage(parentId: string, token: string, content: string): Promise<string> {
  const response = await httpRequest(`https://api.notion.com/v1/blocks/${normalizeParentId(parentId)}/children`, {
    method: "PATCH",
    headers: notionHeaders(token),
    body: JSON.stringify({
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "text",
                text: {
                  content,
                },
              },
            ],
          },
        },
      ],
    }),
  });
  return readJsonId(response, (body) => (body.results as Array<{ id?: string }> | undefined)?.[0]?.id);
}

async function createInDatabase(
  parentId: string,
  token: string,
  content: string,
  tag: CaptureTag,
  listName: string,
): Promise<string> {
  const databaseId = normalizeParentId(parentId);
  const databaseResponse = await httpRequest(`https://api.notion.com/v1/databases/${databaseId}`, {
    method: "GET",
    headers: notionHeaders(token),
  });
  const databaseJson = (await databaseResponse.json()) as {
    properties?: Record<string, { type?: string }>;
  };

  const titleProperty = Object.entries(databaseJson.properties ?? {}).find(
    ([, property]) => property?.type === "title",
  );

  if (!titleProperty) {
    throw new Error("Notion database has no title property.");
  }

  const [titlePropertyName] = titleProperty;

  const response = await httpRequest("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: notionHeaders(token),
    body: JSON.stringify({
      parent: {
        database_id: databaseId,
      },
      properties: {
        [titlePropertyName]: {
          title: [
            {
              type: "text",
              text: {
                content: clampTitle(content),
              },
            },
          ],
        },
      },
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: `Tag: ${tag} | List: ${listName}`,
                },
              },
            ],
          },
        },
      ],
    }),
  });
  return readJsonId(response, (page) => page.id);
}

/** Where a capture landed in Notion: a paragraph block on a page, or a database page. */
export interface NotionCaptureRef {
  kind: "block" | "page";
  id: string;
}

export async function appendNotionCapture(input: {
  token: string;
  pageId: string;
  content: string;
  tag: CaptureTag;
  listName: string;
}): Promise<NotionCaptureRef> {
  const formattedContent = formatTaggedListMessage(input.content, input.tag, input.listName);

  try {
    return { kind: "block", id: await appendToPage(input.pageId, input.token, formattedContent) };
  } catch (pageError) {
    try {
      const id = await createInDatabase(
        input.pageId,
        input.token,
        formattedContent,
        input.tag,
        input.listName,
      );
      return { kind: "page", id };
    } catch (databaseError) {
      throw new Error(
        `Notion sync failed. Page append error: ${formatHttpError(pageError)}. Database create error: ${formatHttpError(databaseError)}`,
      );
    }
  }
}

export async function testNotionConnection(token: string, pageId: string): Promise<void> {
  try {
    await httpRequest(`https://api.notion.com/v1/blocks/${normalizeParentId(pageId)}`, {
      method: "GET",
      headers: notionHeaders(token),
    });
    return;
  } catch (pageError) {
    try {
      await httpRequest(`https://api.notion.com/v1/databases/${normalizeParentId(pageId)}`, {
        method: "GET",
        headers: notionHeaders(token),
      });
      return;
    } catch (databaseError) {
      throw new Error(
        `Could not access Notion parent as page or database. Page error: ${formatHttpError(pageError)}. Database error: ${formatHttpError(databaseError)}`,
      );
    }
  }
}
