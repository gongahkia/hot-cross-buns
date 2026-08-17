import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "@/components/MarkdownEditor";

function EditorHarness({ initial = "", drive }: { readonly initial?: string; readonly drive?: React.ComponentProps<typeof MarkdownEditor>["drive"] }): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return <MarkdownEditor label="Notes" value={value} onChange={setValue} drive={drive} />;
}

describe("MarkdownEditor", () => {
  it("renders a formatted preview from the default Write editor", async () => {
    const user = userEvent.setup();
    render(<EditorHarness initial={"## Launch\n\n**Ready**"} />);

    expect(screen.getByRole("tab", { name: "Write" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Preview" }));

    expect(screen.getByRole("heading", { name: "Launch" })).toBeVisible();
    expect(screen.getByText("Ready").tagName).toBe("STRONG");
  });

  it("applies reference toolbar formatting around the selected text", async () => {
    const user = userEvent.setup();
    render(<EditorHarness initial="plain" />);
    const editor = screen.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(0, 5);
    await user.click(screen.getByRole("button", { name: "Bold" }));

    expect(editor).toHaveValue("**plain**");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(editor).toHaveValue("plain");
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(editor).toHaveValue("**plain**");
  });

  it("replaces a Slack-style colon query with a Unicode emoji", async () => {
    const user = userEvent.setup();
    render(<EditorHarness />);
    const editor = screen.getByRole("textbox", { name: "Notes" });

    await user.type(editor, ":smile");
    expect(screen.getByRole("listbox", { name: "Emoji suggestions" })).toBeVisible();
    await user.keyboard("{Enter}");

    expect(editor).not.toHaveValue(":smile");
    expect((editor as HTMLTextAreaElement).value).toMatch(/[^\u0000-\u007f]/);
  });

  it("inserts an HTTPS image from its image dialog", async () => {
    const user = userEvent.setup();
    render(<EditorHarness />);

    await user.click(within(screen.getByRole("toolbar", { name: "Notes formatting" })).getByRole("button", { name: "Insert image" }));
    await user.clear(screen.getByLabelText("Image description"));
    await user.type(screen.getByLabelText("Image description"), "Roadmap");
    await user.type(screen.getByLabelText("Image URL"), "https://example.com/roadmap.png");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Insert image$/i }));

    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue("![Roadmap](https://example.com/roadmap.png)");
  });

  it("inserts a permitted Google Drive image link", async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockResolvedValue([{ id: "image-1", name: "Plan.png", mimeType: "image/png", webContentLink: "https://drive.google.com/plan.png" }]);
    render(<EditorHarness drive={{ authorized: true, authorize: vi.fn().mockResolvedValue(undefined), search }} />);

    await user.click(screen.getByRole("button", { name: "Insert image" }));
    await user.type(screen.getByRole("textbox", { name: "Search Drive images" }), "plan");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: "Use image" }));

    expect(search).toHaveBeenCalledWith("plan");
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue("![Plan.png](https://drive.google.com/plan.png)");
  });
});
