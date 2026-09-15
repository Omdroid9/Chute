import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Frontend bridge for on-device voice capture. The Rust side does the work
// (mic -> whisper.cpp -> text); here we invoke start/stop + model management
// and subscribe to the `chute://voice-*` events the backend emits. The
// transcript is dropped into the capture box exactly like typed text.

export type VoiceState = "idle" | "recording" | "transcribing";
/** UI-facing model state; the backend only reports ready / needs-model. */
export type VoiceModelState = "ready" | "needs-model" | "downloading";

export async function getVoiceModelStatus(): Promise<VoiceModelState> {
  try {
    const status = await invoke<string>("voice_model_status");
    return status === "ready" ? "ready" : "needs-model";
  } catch {
    return "needs-model";
  }
}

export function startVoice(): Promise<void> {
  return invoke("voice_start");
}

export function stopVoice(): Promise<void> {
  return invoke("voice_stop");
}

export function downloadVoiceModel(): Promise<void> {
  return invoke("voice_download_model");
}

export interface VoiceHandlers {
  onState?: (state: VoiceState) => void;
  onTranscript?: (text: string) => void;
  onError?: (message: string) => void;
  onModelProgress?: (downloaded: number, total: number) => void;
  onModelDone?: () => void;
  onModelError?: (message: string) => void;
}

/** Subscribe to all voice events. Returns a single unlisten that detaches all. */
export async function subscribeVoice(handlers: VoiceHandlers): Promise<UnlistenFn> {
  const unlisteners: UnlistenFn[] = [];

  unlisteners.push(
    await listen<{ state: VoiceState }>("chute://voice-state", (event) =>
      handlers.onState?.(event.payload.state),
    ),
  );
  unlisteners.push(
    await listen<{ text: string }>("chute://voice-transcript", (event) =>
      handlers.onTranscript?.(event.payload.text),
    ),
  );
  unlisteners.push(
    await listen<{ message: string }>("chute://voice-error", (event) =>
      handlers.onError?.(event.payload.message),
    ),
  );
  unlisteners.push(
    await listen<{ downloaded: number; total: number }>(
      "chute://voice-model-progress",
      (event) => handlers.onModelProgress?.(event.payload.downloaded, event.payload.total),
    ),
  );
  unlisteners.push(
    await listen("chute://voice-model-done", () => handlers.onModelDone?.()),
  );
  unlisteners.push(
    await listen<{ message: string }>("chute://voice-model-error", (event) =>
      handlers.onModelError?.(event.payload.message),
    ),
  );

  return () => {
    for (const unlisten of unlisteners) {
      unlisten();
    }
  };
}

/** Percent 0-100 for a download progress pair, guarding a zero/unknown total. */
export function downloadPercent(downloaded: number, total: number): number {
  if (!total || total <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((downloaded / total) * 100));
}
