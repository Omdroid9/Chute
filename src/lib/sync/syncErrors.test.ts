import { describe, expect, it } from "vitest";
import { describeSyncError } from "./syncErrors";

describe("describeSyncError", () => {
  it("has nothing to say about no error", () => {
    expect(describeSyncError(null)).toBeNull();
    expect(describeSyncError("  ")).toBeNull();
  });

  it("explains a missing Automation permission in plain words", () => {
    expect(
      describeSyncError("Apple Calendar: execution error: Not authorized to send Apple events to Calendar. (-1743)"),
    ).toEqual({ kind: "permission", app: "Calendar", message: "Chute needs permission to use Calendar" });
  });

  it("asks to reconnect after an auth failure", () => {
    expect(describeSyncError("Google Tasks: HTTP 401: invalid credentials")).toMatchObject({
      kind: "reconnect",
      app: "Google Tasks",
    });
  });

  it("reads only the first of several errors", () => {
    expect(describeSyncError("Notion: request timed out | Slack: HTTP 500")).toMatchObject({
      kind: "offline",
      app: "Notion",
    });
  });

  it("keeps an unknown error short", () => {
    const problem = describeSyncError(`Slack: HTTP 500: ${"x".repeat(200)}`);
    expect(problem?.kind).toBe("other");
    expect(problem!.message.length).toBeLessThanOrEqual(90);
  });

  it("says when the original item is gone", () => {
    expect(describeSyncError("Apple Calendar: Couldn't find the original event in Calendar.")).toEqual({
      kind: "missing",
      app: "Calendar",
      message: "Couldn't find the original in Calendar",
    });
    expect(describeSyncError("Reminders: Can't get reminder id \"x\". (-1728)")?.kind).toBe("missing");
  });
});
