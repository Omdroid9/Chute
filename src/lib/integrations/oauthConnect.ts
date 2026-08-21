import { httpRequest } from "../net/http";

export type ConnectProvider = "slack" | "discord" | "notion" | "google";

export interface ProviderConfigState {
  configured: boolean;
  missing: string[];
}

export type ProvidersConfigResponse = Record<ConnectProvider, ProviderConfigState>;

interface StartSessionResponse {
  sessionId: string;
  authorizeUrl: string;
  statusUrl: string;
}

interface PollSessionResponse {
  status: "pending" | "completed" | "failed";
  message?: string;
  settings?: Record<string, string>;
}

export async function startConnectSession(
  backendBaseUrl: string,
  provider: ConnectProvider,
): Promise<StartSessionResponse> {
  const baseUrl = backendBaseUrl.replace(/\/$/, "");
  // Starting the session is also the reachability check: no separate pre-flight
  // round-trip, so the browser opens the instant the session is ready. When the
  // bridge is warm this returns in ~0.3s; when Render has spun it down, retry
  // (the request wakes it) for ~100s rather than erroring on the cold start.
  const deadline = Date.now() + 100_000;
  for (;;) {
    try {
      const response = await httpRequest(`${baseUrl}/api/connect/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
        signal: timeoutSignal(30_000),
      });
      return (await response.json()) as StartSessionResponse;
    } catch {
      if (Date.now() >= deadline) {
        throw new Error(
          "Could not reach the connection service — it may still be waking up. Press Connect to try again.",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 4_000));
    }
  }
}

/** Abort a fetch after `ms` — caps a slow bridge request so it can't hang. */
function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

export async function pollConnectSession(
  statusUrl: string,
): Promise<PollSessionResponse> {
  const response = await httpRequest(statusUrl, {
    method: "GET",
    signal: timeoutSignal(15_000),
  });
  return (await response.json()) as PollSessionResponse;
}

export async function waitForConnectCompletion(
  statusUrl: string,
  timeoutMs = 180_000,
  intervalMs = 1_200,
): Promise<PollSessionResponse> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const state = await pollConnectSession(statusUrl);
      if (state.status === "completed" || state.status === "failed") {
        return state;
      }
    } catch {
      // A single dropped poll (slow socket, brief blip) shouldn't abort the
      // wait — keep polling until the browser sign-in lands or we time out.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return {
    status: "failed",
    message: "Timed out waiting for the browser sign-in. Press Connect to try again.",
  };
}

export async function getConnectProvidersConfig(
  backendBaseUrl: string,
): Promise<ProvidersConfigResponse> {
  const baseUrl = backendBaseUrl.replace(/\/$/, "");
  const response = await httpRequest(`${baseUrl}/api/connect/providers`, {
    method: "GET",
  });

  return (await response.json()) as ProvidersConfigResponse;
}
