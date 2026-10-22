import { cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSuggestionAccessibility } from "./suggestionAccessibility";

afterEach(cleanup);
describe("suggestion accessibility", () => {
  it("does not request an unmounted editor view when its menu is closed", () => {
    const getInput = vi.fn(() => { throw new Error("The editor is not mounted yet"); });
    function Harness() { useSuggestionAccessibility(getInput, "results", null, false); return null; }
    render(<Harness />);
    expect(getInput).not.toHaveBeenCalled();
  });
  it("connects the active option, reveals it, and clears the attributes on close", () => {
    function Harness({ visible }: { visible: boolean }) {
      const input = useRef<HTMLInputElement>(null);
      useSuggestionAccessibility(() => input.current, "results", "last-option", visible);
      return <><input ref={input} aria-label="Body" /><div id="results" role="listbox"><div id="last-option" role="option">Last</div></div></>;
    }
    const view = render(<Harness visible={false} />);
    const option = screen.getByRole("option"); option.scrollIntoView = vi.fn();
    view.rerender(<Harness visible />);
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-activedescendant", "last-option");
    expect(option.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    view.rerender(<Harness visible={false} />);
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-activedescendant");
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-controls");
  });
});
