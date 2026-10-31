import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CalendarSyncStatus } from "./CalendarSyncStatus";

afterEach(cleanup);

it("distinguishes date loading and failures from cloud delivery and offers the matching recovery", () => {
  const retry = vi.fn();
  const props = { loading: true, onRetry: retry, sync: { state: "pending", pendingMutationCount: 2, offline: false, stale: false }, offline: false, stale: false, hasRemote: true };
  const view = render(<CalendarSyncStatus {...props} />);
  expect(screen.getByRole("status", { name: "Calendar status" })).toHaveTextContent("Loading calendar dates");
  view.rerender(<CalendarSyncStatus {...props} loading={false} error="Unavailable" />);
  expect(screen.getByRole("status", { name: "Calendar status" })).toHaveTextContent("view may be incomplete");
  fireEvent.click(screen.getByRole("button", { name: "Retry loading dates" }));
  expect(retry).toHaveBeenCalledOnce();
  view.rerender(<CalendarSyncStatus {...props} loading={false} offline />);
  expect(screen.getByRole("status", { name: "Calendar status" })).toHaveTextContent("Offline · showing cached calendar · 2 changes waiting");
  view.rerender(<CalendarSyncStatus {...props} loading={false} />);
  expect(screen.getByRole("status", { name: "Calendar status" })).toHaveTextContent("2 changes saved locally");
  view.rerender(<CalendarSyncStatus {...props} loading={false} sync={{ ...props.sync, failedMutationCount: 1 }} />);
  expect(screen.getByRole("status", { name: "Calendar status" })).toHaveTextContent("not reached Google");
  const open = vi.fn();
  window.addEventListener("hcb:open-diagnostics", open);
  fireEvent.click(screen.getByRole("button", { name: /^sync$/ }));
  expect(open).toHaveBeenCalledOnce();
  window.removeEventListener("hcb:open-diagnostics", open);
});


it("links only the word sync in the last completed Google sync timestamp", () => {
  render(<CalendarSyncStatus loading={false} onRetry={() => {}} sync={{ state: "idle", pendingMutationCount: 0, lastCompletedAt: "2026-10-31T05:00:00Z", offline: false, stale: false }} offline={false} stale={false} hasRemote />);
  expect(screen.getByRole("status", { name: "Calendar status" })).toHaveTextContent("Last Google sync:");
  expect(screen.getByRole("button", { name: /^sync$/ })).toBeInTheDocument();
  expect(screen.queryByText("Sync details")).not.toBeInTheDocument();
});
