import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview", () => {
  it("renders GFM checklist state without permitting a write", () => {
    render(<MarkdownPreview ariaLabel="Event description" body={"- [ ] Prepare agenda\n- [x] Send brief"} />);

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes.every((checkbox) => (checkbox as HTMLInputElement).disabled)).toBe(true);
  });
});
