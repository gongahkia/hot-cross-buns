import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: vi.fn() }
}));

import { payloadIsValid } from "./core";

describe("core IPC task payload validation", () => {
  it("accepts the null duration emitted by a new task editor", () => {
    expect(payloadIsValid("tasks", "create", {
      durationMinutes: null,
      listId: "hcb-smoke-tasks",
      title: "Quick Add task"
    })).toBe(true);
  });
});
