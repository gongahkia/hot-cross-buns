import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownPreview, hasRenderableMixedMarkup, markdownFromMixedMarkup } from "./MarkdownPreview";

describe("MarkdownPreview", () => {
  it("renders GFM checklist state without permitting a write", () => {
    render(<MarkdownPreview ariaLabel="Event description" body={"- [ ] Prepare agenda\n- [x] Send brief"} />);

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes.every((checkbox) => (checkbox as HTMLInputElement).disabled)).toBe(true);
  });

  it("renders HTML and Markdown together without exposing HTML source", () => {
    render(
      <MarkdownPreview
        ariaLabel="Mixed event description"
        body={'<p><strong>Open</strong> the <a href="https://www.crowdtask.gov.sg/dashboard">Crowdtask Dashboard</a>.</p>\n\n- [x] Complete the survey'}
      />
    );

    const preview = within(screen.getByRole("region", { name: "Mixed event description" }));
    expect(preview.getByText("Open")).toBeInTheDocument();
    expect(preview.getByRole("link", { name: "Crowdtask Dashboard" })).toHaveAttribute("href", "https://www.crowdtask.gov.sg/dashboard");
    expect(preview.getByRole("checkbox")).toBeChecked();
    expect(preview.queryByText(/<p>/)).not.toBeInTheDocument();
  });

  it("treats whitespace-only HTML descriptions as empty", () => {
    expect(hasRenderableMixedMarkup("<p>&nbsp;</p><br>\n")).toBe(false);
  });

  it("does not preserve raw anchor tags from malformed provider HTML", () => {
    const description = '<p>[<a href="https://www.crowdtask.gov.sg/dashboard">Crowdtask Dashboard</a>](<a>https://www.crowdtask.gov.sg/dashboard</a>)</p>';

    expect(markdownFromMixedMarkup(description)).not.toContain("<a");
  });

  it("renders an ID-stable HCB reference as an internal, clickable item", () => {
    const opened: Array<{ id: string; kind: string }> = [];
    const onOpen = (event: Event): void => { opened.push((event as CustomEvent<{ id: string; kind: string }>).detail); };
    window.addEventListener("hcb:open-entity", onOpen);
    render(<MarkdownPreview body="See [[hcb:task:task-1|Plan launch]]" plannerLinkTargets={[{ id: "task-1", kind: "task", title: "Plan launch" }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Plan launch" }));
    expect(opened).toEqual([{ id: "task-1", kind: "task" }]);
    window.removeEventListener("hcb:open-entity", onOpen);
  });
});
