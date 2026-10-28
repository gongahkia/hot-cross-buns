import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserStorageControls } from "./BrowserStorageControls";

const originalBridge = window.hcb;
afterEach(() => { cleanup(); Object.defineProperty(window, "hcb", { configurable: true, value: originalBridge }); });
function setup() {
  const workspace = {
    storageInfo: vi.fn().mockResolvedValue({ ok: true, data: { available: true, usage: 1024 * 1024, quota: 1024 * 1024 * 100, persisted: false } }),
    requestPersistence: vi.fn().mockResolvedValue({ ok: true, data: { available: true, persisted: false, granted: false } }),
    exportArchive: vi.fn().mockResolvedValue({ ok: true, data: { exported: true } }),
    stageImport: vi.fn().mockResolvedValue({ ok: true, data: { reviewId: "review-1", summary: { tasks: 12, notes: 4 }, warnings: ["Google must be reconnected after restoring."] } }),
    confirmImport: vi.fn().mockResolvedValue({ ok: false, error: { message: "Workspace changed since review. Review the archive again." } })
  };
  Object.defineProperty(window, "hcb", { configurable: true, value: { workspace } });
  render(<BrowserStorageControls />);
  return workspace;
}

describe("browser workspace recovery controls", () => {
  it("requires reviewing counts and typing confirmation before replacement; failure preserves the review", async () => {
    const api = setup(); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Import workspace…" }));
    expect(await screen.findByRole("dialog", { name: "Review workspace replacement" })).toBeVisible();
    expect(screen.getByText("12")).toBeVisible();
    expect(screen.getByRole("button", { name: "Replace workspace" })).toBeDisabled();
    expect(api.confirmImport).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox", { name: "Confirm workspace replacement" }), "REPLACE");
    await user.click(screen.getByRole("button", { name: "Replace workspace" }));
    expect(api.confirmImport).toHaveBeenCalledWith({ reviewId: "review-1", confirmation: "REPLACE_WORKSPACE" });
    expect(await screen.findAllByText("Workspace changed since review. Review the archive again.")).toHaveLength(2);
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("focuses confirmation, cancels with Escape, and restores focus without replacing", async () => {
    const api = setup(); const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Import workspace…" });
    await user.click(trigger);
    expect(screen.getByRole("textbox", { name: "Confirm workspace replacement" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(api.confirmImport).not.toHaveBeenCalled();
  });

  it("does not create an import review when file selection is cancelled", async () => {
    const api = setup(); api.stageImport.mockResolvedValueOnce({ ok: true, data: { cancelled: true } });
    await userEvent.click(screen.getByRole("button", { name: "Import workspace…" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.confirmImport).not.toHaveBeenCalled();
  });

  it("reports persistence refusal honestly without claiming protection", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Request persistent storage" }));
    expect(await screen.findByText(/did not grant persistent storage/)).toBeVisible();
  });

  it("only reports an archive download after the bridge succeeds", async () => {
    const api = setup(); api.exportArchive.mockResolvedValueOnce({ ok: false, error: { message: "Database export failed." } });
    await userEvent.click(screen.getByRole("button", { name: "Export workspace" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Database export failed.");
    expect(screen.queryByText(/Workspace archive downloaded/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Export workspace" }));
    await waitFor(() => expect(screen.getByText(/Workspace archive downloaded/)).toBeVisible());
  });
});
