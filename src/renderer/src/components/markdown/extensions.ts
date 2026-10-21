import { Extension, Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";

export function safeEditorUrl(value: string): boolean {
  return /^(https?:\/\/|mailto:|tel:|#|\/(?!\/))/i.test(value.trim());
}

// Wiki links are atoms, rather than ordinary bracket text which a serializer
// would escape. Keep the original spelling, ID, label and transclusion marker.
const PlannerReference = Node.create({
  name: "plannerReference", group: "inline", inline: true, atom: true,
  addAttributes: () => ({ raw: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-planner-reference]", getAttrs: (element) => ({ raw: element.getAttribute("data-planner-reference") }) }],
  renderHTML: ({ node, HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-planner-reference": node.attrs.raw, class: "markdown-reference", contenteditable: "false" }),
    String(node.attrs.raw).replace(/^!?\[\[|\]\]$/g, "").split("|").at(-1) ?? "Reference"],
  renderText: ({ node }) => node.attrs.raw,
  markdownTokenizer: {
    name: "plannerReference", level: "inline", start: (source) => source.search(/!?\[\[/),
    tokenize: (source) => {
      const match = /^!?\[\[(?:\\.|[^\]\\\n])+\]\]/.exec(source);
      return match ? { type: "plannerReference", raw: match[0] } : undefined;
    }
  },
  parseMarkdown: (token) => ({ type: "plannerReference", attrs: { raw: token.raw } }),
  renderMarkdown: (node) => node.attrs?.raw ?? ""
});

// Raw HTML and footnote definitions cannot safely be represented by the rich
// schema. Keep them as inert, lossless blocks, editable in Markdown source mode.
const PreservedBlock = Node.create({
  name: "preservedBlock", group: "block", atom: true,
  addAttributes: () => ({ raw: { default: "" } }),
  parseHTML: () => [{ tag: "pre[data-preserved-markdown]", getAttrs: (element) => ({ raw: element.getAttribute("data-preserved-markdown") }) }],
  renderHTML: ({ node }) => ["pre", { "data-preserved-markdown": node.attrs.raw, class: "markdown-preserved", contenteditable: "false", title: "Edit this block in Markdown source" }, ["code", {}, node.attrs.raw]],
  markdownTokenizer: {
    name: "preservedBlock", level: "block",
    start: (source) => source.search(/^(?:<!--|<(?:[a-z][\w-]*)(?:\s|>)|\[\^[^\]]+\]:)/im),
    tokenize: (source) => {
      const match = /^(?:<!--[\s\S]*?-->|<(?:[a-z][\w-]*)(?:\s[^>]*|>)[\s\S]*?(?:\n\n|$)|\[\^[^\]]+\]:[^\n]*(?:\n[ \t]+[^\n]*)*)/i.exec(source);
      return match ? { type: "preservedBlock", raw: match[0] } : undefined;
    }
  },
  parseMarkdown: (token) => ({ type: "preservedBlock", attrs: { raw: token.raw } }),
  renderMarkdown: (node) => node.attrs?.raw ?? ""
});

const PreservedInline = Node.create({
  name: "preservedInline", group: "inline", inline: true, atom: true,
  addAttributes: () => ({ raw: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-preserved-markdown]", getAttrs: (element) => ({ raw: element.getAttribute("data-preserved-markdown") }) }],
  renderHTML: ({ node }) => ["span", { "data-preserved-markdown": node.attrs.raw, class: "markdown-preserved", contenteditable: "false" }, node.attrs.raw],
  markdownTokenizer: {
    name: "preservedInline", level: "inline", start: (source) => source.search(/<!--|<\/?[a-z]|\[\^/i),
    tokenize: (source) => {
      if (/^<br\s*\/?\s*>/i.test(source)) return undefined;
      const match = /^(?:<!--[\s\S]*?-->|<\/?[a-z][\w-]*(?:\s[^>]*|\s*\/?)>|\[\^[^\]\n]+\])/i.exec(source);
      return match ? { type: "preservedInline", raw: match[0] } : undefined;
    }
  },
  parseMarkdown: (token) => ({ type: "preservedInline", attrs: { raw: token.raw } }),
  renderMarkdown: (node) => node.attrs?.raw ?? ""
});

const PreserveOtherHtml = Extension.create({
  name: "preserveOtherHtml",
  markdownTokenName: "html",
  parseMarkdown: (token) => {
    const raw = token.raw ?? "";
    return /^<br\s*\/?\s*>$/i.test(raw.trim())
      ? { type: "hardBreak" }
      : { type: token.block ? "preservedBlock" : "preservedInline", attrs: { raw } };
  }
});

const EditingKeys = Extension.create({
  name: "markdownEditingKeys",
  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.isActive("taskItem") ? this.editor.commands.sinkListItem("taskItem") : this.editor.isActive("listItem") ? this.editor.commands.sinkListItem("listItem") : false,
      "Shift-Tab": () => this.editor.isActive("taskItem") ? this.editor.commands.liftListItem("taskItem") : this.editor.isActive("listItem") ? this.editor.commands.liftListItem("listItem") : false
    };
  }
});

const MarkdownImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    const attributes = { ...HTMLAttributes };
    if (!/^(?:https?:\/\/|\/(?!\/))/i.test(String(attributes.src ?? ""))) delete attributes.src;
    return ["img", attributes];
  }
});

export function markdownExtensions(placeholder = "Write something, or type / for commands") {
  return [
    StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true, isAllowedUri: (url) => safeEditorUrl(url) } }),
    Markdown.configure({ indentation: { style: "space", size: 2 } }),
    TaskList, TaskItem.configure({ nested: true }), TableKit,
    MarkdownImage.configure({ allowBase64: false, inline: true }),
    Placeholder.configure({ placeholder }), PlannerReference, PreservedBlock, PreservedInline, PreserveOtherHtml, EditingKeys
  ];
}
