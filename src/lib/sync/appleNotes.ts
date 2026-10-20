import { invoke } from "@tauri-apps/api/core";

export interface CreateAppleNoteInput {
  title: string;
  body: string;
  folder?: string;
}

/**
 * Create a note in the macOS Notes app. This runs entirely inside the app's
 * native (Rust) layer via AppleScript. No external bridge or server is required.
 * On non-macOS platforms the underlying command returns an error.
 * Resolves to the new note's id, so Chute can find the note again.
 */
export async function createAppleNote(input: CreateAppleNoteInput): Promise<string> {
  return invoke<string>("create_apple_note", {
    folder: input.folder?.trim() || "Chute",
    title: input.title,
    body: input.body,
  });
}

/** Verify Apple Notes automation works by creating a throwaway test note. */
export async function testAppleNotes(folder?: string): Promise<void> {
  await createAppleNote({
    folder,
    title: "Chute test note",
    body: "If you can see this in Apple Notes, Chute is connected.",
  });
}
