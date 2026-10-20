import { invoke } from "@tauri-apps/api/core";
import { describeSyncError } from "../lib/sync/syncErrors";
import { isMacOS } from "../lib/platform";

interface SyncErrorNoticeProps {
  /** The stored `last_sync_error`. */
  error: string;
  messageClassName?: string;
  buttonClassName?: string;
}

/**
 * A sync error in plain words, with the fix when there is one (Automation
 * permission for Reminders, Notes and Calendar). The raw error stays one
 * click away for troubleshooting.
 */
export default function SyncErrorNotice({ error, messageClassName = "", buttonClassName = "" }: SyncErrorNoticeProps) {
  const problem = describeSyncError(error);
  if (!problem) return null;

  return (
    <>
      <span className={messageClassName}>{problem.message}</span>
      {problem.kind === "permission" && isMacOS() ? (
        <button
          type="button"
          className={buttonClassName}
          onClick={() =>
            void invoke("open_automation_settings").catch((cause) =>
              console.error("Could not open Automation settings", cause),
            )
          }
        >
          Open Automation settings
        </button>
      ) : null}
      <details className="mt-1 opacity-70">
        <summary className="cursor-pointer select-none">Details</summary>
        <code className="block whitespace-pre-wrap break-words font-mono text-[10px]">{error}</code>
      </details>
    </>
  );
}
