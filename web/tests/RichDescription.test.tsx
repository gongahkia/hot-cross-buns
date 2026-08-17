import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RichDescription } from "@/components/RichDescription";

describe("RichDescription", () => {
  it("renders safe HTML links instead of exposing source markup", () => {
    render(<RichDescription value={'<p>Open <a href="https://example.com">the guide</a>.</p>'} />);

    expect(screen.getByRole("link", { name: "the guide" })).toHaveAttribute("href", "https://example.com/");
    expect(screen.queryByText(/<a href/i)).not.toBeInTheDocument();
  });

  it("renders Markdown structure and rejects unsafe link protocols", () => {
    render(<RichDescription value={'## Next steps\n\n- **Read** [the guide](https://example.com)\n- [do not run](javascript:alert(1))'} />);

    expect(screen.getByRole("heading", { name: "Next steps" })).toBeVisible();
    expect(screen.getByRole("link", { name: "the guide" })).toHaveAttribute("href", "https://example.com/");
    expect(screen.queryByRole("link", { name: "do not run" })).not.toBeInTheDocument();
  });

  it("renders task lists, tables, emoji shortcodes, and safe HTML images", () => {
    render(<RichDescription value={'- [x] Finished\n- [ ] Remaining\n\n| Name | State |\n| --- | --- |\n| Build | Ready |\n\n:rocket:\n\n<img src="https://example.com/cover.png" alt="Cover">'} />);

    expect(screen.getByRole("checkbox", { name: "Completed checklist item" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Incomplete checklist item" })).not.toBeChecked();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeVisible();
    expect(screen.getByText("🚀")).toBeVisible();
    expect(screen.getByRole("img", { name: "Cover" })).toHaveAttribute("src", "https://example.com/cover.png");
  });

  it("removes unsafe raw HTML images and scripts", () => {
    const { container } = render(<RichDescription value={'<script>alert("no")</script><img src="javascript:alert(1)" alt="unsafe">'} />);

    expect(screen.queryByRole("img", { name: "unsafe" })).not.toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
  });
});
