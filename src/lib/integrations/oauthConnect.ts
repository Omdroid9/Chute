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

/** Thrown when the caller aborts a connect — e.g. the user hits Cancel, or
 * closes the browser and backs out. Callers treat this as a quiet stop, not an
 * error, so the UI can reset without a scary "Connect failed" message. */
export class ConnectCancelledError extends Error {
  constructor() {
    super("Connection cancelled.");
    this.name = "ConnectCancelledError";
  }
}

/** True for a cancel — our own marker or an aborted in-flight fetch. */
export function isConnectCancelled(error: unknown): boolean {
  return (
    error instanceof ConnectCancelledError ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

export async function startConnectSession(
  backendBaseUrl: string,
  provider: ConnectProvider,
  signal?: AbortSignal,
): Promise<StartSessionResponse> {
  const baseUrl = backendBaseUrl.replace(/\/$/, "");
  // Starting the session is also the reachability check: no separate pre-flight
  // round-trip, so the browser opens the instant the session is ready. When the
  // bridge is warm this returns in ~0.3s; when Render has spun it down, retry
  // (the request wakes it) for ~100s rather than erroring on the cold start.
  // `signal` lets the user cancel out of that wait immediately.
  const deadline = Date.now() + 100_000;
  for (;;) {
    if (signal?.aborted) throw new ConnectCancelledError();
    try {
      const response = await httpRequest(`${baseUrl}/api/connect/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
        signal: anySignal(timeoutSignal(30_000), signal),
      });
      return (await response.json()) as StartSessionResponse;
    } catch {
      if (signal?.aborted) throw new ConnectCancelledError();
      if (Date.now() >= deadline) {
        throw new Error(
          "Could not reach the connection service — it may still be waking up. Press Connect to try again.",
        );
      }
      await delay(4_000, signal);
    }
  }
}

/** Abort a fetch after `ms` — caps a slow bridge request so it can't hang. */
function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** One signal that aborts as soon as any of its inputs does (timeout OR cancel). */
function anySignal(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

/** Sleep `ms`, resolving early if `signal` aborts — so Cancel takes effect now,
 * not after the current back-off elapses. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function pollConnectSession(
  statusUrl: string,
  signal?: AbortSignal,
): Promise<PollSessionResponse> {
  const response = await httpRequest(statusUrl, {
    method: "GET",
    signal: anySignal(timeoutSignal(15_000), signal),
  });
  return (await response.json()) as PollSessionResponse;
}

export async function waitForConnectCompletion(
  statusUrl: string,
  timeoutMs = 180_000,
  intervalMs = 1_200,
  signal?: AbortSignal,
): Promise<PollSessionResponse> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) throw new ConnectCancelledError();
    try {
      const state = await pollConnectSession(statusUrl, signal);
      if (state.status === "completed" || state.status === "failed") {
        return state;
      }
    } catch {
      if (signal?.aborted) throw new ConnectCancelledError();
      // A single dropped poll (slow socket, brief blip) shouldn't abort the
      // wait — keep polling until the browser sign-in lands or we time out.
    }
    await delay(intervalMs, signal);
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
