import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import RichMarkdownEditor from "./RichMarkdownEditor";

afterEach(cleanup);

describe("shared rich Markdown editor", () => {
  it("does not normalize or save an untouched document, including source switches", async () => {
    const onValueChange = vi.fn();
    render(<RichMarkdownEditor aria-label="Body" value={"# Heading\r\n\r\n*  Irregular spacing\r\n"} onValueChange={onValueChange} />);
    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.getByRole("textbox", { name: "Body" })).toHaveValue("# Heading\r\n\r\n*  Irregular spacing\r\n".replace(/\r\n/g, "\n"));
    await userEvent.click(screen.getByRole("button", { name: "Visual" }));
    expect(onValueChange).not.toHaveBeenCalled();
  });
  it("reflects an external document replacement without emitting a write", async () => {
    const onValueChange = vi.fn();
    const view = render(<RichMarkdownEditor aria-label="Body" value="Original" onValueChange={onValueChange} />);
    view.rerender(<RichMarkdownEditor aria-label="Body" value="## Replacement" onValueChange={onValueChange} />);
    await screen.findByRole("heading", { name: "Replacement", level: 2 });
    expect(onValueChange).not.toHaveBeenCalled();
  });
  it("renders simple imported HTML visually without rewriting it on open", () => {
    const onValueChange = vi.fn();
    render(<RichMarkdownEditor aria-label="Body" value="<p>Imported <strong>HTML</strong> body</p>" onValueChange={onValueChange} />);
    expect(screen.getByText("HTML", { selector: "strong" })).toBeInTheDocument();
    expect(onValueChange).not.toHaveBeenCalled();
  });
  it("edits source without losing syntax and renders it when switching back", async () => {
    function Harness() { const [value, setValue] = useState("Original"); return <RichMarkdownEditor aria-label="Body" value={value} onValueChange={setValue} />; }
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Source" }));
    const source = screen.getByRole("textbox", { name: "Body" });
    await user.clear(source); await user.type(source, "## Changed");
    await user.click(screen.getByRole("button", { name: "Visual" }));
    expect(screen.getByRole("heading", { name: "Changed", level: 2 })).toBeInTheDocument();
  });
  it("disables rich editing and all mutation controls while saving", async () => {
    render(<RichMarkdownEditor aria-label="Body" value="Original" disabled onValueChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Body" })).toHaveAttribute("contenteditable", "false"));
    for (const button of within(screen.getByRole("toolbar", { name: "Body formatting" })).getAllByRole("button")) expect(button).toBeDisabled();
    expect(screen.queryByRole("button", { name: "HCB item" })).not.toBeInTheDocument();
  });
  it("does not create an undo step for a mode switch with no edits", async () => {
    render(<RichMarkdownEditor aria-label="Body" value="Original" onValueChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Source" }));
    await userEvent.click(screen.getByRole("button", { name: "Visual" }));
    expect(screen.getByRole("button", { name: "Undo text edit" })).toBeDisabled();
  });
  it("starts a fresh undo history after external document replacement", async () => {
    const onValueChange = vi.fn();
    const view = render(<RichMarkdownEditor aria-label="Body" value="Original" onValueChange={onValueChange} />);
    view.rerender(<RichMarkdownEditor aria-label="Body" value="External replacement" onValueChange={onValueChange} />);
    await screen.findByText("External replacement");
    expect(screen.getByRole("button", { name: "Undo text edit" })).toBeDisabled();
  });

  it("does not let any rich keymap split a block on a composing Enter", () => {
    const onValueChange = vi.fn();
    render(<RichMarkdownEditor aria-label="Body" value="Original" onValueChange={onValueChange} />);
    const input = screen.getByRole("textbox", { name: "Body" });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229, isComposing: true });
    expect(input.querySelectorAll("p")).toHaveLength(1);
    expect(input).toHaveTextContent("Original");
    expect(onValueChange).not.toHaveBeenCalled();
  });

});
