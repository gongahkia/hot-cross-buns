import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []), getFocusedWindow: vi.fn(() => undefined) },
  dialog: { showOpenDialog: vi.fn() },
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

  it("only accepts a selected-account identifier for a native Drive upload", () => {
    expect(payloadIsValid("google", "pickAndUploadDriveFile", { accountId: "google-account" })).toBe(true);
    expect(payloadIsValid("google", "pickAndUploadDriveFile", { filePath: "/private/file" })).toBe(false);
  });

  it("requires explicit confirmation and bounded scopes when reconfiguring Google access", () => {
    expect(payloadIsValid("google", "reconfigureOptionalAccess", {
      accountId: "google-account",
      confirmation: "RECONFIGURE_OPTIONAL_ACCESS",
      requestedServices: ["drive", "gmail"]
    })).toBe(true);
    expect(payloadIsValid("google", "reconfigureOptionalAccess", {
      accountId: "google-account",
      confirmation: "RECONFIGURE_OPTIONAL_ACCESS",
      requestedServices: ["not-a-service"]
    })).toBe(false);
    expect(payloadIsValid("google", "reconfigureOptionalAccess", {
      accountId: "google-account",
      requestedServices: []
    })).toBe(false);
  });

  it("only accepts a reviewed plan for a Smart Schedule apply", () => {
    expect(payloadIsValid("calendar", "smartReschedule", {
      apply: false,
      date: "2026-10-01",
      calendarId: "primary",
      workingHours: { startMinutes: 540, endMinutes: 1020 }
    })).toBe(true);
    expect(payloadIsValid("calendar", "smartReschedule", {
      apply: true,
      planId: "660e8400-e29b-41d4-a716-446655440000"
    })).toBe(true);
    expect(payloadIsValid("calendar", "smartReschedule", {
      apply: true,
      date: "2026-10-01",
      calendarId: "primary"
    })).toBe(false);
  });
});
