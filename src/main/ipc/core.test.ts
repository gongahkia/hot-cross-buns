import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []), getFocusedWindow: vi.fn(() => undefined) },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() }
}));

import { payloadIsValid, registerCoreIpc } from "./core";
import { ipcMain } from "electron";

describe("core IPC task payload validation", () => {
  it("rejects unfinished actions instead of accepting a placeholder operation", () => {
    for (const [namespace, action] of [["search", "installModel"], ["tags", "merge"], ["duplicates", "cleanup"], ["agent", "listActions"], ["settings", "importIcs"]]) {
      expect(payloadIsValid(namespace, action, {})).toBe(false);
    }
    expect(payloadIsValid("settings", "recoveryAction", { action: "backupNow" })).toBe(true);
    expect(payloadIsValid("settings", "recoveryAction", { action: "resetMcpToken" })).toBe(false);
  });
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
  it("requires a bounded mutation id and a reviewed strategy for conflict recovery", () => {
    expect(payloadIsValid("diagnostics", "previewMutationResolution", { id: "mutation" })).toBe(true);
    expect(payloadIsValid("diagnostics", "resolveMutation", { id: "mutation", reviewId: "660e8400-e29b-41d4-a716-446655440000", strategy: "google" })).toBe(true);
    expect(payloadIsValid("diagnostics", "resolveMutation", { id: "mutation", strategy: "google" })).toBe(false);
    expect(payloadIsValid("diagnostics", "resolveMutation", { id: "mutation", reviewId: "invalid", strategy: "local" })).toBe(false);
    expect(payloadIsValid("diagnostics", "previewMutationResolution", { id: "mutation", accountId: "other" })).toBe(false);
  });
  it("routes reviewed recovery through GoogleSync and keeps Google-side recovery read-only", async () => {
    const googleSync = { onStatus: vi.fn(), previewMutationResolution: vi.fn(async () => ({ reviewId: "review" })), resolveMutation: vi.fn(async () => ({ cancelled: true })), scheduleAfterLocalMutation: vi.fn(async () => undefined) };
    const dispatch = vi.fn();
    registerCoreIpc({ ready: Promise.resolve(), core: { dispatch }, googleSync, googleOAuth: { isReconfiguring: () => false }, backups: {} } as never);
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "hcb:core:invoke")![1];
    expect(await handler({} as never, { namespace: "diagnostics", action: "previewMutationResolution", payload: { id: "mutation" } })).toMatchObject({ ok: true, data: { reviewId: "review" } });
    const payload = { id: "mutation", reviewId: "660e8400-e29b-41d4-a716-446655440000", strategy: "google" };
    expect(await handler({} as never, { namespace: "diagnostics", action: "resolveMutation", payload })).toMatchObject({ ok: true, data: { cancelled: true } });
    expect(googleSync.resolveMutation).toHaveBeenCalledWith(payload);
    expect(googleSync.scheduleAfterLocalMutation).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

});
