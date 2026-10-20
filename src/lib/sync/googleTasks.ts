import { httpPostJson, httpRequest, readJsonId } from "../net/http";

export interface GoogleTaskList {
  id: string;
  title: string;
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

function toRfc3339Local(input: string): string {
  const date = new Date(input);
  return date.toISOString();
}

export async function listGoogleTaskLists(accessToken: string): Promise<GoogleTaskList[]> {
  const response = await httpRequest("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
    method: "GET",
    headers: authHeaders(accessToken),
  });
  const payload = (await response.json()) as { items?: GoogleTaskList[] };
  return payload.items ?? [];
}

export async function createGoogleTask(input: {
  accessToken: string;
  listId: string;
  title: string;
  notes?: string;
  due?: string;
}): Promise<string> {
  const response = await httpPostJson(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(input.listId)}/tasks`,
    {
      title: input.title,
      notes: input.notes ?? "",
      due: input.due ? toRfc3339Local(input.due) : undefined,
    },
    authHeaders(input.accessToken),
  );
  // The new task's id, so Chute can update it later.
  return readJsonId(response, (task) => task.id);
}

export async function refreshGoogleAccessToken(
  backendBaseUrl: string,
  refreshToken: string,
): Promise<string> {
  const response = await httpPostJson(
    `${backendBaseUrl.replace(/\/$/, "")}/api/google/refresh-token`,
    {
      refreshToken,
    },
  );

  const payload = (await response.json()) as { accessToken?: string };
  if (!payload.accessToken) {
    throw new Error("OAuth backend did not return refreshed Google access token.");
  }

  return payload.accessToken;
}

export async function testGoogleTasksConnection(accessToken: string, listId: string): Promise<void> {
  await httpRequest(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}`, {
    method: "GET",
    headers: authHeaders(accessToken),
  });
}
