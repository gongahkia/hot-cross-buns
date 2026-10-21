import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncResolutionControl } from "./SyncResolutionControl";

const originalHcb = Object.getOwnPropertyDescriptor(window, "hcb")!;
afterEach(() => { cleanup(); Object.defineProperty(window, "hcb", originalHcb); });
function fixture(canKeepLocal = true) {
  const resolveMutation = vi.fn(async () => ({ ok: true, data: {} }));
  Object.defineProperty(window, "hcb", { configurable: true, value: { diagnostics: {
    previewMutationResolution: vi.fn(async () => ({ ok: true, data: {
      id: "mutation", reviewId: "review", affectedCount: 2, canKeepLocal,
      message: "Review both changes", items: [{ id: "task", kind: "task", title: "Draft", local: { title: "Local title", notes: "<script>inert</script>" }, google: { title: "Google title", notes: "" } }]
    } })), resolveMutation
  } } });
  return { resolveMutation };
}
describe("sync resolution review", () => {
  it("shows both versions before sending a reviewed decision for the whole chain", async () => {
    const { resolveMutation } = fixture(); const onResolved = vi.fn();
    render(<SyncResolutionControl id="mutation" disabled={false} onResolved={onResolved} />);
    await userEvent.click(screen.getByRole("button", { name: "Compare and resolve" }));
    expect(await screen.findByText("Local title")).toBeVisible();
    expect(screen.getByText("Google title")).toBeVisible();
    expect(screen.getByText("<script>inert</script>")).toBeVisible();
    expect(document.querySelector("script")).toBeNull();
    expect(resolveMutation).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Use Google and discard 2 local changes" }));
    expect(resolveMutation).toHaveBeenCalledWith({ id: "mutation", reviewId: "review", strategy: "google" });
    expect(onResolved).toHaveBeenCalledOnce();
  });
  it("blocks an unsafe local retry and keeps the comparison when recovery fails", async () => {
    const { resolveMutation } = fixture(false);
    resolveMutation.mockResolvedValue({ ok: false, error: { message: "Google changed. Compare again." } } as never);
    render(<SyncResolutionControl id="mutation" disabled={false} onResolved={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Compare and resolve" }));
    expect(await screen.findByRole("button", { name: "Keep local and retry 2 changes" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Use Google and discard 2 local changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Google changed");
    expect(screen.getByText("Local title")).toBeVisible();
  });
});
