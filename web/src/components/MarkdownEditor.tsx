import emojiDataJson from "@emoji-mart/data/sets/15/native.json";
import type { Emoji, EmojiMartData } from "@emoji-mart/data";
import { useMemo, useRef, useState } from "react";

import { ModalDialog } from "@/components/ModalDialog";
import { LoadingState } from "@/components/LoadingState";
import { RichDescription } from "@/components/RichDescription";
import type { GoogleDriveFile } from "@/types";

type EditorMode = "write" | "preview";
type InsertKind = "link" | "image";

interface DriveImageSupport {
  readonly authorized: boolean;
  authorize(): Promise<void>;
  search(query: string): Promise<GoogleDriveFile[]>;
}

interface MarkdownEditorProps {
  readonly label: string;
  readonly value: string;
  readonly rows?: number;
  readonly disabled?: boolean;
  readonly drive?: DriveImageSupport;
  onChange(value: string): void;
}

interface EmojiTrigger {
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

interface TextSelection {
  readonly start: number;
  readonly end: number;
}

const emojiData = emojiDataJson as EmojiMartData;
const allEmoji = Object.values(emojiData.emojis);
const initialEmoji = ["smile", "thumbsup", "heart", "tada", "fire", "eyes", "white_check_mark", "rocket"]
  .map((id) => emojiData.emojis[id])
  .filter((emoji): emoji is Emoji => Boolean(emoji));

function validHttps(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function emojiTrigger(value: string, cursor: number): EmojiTrigger | undefined {
  const before = value.slice(0, cursor);
  const fencedSections = before.split("```");
  if (fencedSections.length % 2 === 0) return undefined;
  const line = fencedSections.at(-1)?.split("\n").at(-1) ?? "";
  if ((line.match(/`/g)?.length ?? 0) % 2 === 1) return undefined;
  const match = /(^|[\s([{])\:([a-z0-9_+\-]{0,48})$/i.exec(before);
  if (!match) return undefined;
  return { start: cursor - match[2].length - 1, end: cursor, query: match[2].toLocaleLowerCase() };
}

function EmojiPopover({ query, activeIndex, select }: { readonly query: string; readonly activeIndex: number; select(emoji: Emoji): void }): React.JSX.Element {
  const matches = useMemo(() => {
    if (!query) return initialEmoji;
    return allEmoji.filter((emoji) => `${emoji.id} ${emoji.name} ${emoji.keywords.join(" ")}`.toLocaleLowerCase().includes(query)).slice(0, 36);
  }, [query]);
  if (matches.length === 0) return <div className="emoji-popover" role="status">No emoji matches “:{query}”.</div>;
  return <div className="emoji-popover" role="listbox" aria-label="Emoji suggestions">
    <p><strong>Emoji</strong><span>:{query}</span></p>
    <div className="emoji-grid">{matches.map((emoji, index) => <button key={emoji.id} type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""} aria-label={`${emoji.name} :${emoji.id}:`} title={`:${emoji.id}:`} onMouseDown={(event) => event.preventDefault()} onClick={() => select(emoji)}>{emoji.skins[0]?.native}</button>)}</div>
  </div>;
}

function InsertDialog({ kind, selection, drive, close, insert }: { readonly kind: InsertKind; readonly selection: string; readonly drive?: DriveImageSupport; close(): void; insert(markdown: string): void }): React.JSX.Element {
  const [text, setText] = useState(selection || (kind === "image" ? "Image description" : "Link text"));
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly GoogleDriveFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const urlRef = useRef<HTMLInputElement>(null);
  const image = kind === "image";
  const insertUrl = (candidate = url, label = text): void => {
    const source = validHttps(candidate);
    if (!source) {
      setError("Enter an HTTPS URL.");
      return;
    }
    insert(image ? `![${label.trim() || "Image"}](${source})` : `[${label.trim() || "Link"}](${source})`);
  };
  async function searchDrive(): Promise<void> {
    if (!drive || !query.trim()) return;
    setBusy(true);
    setError("");
    try {
      setResults((await drive.search(query)).filter((file) => file.mimeType?.startsWith("image/") && validHttps(file.webContentLink ?? "")));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Drive image search failed");
    } finally {
      setBusy(false);
    }
  }
  return <ModalDialog className="markdown-insert-dialog" labelledBy="markdown-insert-heading" initialFocusRef={urlRef} onClose={close}>
    <div className="panel-heading"><h2 id="markdown-insert-heading">Insert {image ? "image" : "link"}</h2><button type="button" onClick={close}>Close</button></div>
    <label>{image ? "Image description" : "Link text"}<input value={text} onChange={(event) => setText(event.target.value)} /></label>
    <label>{image ? "Image URL" : "Link URL"}<input ref={urlRef} type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /></label>
    <div className="button-row"><button type="button" onClick={() => insertUrl()}>Insert {image ? "image" : "link"}</button></div>
    {image && drive && <fieldset className="markdown-drive-images"><legend>Google Drive image</legend>{!drive.authorized ? <button type="button" onClick={() => void drive.authorize().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Drive authorization failed"))}>Authorize Drive metadata</button> : <><div className="inline-form"><input aria-label="Search Drive images" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search image files" /><button type="button" disabled={busy || !query.trim()} onClick={() => void searchDrive()}>Search</button></div>{busy && <LoadingState label="Searching Drive images" variant="Dots" className="inline-loader" />}<ul className="drive-results">{results.map((file) => <li key={file.id}><span>{file.name}</span><button type="button" onClick={() => insertUrl(file.webContentLink, file.name)}>Use image</button></li>)}</ul><p className="field-help">Only Drive images with a direct HTTPS content link can be embedded. Google sharing permissions still apply.</p></>}</fieldset>}
    {error && <p className="error" role="alert">{error}</p>}
  </ModalDialog>;
}

/** Full Markdown authoring surface shared by Google Task notes and Calendar descriptions. */
export function MarkdownEditor({ label, value, rows = 7, disabled = false, drive, onChange }: MarkdownEditorProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef<TextSelection>({ start: 0, end: 0 });
  const [mode, setMode] = useState<EditorMode>("write");
  const [insertKind, setInsertKind] = useState<InsertKind>();
  const [trigger, setTrigger] = useState<EmojiTrigger>();
  const [activeEmoji, setActiveEmoji] = useState(0);
  const emojiMatches = useMemo(() => {
    if (!trigger) return [];
    if (!trigger.query) return initialEmoji;
    return allEmoji.filter((emoji) => `${emoji.id} ${emoji.name} ${emoji.keywords.join(" ")}`.toLocaleLowerCase().includes(trigger.query)).slice(0, 36);
  }, [trigger]);

  function selection(): TextSelection {
    const textarea = textareaRef.current;
    return textarea ? { start: textarea.selectionStart, end: textarea.selectionEnd } : selectionRef.current;
  }

  function replaceRange(replacement: string, range = selection(), selectedStart = replacement.length, selectedEnd = selectedStart): void {
    const next = `${value.slice(0, range.start)}${replacement}${value.slice(range.end)}`;
    onChange(next);
    const start = range.start + selectedStart;
    const end = range.start + selectedEnd;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start, end);
      selectionRef.current = { start, end };
    });
  }

  function wrap(prefix: string, suffix: string, placeholder: string): void {
    const range = selection();
    const selected = value.slice(range.start, range.end) || placeholder;
    replaceRange(`${prefix}${selected}${suffix}`, range, prefix.length, prefix.length + selected.length);
  }

  function linePrefix(prefix: string): void {
    const range = selection();
    const lineStart = value.lastIndexOf("\n", Math.max(0, range.start - 1)) + 1;
    const lineEnd = value.indexOf("\n", range.end);
    const end = lineEnd < 0 ? value.length : lineEnd;
    const selected = value.slice(lineStart, end) || "Item";
    const replacement = selected.split("\n").map((line) => `${prefix}${line || "Item"}`).join("\n");
    replaceRange(replacement, { start: lineStart, end }, 0, replacement.length);
  }

  function insertBlock(block: string): void {
    const range = selection();
    const before = value.slice(0, range.start);
    const after = value.slice(range.end);
    const leading = before && !before.endsWith("\n\n") ? "\n\n" : "";
    const trailing = after && !after.startsWith("\n") ? "\n\n" : "";
    replaceRange(`${leading}${block}${trailing}`, range, leading.length, leading.length + block.length);
  }

  function openInsert(kind: InsertKind): void {
    selectionRef.current = selection();
    setInsertKind(kind);
  }

  function insertEmoji(emoji: Emoji): void {
    if (!trigger) return;
    replaceRange(emoji.skins[0]?.native ?? "", { start: trigger.start, end: trigger.end });
    setTrigger(undefined);
  }

  function handleChange(next: string, cursor: number): void {
    onChange(next);
    selectionRef.current = { start: cursor, end: cursor };
    const nextTrigger = emojiTrigger(next, cursor);
    setTrigger(nextTrigger);
    setActiveEmoji(0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (!trigger || emojiMatches.length === 0) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveEmoji((current) => (current + 1) % emojiMatches.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActiveEmoji((current) => (current - 1 + emojiMatches.length) % emojiMatches.length); }
    else if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); insertEmoji(emojiMatches[activeEmoji]!); }
    else if (event.key === "Escape") { event.preventDefault(); setTrigger(undefined); }
  }

  const toolbar = [
    ["Bold", () => wrap("**", "**", "bold text")],
    ["Italic", () => wrap("*", "*", "italic text")],
    ["Heading", () => linePrefix("## ")],
    ["Strikethrough", () => wrap("~~", "~~", "struck text")],
    ["Bulleted list", () => linePrefix("- ")],
    ["Numbered list", () => linePrefix("1. ")],
    ["Checklist", () => linePrefix("- [ ] ")],
    ["Blockquote", () => linePrefix("> ")],
    ["Code", () => { const range = selection(); const selected = value.slice(range.start, range.end); selected.includes("\n") ? wrap("```\n", "\n```", "code") : wrap("`", "`", "code"); }],
    ["Table", () => insertBlock("| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |")] 
  ] as const;

  return <section className="markdown-editor" aria-label={`${label} Markdown editor`}>
    <div className="markdown-editor-tabs" role="tablist" aria-label={`${label} mode`}><button type="button" role="tab" aria-selected={mode === "write"} className={mode === "write" ? "active" : ""} onClick={() => setMode("write")}>Write</button><button type="button" role="tab" aria-selected={mode === "preview"} className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}>Preview</button></div>
    {mode === "write" ? <><div className="markdown-toolbar" role="toolbar" aria-label={`${label} formatting`}>
      {toolbar.map(([name, action]) => <button key={name} type="button" title={name} aria-label={name} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={action}>{name === "Bold" ? "B" : name === "Italic" ? "I" : name === "Heading" ? "H" : name === "Strikethrough" ? "S" : name === "Bulleted list" ? "•" : name === "Numbered list" ? "1." : name === "Checklist" ? "☑" : name === "Blockquote" ? "❝" : name === "Code" ? "</>" : "▦"}</button>)}
      <button type="button" title="Insert link" aria-label="Insert link" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => openInsert("link")}>↗</button><button type="button" title="Insert image" aria-label="Insert image" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => openInsert("image")}>▧</button>
    </div><div className="markdown-composer"><textarea ref={textareaRef} aria-label={label} value={value} rows={rows} disabled={disabled} spellCheck onSelect={() => { selectionRef.current = selection(); }} onChange={(event) => handleChange(event.target.value, event.target.selectionStart)} onKeyDown={handleKeyDown} />{trigger && <EmojiPopover query={trigger.query} activeIndex={activeEmoji} select={insertEmoji} />}</div></> : <div className="markdown-preview" role="tabpanel"><RichDescription value={value} /></div>}
    {insertKind && <InsertDialog kind={insertKind} selection={value.slice(selectionRef.current.start, selectionRef.current.end)} drive={drive} close={() => { setInsertKind(undefined); requestAnimationFrame(() => textareaRef.current?.focus()); }} insert={(markdown) => { replaceRange(markdown, selectionRef.current); setInsertKind(undefined); }} />}
  </section>;
}
