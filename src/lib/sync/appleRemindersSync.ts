import { invoke } from "@tauri-apps/api/core";

export interface CreateAppleReminderInput {
  list?: string;
  title: string;
  body: string;
  dueDate?: string | null;
}

/**
 * Create a reminder in macOS Reminders.app via the native Rust layer.
 * No external bridge or server required. On non-macOS the underlying
 * command returns an error. Resolves to the new reminder's id.
 */
export async function createAppleReminder(input: CreateAppleReminderInput): Promise<string> {
  return invoke<string>("create_apple_reminder", {
    list: input.list?.trim() || "Chute",
    title: input.title,
    body: input.body,
    dueDate: input.dueDate ?? null,
  });
}

/** Add a line to the notes of a reminder Chute created earlier. */
export async function appendToAppleReminder(id: string, text: string): Promise<void> {
  await invoke("append_to_reminder", { id, text });
}

/** Mark a reminder done in Reminders, or not done again. */
export async function setAppleReminderCompleted(id: string, completed: boolean): Promise<void> {
  await invoke("set_reminder_completed", { id, completed });
}

/** Move a reminder's due date to `due` (a local ISO datetime); it's no longer done. */
export async function snoozeAppleReminder(id: string, due: string): Promise<void> {
  await invoke("snooze_reminder", { id, due });
}

/** Verify Reminders automation works by creating a throwaway test reminder. */
export async function testAppleReminders(list?: string): Promise<void> {
  await createAppleReminder({
    list,
    title: "Chute test reminder",
    body: "If you can see this in Reminders, Chute is connected.",
  });
}
