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

/** Verify Reminders automation works by creating a throwaway test reminder. */
export async function testAppleReminders(list?: string): Promise<void> {
  await createAppleReminder({
    list,
    title: "Chute test reminder",
    body: "If you can see this in Reminders, Chute is connected.",
  });
}
