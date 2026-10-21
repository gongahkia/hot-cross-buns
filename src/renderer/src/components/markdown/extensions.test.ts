import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { markdownExtensions, safeEditorUrl } from "./extensions";

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); });
function open(markdown: string) {
  editor = new Editor({ extensions: markdownExtensions(), content: markdown, contentType: "markdown" });
  return editor;
}

describe("shared Markdown document schema", () => {
  it("round trips formatted blocks, nested lists, checks, tables and code languages", () => {
    const e = open("# Heading\n\n**Bold** *italic* ~~strike~~ `code`\n\n- Parent\n  - Child\n\n3. Third\n4. Fourth\n\n- [ ] Open\n- [x] Done\n\n> Quote\n\n---\n\n| Name | Value |\n| --- | --- |\n| First | **One** |\n\n```mermaid\ngraph TD; A-->B\n```");
    const output = e.getMarkdown();
    for (const text of ["# Heading", "**Bold**", "~~strike~~", "- [ ] Open", "- [x] Done", "Child", "3. Third", "Name", "**One**", "```mermaid", "graph TD; A-->B"]) expect(output).toContain(text);
    expect(e.getJSON().content?.some((node) => node.type === "table")).toBe(true);
    expect(open(output).getJSON()).toEqual(e.getJSON());
  });
  it("preserves stable planner links, title links and transclusions during unrelated edits", () => {
    const raw = "[[hcb:task:task-id|A task]] [[A note]] ![[hcb:note:note-id|Embedded]]";
    const e = open(raw);
    expect(e.getMarkdown()).toBe(raw);
    e.commands.insertContentAt(e.state.doc.content.size - 1, " extra");
    expect(e.getMarkdown()).toBe(`${raw} extra`);
  });
  it("keeps unsupported HTML inert and lossless rather than executing or dropping it", () => {
    const raw = '<div data-custom="keep"><strong>Imported</strong><script>alert(1)</script></div>';
    const e = open(raw);
    expect(e.getMarkdown()).toBe(raw);
    expect(e.view.dom.querySelector("script")).toBeNull();
    expect(e.view.dom.textContent).toContain("<script>alert(1)</script>");
  });
  it("retains HTML declarations and processing instructions during nearby edits", () => {
    const raw = "<!DOCTYPE html>\n\n<?keep this?>\n\n<![CDATA[retain this]]>";
    expect(open(raw).getMarkdown()).toContain("<!DOCTYPE html>");
    expect(editor!.getMarkdown()).toContain("<?keep this?>");
    expect(editor!.getMarkdown()).toContain("<![CDATA[retain this]]>");
  });
  it("keeps footnote definitions and references", () => {
    const e = open("A footnote[^one].\n\n[^one]: Keep this definition.");
    expect(e.getMarkdown()).toContain("[^one]: Keep this definition.");
    expect(e.getMarkdown()).toContain("[^one]");
  });
  it("preserves comments and line breaks inside table cells", () => {
    const e = open("<!-- metadata stays -->\n\n| A | B |\n| --- | --- |\n| first<br>second | value |\n\nText <!-- inline --> end");
    expect(e.getMarkdown()).toContain("<!-- metadata stays -->");
    expect(e.getMarkdown()).toContain("<!-- inline -->");
    expect(e.getMarkdown()).toContain("first<br>second");
    expect(e.view.dom.querySelector("td br")).not.toBeNull();
  });
  it("preserves Markdown links and images", () => {
    const e = open('[Drive](https://drive.google.com/file/d/abc/view)\n\n![Alt](https://example.com/image.png "Title")');
    expect(e.getMarkdown()).toContain("https://drive.google.com/file/d/abc/view");
    expect(e.getMarkdown()).toContain('![Alt](https://example.com/image.png "Title")');
  });
  it("allows normal links and rejects executable or local-file protocols", () => {
    for (const url of ["https://example.com", "mailto:a@example.com", "tel:123", "/path", "#heading"]) expect(safeEditorUrl(url)).toBe(true);
    for (const url of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "//example.com"]) expect(safeEditorUrl(url)).toBe(false);
  });
  it("does not activate unsafe image or link URLs when reading Markdown", () => {
    const e = open("![private](file:///tmp/private.png) [click](javascript:alert%281%29)");
    expect(e.view.dom.querySelector("img")?.getAttribute("src")).toBeNull();
    expect(e.view.dom.querySelector("a")?.getAttribute("href") ?? "").not.toMatch(/^javascript:/);
    expect(e.getMarkdown()).toContain("file:///tmp/private.png");
  });
});
