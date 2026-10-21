import { useEffect, useId, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Italic, Strikethrough, Code, Link2, List, ListOrdered, ListTodo, Quote, Table2, SquareCode, Minus, Undo2, Redo2, Plus, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ReferenceTextarea, type ReferenceInputBindings } from "../ReferenceTextarea";
import { loadEmojiEntries } from "../EmojiTextField";
import type { MarkdownEditorProps } from "../MarkdownEditor";
import { markdownExtensions, safeEditorUrl } from "./extensions";
import { markdownForEditing } from "./mixedMarkup";
import "./markdown-editor.css";

type Choice = { label: string; terms: string; icon: LucideIcon; run: (editor: Editor) => void };
const blocks: Choice[] = [
  { label: "Paragraph", terms: "text normal", icon: List, run: (e) => { e.chain().focus().setParagraph().run(); } },
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({ label: `Heading ${level}`, terms: `h${level} title`, icon: List, run: (e: Editor) => { e.chain().focus().toggleHeading({ level }).run(); } })),
  { label: "Bullet list", terms: "unordered bullets", icon: List, run: (e) => { e.chain().focus().toggleBulletList().run(); } },
  { label: "Numbered list", terms: "ordered numbers", icon: ListOrdered, run: (e) => { e.chain().focus().toggleOrderedList().run(); } },
  { label: "Action list", terms: "task checkbox checklist todo", icon: ListTodo, run: (e) => { e.chain().focus().toggleTaskList().run(); } },
  { label: "Quote", terms: "blockquote", icon: Quote, run: (e) => { e.chain().focus().toggleBlockquote().run(); } },
  { label: "Code block", terms: "source preformatted", icon: SquareCode, run: (e) => { e.chain().focus().toggleCodeBlock().run(); } },
  { label: "Mermaid diagram", terms: "chart graph", icon: SquareCode, run: (e) => { e.chain().focus().setCodeBlock({ language: "mermaid" }).run(); } },
  { label: "Table", terms: "rows columns", icon: Table2, run: (e) => { e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
  { label: "Divider", terms: "horizontal rule", icon: Minus, run: (e) => { e.chain().focus().setHorizontalRule().run(); } }
];
type Menu = { from: number; to: number; query: string; kind: "block" | "emoji" };
const bubbleOptions = { placement: "top" as const, offset: 8 };

export default function RichMarkdownEditor({ value, onValueChange, accountId, disabled = false, placeholder, showControls = true, ...props }: MarkdownEditorProps): JSX.Element {
  const id = useId();
  const label = props["aria-label"];
  const [source, setSource] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [emoji, setEmoji] = useState<Awaited<ReturnType<typeof loadEmojiEntries>>>([]);
  const [link, setLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState("");
  const [, render] = useState(0);
  const linkInput = useRef<HTMLInputElement>(null);
  const bindings = useRef<ReferenceInputBindings | null>(null);
  const queryKey = useRef("");
  const lastValue = useRef(value);
  const callback = useRef(onValueChange); callback.current = onValueChange;
  const menuState = useRef<{ menu: Menu | null; choices: Choice[]; activeIndex: number }>({ menu: null, choices: [], activeIndex: 0 });
  const openLink = useRef<() => void>(() => undefined);
  const extensions = useMemo(() => markdownExtensions(placeholder), [placeholder]);

  function updateSuggestions(editor: Editor) {
    if (editor.view.composing) return;
    const { $from, from, to, empty } = editor.state.selection;
    if (!empty || editor.isActive("codeBlock") || editor.isActive("code") || !editor.isFocused) { setMenu(null); return; }
    const before = $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc");
    const reference = /(?:^|\s)@([^\s@]{0,80})$/.exec(before);
    const nextQuery = reference ? { query: reference[1], range: { start: from - reference[1].length - 1, end: to } } : null;
    const key = JSON.stringify(nextQuery);
    if (key !== queryKey.current) { queryKey.current = key; bindings.current?.onQuery(nextQuery); }
    const slash = /^\/([\w -]{0,40})$/.exec(before);
    const colon = /(?:^|\s):([\w+-]{1,32})$/.exec(before);
    const match = slash ?? colon;
    if (match) {
      const next = { kind: slash ? "block" as const : "emoji" as const, query: match[1].toLowerCase(), from: from - match[1].length - 1, to };
      setMenu((old) => old?.query === next.query && old.from === next.from && old.to === next.to && old.kind === next.kind ? old : next);
    } else setMenu(null);
  }

  const editor = useEditor({
    extensions, content: markdownForEditing(value), contentType: "markdown", editable: !disabled,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { role: "textbox", "aria-label": label, "aria-multiline": "true", "aria-describedby": `${id}-help`, "aria-disabled": String(disabled), tabindex: "0", class: "markdown-content" },
      handleKeyDown: (_view, event) => {
        if (event.isComposing) return false;
        bindings.current?.onKeyDown(event as unknown as React.KeyboardEvent<HTMLElement>);
        if (event.defaultPrevented) return true;
        const state = menuState.current;
        if (state.menu && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Escape") setMenu(null);
          else if (event.key === "ArrowDown" || event.key === "ArrowUp") setActiveIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + Math.max(1, state.choices.length)) % Math.max(1, state.choices.length));
          else if (state.choices.length) choose(state.choices[state.activeIndex] ?? state.choices[0], state.menu);
          return true;
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); event.stopPropagation(); openLink.current(); return true; }
        return false;
      },
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (!text || !editor || editor.isActive("codeBlock")) return false;
        if (!editor.state.selection.empty && safeEditorUrl(text) && !/\s/.test(text.trim())) {
          editor.chain().setLink({ href: text.trim() }).run(); return true;
        }
        if (event.clipboardData?.getData("text/html")) return false;
        editor.commands.insertContent(text, { contentType: "markdown" }); return true;
      }
    },
    onUpdate: ({ editor }) => {
      const next = editor.getMarkdown(); lastValue.current = next; callback.current(next); updateSuggestions(editor);
    },
    onSelectionUpdate: ({ editor }) => updateSuggestions(editor),
    onTransaction: ({ transaction }) => { if (transaction.docChanged || transaction.selectionSet) render((revision) => revision + 1); }
  });

  const choices = menu?.kind === "emoji" ? emoji.filter((entry) => entry.terms.some((term) => term.includes(menu.query))).slice(0, 8).map((entry): Choice => ({
    label: `${entry.native} ${entry.name}`, terms: entry.id, icon: Plus, run: (e) => { e.chain().focus().insertContent({ type: "text", text: entry.native }).run(); }
  })) : blocks.filter((entry) => !menu?.query || `${entry.label} ${entry.terms}`.toLowerCase().includes(menu.query));
  menuState.current = { menu, choices, activeIndex };
  openLink.current = () => { if (editor) { setLink(editor.getAttributes("link").href ?? ""); setLinkError(""); setMenu(null); } };

  useEffect(() => { setActiveIndex(0); }, [menu?.query, menu?.kind]);
  useEffect(() => {
    if (menu?.kind !== "emoji") return;
    let active = true;
    void loadEmojiEntries().then((entries) => { if (active) setEmoji(entries); });
    return () => { active = false; };
  }, [menu?.kind]);
  useEffect(() => { if (link !== null) linkInput.current?.focus(); }, [link === null]);
  useEffect(() => { editor?.setEditable(!disabled, false); if (disabled) { setMenu(null); setLink(null); } }, [editor, disabled]);
  useEffect(() => {
    if (!editor || source || value === lastValue.current) return;
    lastValue.current = value;
    editor.commands.setContent(markdownForEditing(value), { contentType: "markdown", emitUpdate: false });
  }, [editor, source, value]);

  function choose(choice: Choice, target: Menu | null) {
    if (!editor) return;
    setMenu(null);
    if (target && target.to > target.from) editor.chain().focus().deleteRange({ from: target.from, to: target.to }).run();
    choice.run(editor);
  }
  function toggleSource() {
    if (!editor) return;
    if (source) { editor.commands.setContent(markdownForEditing(value), { contentType: "markdown", emitUpdate: false }); lastValue.current = value; }
    setSource(!source); setMenu(null); setLink(null);
  }
  function applyLink() {
    if (!editor || link === null) return;
    const href = link.trim();
    if (href && !safeEditorUrl(href)) { setLinkError("Use an https, http, mailto, tel, or relative link."); return; }
    if (href) editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    else editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLink(null);
  }
  if (!editor) return <div role="status">Loading editor…</div>;

  function tool(name: string, Icon: LucideIcon, run: () => void, active = false, unavailable = false) {
    return <button type="button" className="markdown-tool" aria-label={name} title={name} aria-pressed={active} disabled={disabled || unavailable}
      onMouseDown={(event) => event.preventDefault()} onClick={run}><Icon size={16} strokeWidth={1.5} aria-hidden="true" /></button>;
  }
  function marks() {
    return <>
      {tool("Bold", Bold, () => editor!.chain().focus().toggleBold().run(), editor!.isActive("bold"))}
      {tool("Italic", Italic, () => editor!.chain().focus().toggleItalic().run(), editor!.isActive("italic"))}
      {tool("Strikethrough", Strikethrough, () => editor!.chain().focus().toggleStrike().run(), editor!.isActive("strike"))}
      {tool("Inline code", Code, () => editor!.chain().focus().toggleCode().run(), editor!.isActive("code"))}
      {tool("Insert link", Link2, () => openLink.current(), editor!.isActive("link"))}
    </>;
  }
  return <div className="markdown-editor" aria-disabled={disabled}>
    <div className="markdown-toolbar" role="toolbar" aria-label={`${label} formatting`}>
      {!source ? <>
        <select className="markdown-block-select" aria-label="Text style" disabled={disabled} value={editor.isActive("heading") ? `h${editor.getAttributes("heading").level}` : "paragraph"}
          onChange={(event) => { const level = Number(event.target.value.slice(1)); if (level) editor.chain().focus().setHeading({ level: level as 1 }).run(); else editor.chain().focus().setParagraph().run(); }}>
          <option value="paragraph">Normal text</option>{[1, 2, 3, 4, 5, 6].map((level) => <option value={`h${level}`} key={level}>Heading {level}</option>)}
        </select>
        {marks()}
        {tool("Bullet list", List, () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
        {tool("Numbered list", ListOrdered, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
        {tool("Action list", ListTodo, () => editor.chain().focus().toggleTaskList().run(), editor.isActive("taskList"))}
        {tool("Insert block", Plus, () => { const { from } = editor.state.selection; editor.commands.focus(); setMenu(menu ? null : { from, to: from, query: "", kind: "block" }); })}
        {tool("Undo text edit", Undo2, () => editor.chain().focus().undo().run(), false, !editor.can().undo())}
        {tool("Redo text edit", Redo2, () => editor.chain().focus().redo().run(), false, !editor.can().redo())}
      </> : <span className="px-2 text-text-muted">Markdown source</span>}
      <button type="button" className="markdown-mode" disabled={disabled} aria-pressed={source} onClick={toggleSource}>{source ? "Visual" : "Source"}</button>
    </div>
    {source ? <ReferenceTextarea key="source" aria-label={label} value={value} onValueChange={(next) => { lastValue.current = next; callback.current(next); }} accountId={accountId} disabled={disabled} showControls={showControls && !disabled} className="markdown-source" placeholder={placeholder} /> :
      <ReferenceTextarea key="visual" aria-label={label} value={value} onValueChange={onValueChange} accountId={accountId} disabled={disabled} showControls={showControls && !disabled}
        getSelection={() => ({ start: editor.state.selection.from, end: editor.state.selection.to })}
        insertReference={(markdown, range) => { if (!disabled && !editor.isDestroyed) editor.chain().focus().insertContentAt({ from: range.start, to: range.end }, markdown, { contentType: "markdown" }).run(); }}
        renderInput={(api) => { bindings.current = api; return <EditorContent editor={editor} aria-describedby={`${id}-help`} />; }} />}
    {!source && editor.isActive("codeBlock") ? <label className="markdown-context">Code language <input aria-label="Code language" disabled={disabled} value={editor.getAttributes("codeBlock").language ?? ""} onChange={(event) => editor.chain().updateAttributes("codeBlock", { language: event.target.value }).run()} placeholder="text, javascript, mermaid…" /></label> : null}
    {!source && editor.isActive("table") ? <div className="markdown-context" role="toolbar" aria-label="Table actions">
      {([ ["Add row", () => editor.chain().focus().addRowAfter().run()], ["Add column", () => editor.chain().focus().addColumnAfter().run()], ["Delete row", () => editor.chain().focus().deleteRow().run()], ["Delete column", () => editor.chain().focus().deleteColumn().run()], ["Delete table", () => editor.chain().focus().deleteTable().run()] ] as const).map(([name, action]) => <button type="button" key={name} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={action}>{name}</button>)}
    </div> : null}
    {!source && !disabled ? <BubbleMenu editor={editor} options={bubbleOptions}><div role="toolbar" aria-label="Selected text formatting" className="markdown-bubble">{marks()}</div></BubbleMenu> : null}
    {menu && !source && !disabled ? <div className="markdown-menu" role="listbox" aria-label={menu.kind === "emoji" ? "Emoji suggestions" : "Insert block"}>
      {choices.map((choice, index) => <button type="button" role="option" aria-selected={index === activeIndex} key={choice.label} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(choice, menu)}><choice.icon size={16} aria-hidden="true" />{choice.label}</button>)}
      {!choices.length ? <p role="status">No matching commands</p> : null}
    </div> : null}
    {link !== null && !disabled ? <div role="group" className="markdown-link-form" aria-label="Edit link" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setLink(null); editor.commands.focus(); }
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); applyLink(); }
    }}>
      <label htmlFor={`${id}-link`}>Link URL</label><input id={`${id}-link`} ref={linkInput} value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://example.com" aria-invalid={Boolean(linkError)} />
      <button type="button" onClick={applyLink}>{link.trim() ? "Apply link" : "Remove link"}</button><button type="button" aria-label="Cancel link" onClick={() => { setLink(null); editor.commands.focus(); }}><X size={16} /></button>
      {linkError ? <p role="alert">{linkError}</p> : null}
    </div> : null}
    <p id={`${id}-help`} className="markdown-help">Markdown shortcuts · / blocks · @ references · : emoji</p>
  </div>;
}
