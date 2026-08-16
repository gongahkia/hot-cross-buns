import { useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ModalDialog } from "@/components/ModalDialog";

function ModalHarness(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open editor</button>
      {open && <ModalDialog className="test-dialog" labelledBy="test-dialog-heading" initialFocusRef={inputRef} onClose={() => setOpen(false)}>
        <h2 id="test-dialog-heading">Editor</h2>
        <input ref={inputRef} aria-label="Editor title" />
        <button type="button" onClick={() => setOpen(false)}>Close editor</button>
      </ModalDialog>}
    </>
  );
}

describe("ModalDialog", () => {
  it("moves focus inside, wraps Tab, closes with Escape, and restores the opener", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    const opener = screen.getByRole("button", { name: "Open editor" });
    await user.click(opener);
    expect(screen.getByRole("dialog", { name: "Editor" })).toBeVisible();
    expect(screen.getByLabelText("Editor title")).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Close editor" })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("Editor title")).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Editor" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
