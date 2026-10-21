import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownPreview, hasRenderableMixedMarkup, markdownFromMixedMarkup } from "./MarkdownPreview";

describe("MarkdownPreview", () => {
  it("keeps plain list previews lightweight while retaining rich formatting", () => {
    const view = render(<MarkdownPreview ariaLabel="List preview" body="A plain planning sentence." variant="summary" />);
    expect(screen.getByLabelText("List preview")).toHaveTextContent("A plain planning sentence.");
    view.rerender(<MarkdownPreview ariaLabel="List preview" body="**Planning** with [context](https://example.com)" variant="summary" />);
    expect(screen.getByRole("link", { name: "context" })).toHaveAttribute("href", "https://example.com");
    expect(screen.getByText("Planning").tagName).toBe("STRONG");
  });

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
  it("renders complex stored tables with spans and rich cells through an inert allowlist", () => {
    const view = render(<MarkdownPreview body={'Before\n\n<table><tbody><tr><th colspan="2" onclick="alert(1)"><p>Heading</p></th></tr><tr><td rowspan="2"><p>First</p><ul><li>Nested</li></ul><script>alert(1)</script><iframe src="https://example.com"></iframe></td><td><a href="javascript:alert(1)">Unsafe</a></td></tr><tr><td>Last</td></tr></tbody></table>\n\nAfter'} />);
    expect(screen.getByRole("columnheader", { name: "Heading" })).toHaveAttribute("colspan", "2");
    expect(screen.getByRole("cell", { name: "First Nested" })).toHaveAttribute("rowspan", "2");
    expect(screen.getByText("Before")).toBeVisible(); expect(screen.getByText("After")).toBeVisible();
    expect(screen.getByText("Unsafe")).not.toHaveAttribute("href");
    expect(view.container.querySelector("script, iframe, [onclick]")).toBeNull();
  });
  it("does not interpret a table inside a code fence as HTML", () => {
    const html = '<table><tr><td><strong>literal</strong></td></tr></table>';
    const view = render(<MarkdownPreview body={'```html\n' + html + '\n```'} />);
    expect(view.container.querySelector("table")).toBeNull();
    expect(view.container.querySelector("pre code")).toHaveTextContent(html);
  });

  it("preserves inline code and unfinished fenced HTML during mixed-markup conversion", () => {
    const body = '<p>Real <strong>bold</strong></p>\n\n`<em>literal</em>`\n\n~~~~html\n<p>unfinished example</p>';
    const converted = markdownFromMixedMarkup(body);
    expect(converted).toContain("**bold**");
    expect(converted).toContain("`<em>literal</em>`");
    expect(converted).toContain("~~~~html\n<p>unfinished example</p>");
  });

});
