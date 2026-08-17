import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SyncDialog } from "@/components/SyncDialog";

describe("SyncDialog", () => {
  it("uses the loader as the only visible synchronization label and progress indicator", () => {
    render(<SyncDialog
      progress={{
        active: true,
        cancellable: true,
        phase: "calendar-events",
        detail: "Synchronizing calendar 4 of 9",
        completed: 4,
        total: 9,
        pagesSaved: 2,
        recordsSaved: 24
      }}
      cancel={vi.fn()}
      close={vi.fn()}
    />);

    expect(screen.getByRole("dialog", { name: "Synchronizing" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Synchronizing");
    expect(screen.queryByText("Google workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("4 of 9 resources")).not.toBeInTheDocument();
  });
});
