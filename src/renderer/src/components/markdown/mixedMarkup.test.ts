import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { markdownExtensions } from "./extensions";
import { markdownForEditing } from "./mixedMarkup";

let editor: Editor;
afterEach(() => editor?.destroy());
function open(html: string) { editor = new Editor({ extensions: markdownExtensions(), content: markdownForEditing(html), contentType: "markdown" }); return editor; }
describe("imported HTML editing", () => {
  it("keeps literal Markdown punctuation in HTML text literal", () => {
    const e = open("<p>Literal *stars* and [brackets].</p>");
    expect(e.getText()).toBe("Literal *stars* and [brackets].");
    expect(e.view.dom.querySelector("em, a")).toBeNull();
  });
  it("preserves ordered starts and nested lists from HTML descriptions", () => {
    const e = open('<ol start="3"><li><p>Third</p><ul><li>Nested</li></ul></li><li>Fourth</li></ol>');
    // A list start is structural content, not an unsafe HTML attribute.
    expect(e.view.dom.querySelector("ol")).toHaveAttribute("start", "3");
    expect(e.view.dom.querySelector("ol ul li")).toHaveTextContent("Nested");
    expect(e.getMarkdown()).toContain("4. Fourth");
  });
  it("keeps backticks and blank code lines in imported code blocks", () => {
    const e = open("<pre><code>a`b\n\n\n\n  c</code></pre>");
    expect(e.view.dom.querySelector("pre code")).toHaveTextContent("a`b c");
    expect(e.state.doc.firstChild?.textContent).toBe("a`b\n\n\n\n  c");
  });
  it("chooses a valid delimiter for inline code containing backticks", () => {
    const e = open("<p>Use <code>a`b</code>.</p>");
    expect(e.view.dom.querySelector("code")).toHaveTextContent("a`b");
    expect(e.getText()).toBe("Use a`b.");
  });
});
