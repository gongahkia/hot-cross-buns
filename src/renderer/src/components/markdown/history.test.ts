import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdownExtensions } from "./extensions";
import { closeMarkdownHistoryGroup, resetMarkdownHistory } from "./history";

let editor: Editor;
afterEach(() => editor?.destroy());
describe("Markdown editing history", () => {
  it("undoes source changes as a separate group while retaining earlier visual history", () => {
    editor = new Editor({ extensions: markdownExtensions(), content: "Original", contentType: "markdown" });
    editor.commands.insertContentAt(9, " visual");
    closeMarkdownHistoryGroup(editor);
    editor.commands.setContent("## Source replacement", { contentType: "markdown", emitUpdate: false });
    closeMarkdownHistoryGroup(editor);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe("Original visual");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getMarkdown()).toBe("Original");
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getMarkdown()).toBe("Original visual");
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getMarkdown().trim()).toBe("## Source replacement");
  });
  it("does not let undo resurrect content from an externally replaced document", () => {
    const onUpdate = vi.fn();
    editor = new Editor({ extensions: markdownExtensions(), content: "Old", contentType: "markdown", onUpdate });
    editor.commands.insertContentAt(4, " edit");
    editor.commands.setContent("New external document", { contentType: "markdown", emitUpdate: false });
    onUpdate.mockClear(); resetMarkdownHistory(editor);
    expect(editor.commands.undo()).toBe(false);
    expect(editor.commands.redo()).toBe(false);
    expect(editor.getMarkdown()).toBe("New external document");
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
