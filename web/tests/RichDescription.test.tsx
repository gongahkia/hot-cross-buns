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
});
