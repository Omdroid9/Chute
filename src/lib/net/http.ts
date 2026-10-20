import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function request(input: string, init?: RequestInit): Promise<Response> {
  if (isTauriRuntime()) {
    return tauriFetch(input, init);
  }
  return fetch(input, init);
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 0 ? text : response.statusText;
  } catch {
    return response.statusText;
  }
}

export async function httpRequest(input: string, init?: RequestInit): Promise<Response> {
  const response = await request(input, init);
  if (!response.ok) {
    const body = await readErrorBody(response);
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 180)}`);
  }
  return response;
}

export async function httpPostJson(
  url: string,
  payload: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  return httpRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(payload),
  });
}

/**
 * Read an id out of a JSON response without ever throwing. A send that already
 * succeeded must stay successful even if its response can't be parsed;
 * otherwise the retry would post the capture a second time.
 */
export async function readJsonId(
  response: Response,
  pick: (body: Record<string, unknown>) => unknown,
): Promise<string> {
  try {
    const value = pick((await response.json()) as Record<string, unknown>);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}
