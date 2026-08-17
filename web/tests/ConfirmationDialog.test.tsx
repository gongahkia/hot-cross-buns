import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmationDialog } from "@/components/ConfirmationDialog";

describe("ConfirmationDialog", () => {
  it("cancels safely before performing a destructive action", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn();
    const close = vi.fn();
    render(<ConfirmationDialog title="Delete task?" description="This can be recovered from Undo." confirmLabel="Delete task" destructive confirm={confirm} close={close} />);

    expect(screen.getByRole("dialog", { name: "Delete task?" })).toHaveAttribute("aria-describedby");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(confirm).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("runs the confirmed action and then closes", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    render(<ConfirmationDialog title="Delete event?" description="This can be recovered from Undo." confirmLabel="Delete event" destructive confirm={confirm} close={close} />);

    await user.click(screen.getByRole("button", { name: "Delete event" }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
