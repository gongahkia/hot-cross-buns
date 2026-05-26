import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { Link2, Pencil, RotateCcw, Search } from "lucide-react";
import type { NoteLinkSuggestResponse } from "@shared/ipc/contracts";
import { useDirtyState, useInspector } from "../../../components/Inspector";
import { Badge, Button, Input, cx } from "../../../components/primitives";
import { EmptyState } from "../../../components/states";
import type { NoteViewModel } from "../coreViewModels";
import {
  extractNoteLinks,
  extractNoteProperties,
  normalizedNoteTitle,
  parsePlannerLink
} from "../notesParsing";

export interface NoteDraftValue {
  title: string;
  body: string;
}

export interface NoteInspectorBodyHandle {
  flush: () => Promise<void>;
  getDraft: () => NoteDraftValue;
}

type LinkSuggestion = NoteLinkSuggestResponse["items"][number];

interface NoteInspectorBodyProps {
  note: NoteViewModel;
  notes: NoteViewModel[];
  onDraftChange: (noteId: string, draft: NoteDraftValue) => void;
  onOpenNote: (noteId: string) => Promise<void> | void;
  onPersist: (noteId: string, draft: NoteDraftValue) => Promise<boolean>;
}

function noteDraftValuesEqual(left: NoteDraftValue, right: NoteDraftValue): boolean {
  return left.title === right.title && left.body === right.body;
}

function renderInlineNoteLinks(
  value: string,
  onOpenNoteLink: (title: string) => void
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\[\[([^\]]{1,160})\]\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    const title = match[1]?.trim() ?? "";
    const link = parsePlannerLink(title);

    if (match.index > cursor) {
      nodes.push(value.slice(cursor, match.index));
    }

    nodes.push(link.kind === "note" ? (
      <button
        className="rounded-hcbSm px-1 text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        key={`${title}-${match.index}`}
        onClick={() => onOpenNoteLink(link.label)}
        type="button"
      >
        {link.label}
      </button>
    ) : (
      <span
        className="inline-flex rounded-hcbSm border border-border bg-bg-tertiary px-1 text-text-secondary"
        key={`${title}-${match.index}`}
      >
        {link.kind}: {link.label}
      </span>
    ));
    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) {
    nodes.push(value.slice(cursor));
  }

  return nodes.length > 0 ? nodes : [value];
}

function MarkdownPreview({
  body,
  onOpenNoteLink
}: {
  body: string;
  onOpenNoteLink: (title: string) => void;
}): JSX.Element {
  const lines = body.split(/\r?\n/);

  if (body.trim().length === 0) {
    return <EmptyState description="This note has no body yet." title="Empty note" />;
  }

  return (
    <div
      aria-label="Note preview"
      className="grid min-h-[260px] content-start gap-2 rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-base)] text-text-primary"
      role="region"
    >
      {lines.map((line, index) => {
        const trimmed = line.trim();

        if (!trimmed) {
          return <div aria-hidden="true" className="h-2" key={`blank-${index}`} />;
        }

        const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
        if (heading) {
          const level = heading[1].length;
          const className =
            level === 1
              ? "text-[var(--text-xl)] font-semibold"
              : level === 2
                ? "text-[var(--text-lg)] font-semibold"
                : "text-[var(--text-md)] font-semibold";

          return (
            <div className={className} key={`heading-${index}`}>
              {renderInlineNoteLinks(heading[2], onOpenNoteLink)}
            </div>
          );
        }

        const taskItem = /^[-*]\s+\[( |x|X)\]\s+(.+)$/.exec(trimmed);
        if (taskItem) {
          const checked = taskItem[1].toLowerCase() === "x";

          return (
            <div className="flex items-start gap-2" key={`task-${index}`}>
              <input
                checked={checked}
                className="mt-1 accent-[var(--color-accent)]"
                readOnly
                type="checkbox"
              />
              <span className={cx("min-w-0", checked && "text-text-muted line-through")}>
                {renderInlineNoteLinks(taskItem[2], onOpenNoteLink)}
              </span>
            </div>
          );
        }

        const listItem = /^[-*]\s+(.+)$/.exec(trimmed);
        if (listItem) {
          return (
            <div className="flex items-start gap-2" key={`list-${index}`}>
              <span className="text-text-muted">-</span>
              <span className="min-w-0">{renderInlineNoteLinks(listItem[1], onOpenNoteLink)}</span>
            </div>
          );
        }

        const quote = /^>\s+(.+)$/.exec(trimmed);
        if (quote) {
          return (
            <blockquote
              className="border-l-2 border-accent pl-3 text-text-secondary"
              key={`quote-${index}`}
            >
              {renderInlineNoteLinks(quote[1], onOpenNoteLink)}
            </blockquote>
          );
        }

        return <p key={`paragraph-${index}`}>{renderInlineNoteLinks(trimmed, onOpenNoteLink)}</p>;
      })}
    </div>
  );
}

export function NoteInspectorSummary({
  note,
  notes,
  onOpenNote
}: {
  note: NoteViewModel;
  notes: NoteViewModel[];
  onOpenNote: (noteId: string) => Promise<void> | void;
}): JSX.Element {
  const noteByNormalizedTitle = useMemo(
    () => new Map(notes.map((candidate) => [normalizedNoteTitle(candidate.title), candidate])),
    [notes]
  );
  const links = useMemo(() => extractNoteLinks(note.body), [note.body]);
  const properties = useMemo(() => extractNoteProperties(note.body), [note.body]);
  const backlinks = useMemo(
    () =>
      notes.filter(
        (candidate) =>
          candidate.id !== note.id &&
          extractNoteLinks(candidate.body).some(
            (title) => normalizedNoteTitle(title) === normalizedNoteTitle(note.title)
          )
      ),
    [note.body, note.id, note.title, notes]
  );

  function openLinkedNoteByTitle(title: string): void {
    const linkedNote = noteByNormalizedTitle.get(normalizedNoteTitle(title));

    if (linkedNote) {
      void onOpenNote(linkedNote.id);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-hcbLg border border-border bg-bg-tertiary p-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h3 className="min-w-0 truncate text-[var(--text-xl)] font-semibold text-text-primary">
            {note.title || "Untitled note"}
          </h3>
          <Badge tone="success">Saved</Badge>
        </div>
        <p className="text-[var(--text-sm)] text-text-muted">{note.updatedLabel}</p>
        {note.preview ? (
          <p className="text-[var(--text-base)] leading-relaxed text-text-secondary">{note.preview}</p>
        ) : null}
      </div>

      <MarkdownPreview body={note.body} onOpenNoteLink={openLinkedNoteByTitle} />

      <div className="grid gap-2">
        <div className="text-[var(--text-xs)] font-semibold uppercase text-text-muted">Properties</div>
        {properties.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {properties.map((property) => (
              <Badge key={`${property.key}-${property.value}`} tone="info">
                {property.key}: {property.value}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-[var(--text-sm)] text-text-muted">No properties</span>
        )}
      </div>

      <div className="grid gap-3 rounded-hcbMd border border-border bg-bg-tertiary p-3">
        <div className="grid gap-2">
          <div className="text-[var(--text-xs)] font-semibold uppercase text-text-muted">Links</div>
          {links.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {links.map((title) => {
                const link = parsePlannerLink(title);
                const linkedNote = link.kind === "note"
                  ? noteByNormalizedTitle.get(normalizedNoteTitle(link.label))
                  : undefined;
                const action = linkedNote ? () => void onOpenNote(linkedNote.id) : () => undefined;

                return (
                  <button
                    aria-label={linkedNote ? `Open linked note ${linkedNote.title}` : `${link.kind} link ${link.label}`}
                    className={linkButtonClass(linkedNote ? "accent" : "neutral")}
                    key={title}
                    onClick={action}
                    type="button"
                  >
                    <Search aria-hidden="true" size={14} />
                    {linkedNote ? linkedNote.title : `${link.kind}: ${link.label}`}
                  </button>
                );
              })}
            </div>
          ) : (
            <span className="text-[var(--text-sm)] text-text-muted">None</span>
          )}
        </div>

        <div className="grid gap-2">
          <div className="text-[var(--text-xs)] font-semibold uppercase text-text-muted">Backlinks</div>
          {backlinks.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {backlinks.map((backlink) => (
                <button
                  aria-label={`Open backlink ${backlink.title}`}
                  className={linkButtonClass("accent")}
                  key={backlink.id}
                  onClick={() => void onOpenNote(backlink.id)}
                  type="button"
                >
                  <RotateCcw aria-hidden="true" size={14} />
                  {backlink.title}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-[var(--text-sm)] text-text-muted">None</span>
          )}
        </div>
      </div>
    </div>
  );
}

function linkButtonClass(tone: "accent" | "warning" | "neutral"): string {
  return cx(
    "inline-flex min-h-8 items-center gap-1 rounded-hcbSm border px-2 text-[var(--text-sm)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    tone === "accent" && "border-accent bg-bg-tertiary text-accent",
    tone === "warning" && "border-warning bg-bg-tertiary text-warning",
    tone === "neutral" && "border-border bg-bg-tertiary text-text-secondary"
  );
}

export const NoteInspectorBody = forwardRef<NoteInspectorBodyHandle, NoteInspectorBodyProps>(
  function NoteInspectorBody(
    { note, notes, onDraftChange, onOpenNote, onPersist },
    ref
  ): JSX.Element {
    const dirty = useDirtyState<NoteDraftValue>({ title: note.title, body: note.body });
    const { update } = useInspector();
    const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
    const [linkQuery, setLinkQuery] = useState("");
    const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([]);
    const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
    const [repairLinkText, setRepairLinkText] = useState<string | null>(null);
    const [brokenLinks, setBrokenLinks] = useState<Array<{ linkText: string }>>([]);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const linkInputRef = useRef<HTMLInputElement | null>(null);
    const draftRef = useRef<NoteDraftValue>(dirty.value);
    const dirtyRef = useRef(dirty.isDirty);
    const lastNotifiedDraftRef = useRef<NoteDraftValue>(dirty.value);
    const onDraftChangeRef = useRef(onDraftChange);
    const flushRef = useRef<() => Promise<void>>(async () => undefined);
    const debounceRef = useRef<number | null>(null);
    const noteByNormalizedTitle = useMemo(
      () => new Map(notes.map((candidate) => [normalizedNoteTitle(candidate.title), candidate])),
      [notes]
    );
    const links = useMemo(() => extractNoteLinks(dirty.value.body), [dirty.value.body]);
    const properties = useMemo(() => extractNoteProperties(dirty.value.body), [dirty.value.body]);
    const backlinks = useMemo(
      () =>
        notes.filter(
          (candidate) =>
            candidate.id !== note.id &&
            extractNoteLinks(candidate.body).some(
              (title) => normalizedNoteTitle(title) === normalizedNoteTitle(dirty.value.title)
            )
        ),
      [dirty.value.title, note.id, notes]
    );
    const brokenLinkTexts = useMemo(
      () => new Set(brokenLinks.map((item) => item.linkText)),
      [brokenLinks]
    );

    useEffect(() => {
      if (note.id.startsWith("note-draft-")) {
        setBrokenLinks([]);
        return;
      }

      let cancelled = false;

      void window.hcb?.notes.listBrokenLinks({ noteId: note.id }).then((result) => {
        if (cancelled || !result?.ok) {
          return;
        }

        setBrokenLinks(result.data.items);
      });

      return () => {
        cancelled = true;
      };
    }, [dirty.value.body, note.id]);

    useEffect(() => {
      const query = linkQuery.trim();

      if (!query) {
        setSuggestions([]);
        setActiveSuggestionIndex(0);
        return;
      }

      let cancelled = false;
      const timer = window.setTimeout(() => {
        void window.hcb?.notes.linkSuggest({ query, limit: 8 }).then((result) => {
          if (cancelled || !result?.ok) {
            return;
          }

          setSuggestions(result.data.items);
          setActiveSuggestionIndex(0);
        });
      }, 180);

      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }, [linkQuery]);

    useEffect(() => {
      onDraftChangeRef.current = onDraftChange;
    }, [onDraftChange]);

    useEffect(() => {
      const next = { title: note.title, body: note.body };

      if (!dirtyRef.current && !noteDraftValuesEqual(draftRef.current, next)) {
        lastNotifiedDraftRef.current = next;
        dirty.reset(next);
      }
    }, [dirty.reset, note.body, note.id, note.title]);

    useEffect(() => {
      draftRef.current = dirty.value;
      dirtyRef.current = dirty.isDirty;

      if (!noteDraftValuesEqual(lastNotifiedDraftRef.current, dirty.value)) {
        lastNotifiedDraftRef.current = dirty.value;
        onDraftChangeRef.current(note.id, dirty.value);
      }

      update({
        dirty: dirty.isDirty,
        subtitle: note.updatedLabel,
        title: dirty.value.title || "Untitled note"
      });
    }, [dirty.isDirty, dirty.value, note.id, note.updatedLabel, update]);

    const flush = useCallback(async (): Promise<void> => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      if (!dirtyRef.current || note.id.startsWith("note-draft-")) {
        return;
      }

      const draft = draftRef.current;
      const saved = await onPersist(note.id, draft);

      if (saved) {
        dirty.reset(draft);
      }
    }, [dirty.reset, note.id, onPersist]);

    useEffect(() => {
      flushRef.current = flush;
    }, [flush]);

    useEffect(() => {
      if (!dirty.isDirty || note.id.startsWith("note-draft-")) {
        return;
      }

      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }

      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        void flushRef.current();
      }, 250);

      return () => {
        if (debounceRef.current !== null) {
          window.clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
      };
    }, [dirty.isDirty, dirty.value, note.id]);

    useEffect(
      () => () => {
        void flushRef.current();
      },
      []
    );

    useImperativeHandle(
      ref,
      () => ({
        flush,
        getDraft: () => draftRef.current
      }),
      [flush]
    );

    function patchDraft(partial: Partial<NoteDraftValue>): void {
      dirty.patch(partial);
    }

    function markerForSuggestion(suggestion: LinkSuggestion): string {
      return `[[${suggestion.kind}:${suggestion.label}]]`;
    }

    function insertMarkerAtCursor(marker: string): void {
      const textarea = textareaRef.current;
      const body = dirty.value.body;
      const start = textarea?.selectionStart ?? body.length;
      const end = textarea?.selectionEnd ?? start;
      const nextBody = `${body.slice(0, start)}${marker}${body.slice(end)}`;
      patchDraft({ body: nextBody });
      setLinkQuery("");
      setSuggestions([]);

      queueMicrotask(() => {
        const nextCursor = start + marker.length;
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
      });
    }

    function repairLink(marker: string): void {
      if (!repairLinkText) {
        insertMarkerAtCursor(marker);
        return;
      }

      const escaped = repairLinkText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`\\[\\[${escaped}\\]\\]`);
      patchDraft({ body: dirty.value.body.replace(pattern, marker) });
      setRepairLinkText(null);
      setLinkQuery("");
      setSuggestions([]);
      textareaRef.current?.focus();
    }

    function chooseSuggestion(suggestion: LinkSuggestion): void {
      const marker = markerForSuggestion(suggestion);

      if (repairLinkText) {
        repairLink(marker);
        return;
      }

      insertMarkerAtCursor(marker);
    }

    function openRepair(linkText: string): void {
      const parsed = parsePlannerLink(linkText);
      setRepairLinkText(linkText);
      setLinkQuery(parsed.label);
      setActiveSuggestionIndex(0);
      queueMicrotask(() => linkInputRef.current?.focus());
    }

    function handleSuggestionKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveSuggestionIndex((current) =>
          suggestions.length === 0 ? 0 : (current + 1) % suggestions.length
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSuggestionIndex((current) =>
          suggestions.length === 0 ? 0 : (current - 1 + suggestions.length) % suggestions.length
        );
        return;
      }

      if (event.key === "Enter" && suggestions[activeSuggestionIndex]) {
        event.preventDefault();
        chooseSuggestion(suggestions[activeSuggestionIndex]);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setSuggestions([]);
        setRepairLinkText(null);
      }
    }

    function openLinkedNoteByTitle(title: string): void {
      const linkedNote = noteByNormalizedTitle.get(normalizedNoteTitle(title));

      if (linkedNote) {
        void onOpenNote(linkedNote.id);
      }
    }

    function handleLinkChipKeyDown(
      event: ReactKeyboardEvent<HTMLButtonElement>,
      action: () => void
    ): void {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        action();
      }
    }

    return (
      <div className="grid gap-4">
        <div className="grid gap-3">
          <Input
            aria-label="Note title"
            onChange={(event: ChangeEvent<HTMLInputElement>) => patchDraft({ title: event.target.value })}
            value={dirty.value.title}
          />

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2" role="tablist" aria-label="Note view mode">
              <Button
                aria-selected={viewMode === "edit"}
                onClick={() => setViewMode("edit")}
                role="tab"
                size="sm"
                variant={viewMode === "edit" ? "secondary" : "ghost"}
              >
                <Pencil aria-hidden="true" size={14} />
                Edit
              </Button>
              <Button
                aria-selected={viewMode === "preview"}
                onClick={() => setViewMode("preview")}
                role="tab"
                size="sm"
                variant={viewMode === "preview" ? "secondary" : "ghost"}
              >
                <Search aria-hidden="true" size={14} />
                Preview
              </Button>
            </div>
            <Badge tone={dirty.isDirty ? "warning" : "success"}>
              {dirty.isDirty ? "Saving" : "Saved"}
            </Badge>
          </div>

          {viewMode === "edit" ? (
            <textarea
              aria-label="Note body"
              className="min-h-[260px] w-full resize-none rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-base)] text-text-primary placeholder:text-text-muted transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onChange={(event) => patchDraft({ body: event.target.value })}
              ref={textareaRef}
              value={dirty.value.body}
            />
          ) : (
            <MarkdownPreview body={dirty.value.body} onOpenNoteLink={openLinkedNoteByTitle} />
          )}
        </div>

        <div className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3">
          <div className="flex items-center gap-2 text-[var(--text-sm)] font-medium text-text-primary">
            <Link2 aria-hidden="true" size={15} />
            {repairLinkText ? `Fix ${repairLinkText}` : "Insert link"}
          </div>
          <div className="relative grid gap-2">
            <Input
              aria-autocomplete="list"
              aria-controls="note-link-suggestions"
              aria-expanded={suggestions.length > 0}
              aria-label="Planner link target"
              onChange={(event) => setLinkQuery(event.target.value)}
              onKeyDown={handleSuggestionKeyDown}
              placeholder="Search notes, tasks, events"
              ref={linkInputRef}
              role="combobox"
              value={linkQuery}
            />
            {suggestions.length > 0 ? (
              <div
                className="absolute left-0 right-0 top-9 z-10 grid max-h-48 overflow-auto rounded-hcbMd border border-border bg-surface-0 p-1 shadow-hcbMd"
                id="note-link-suggestions"
                role="listbox"
              >
                {suggestions.map((suggestion, index) => (
                  <button
                    aria-selected={index === activeSuggestionIndex}
                    className={cx(
                      "flex min-h-8 items-center justify-between gap-2 rounded-hcbSm px-2 text-left text-[var(--text-sm)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                      index === activeSuggestionIndex ? "bg-bg-tertiary text-text-primary" : "text-text-secondary hover:bg-bg-tertiary"
                    )}
                    key={`${suggestion.kind}-${suggestion.id}`}
                    onClick={() => chooseSuggestion(suggestion)}
                    onMouseEnter={() => setActiveSuggestionIndex(index)}
                    role="option"
                    type="button"
                  >
                    <span className="truncate">{suggestion.label}</span>
                    <Badge tone={suggestion.kind === "note" ? "info" : suggestion.kind === "task" ? "success" : "accent"}>
                      {suggestion.kind}
                    </Badge>
                  </button>
                ))}
              </div>
            ) : null}
            {repairLinkText ? (
              <Button
                onClick={() => {
                  setRepairLinkText(null);
                  setLinkQuery("");
                  setSuggestions([]);
                }}
                size="sm"
                variant="ghost"
              >
                Cancel repair
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-2">
          <div className="text-[var(--text-xs)] font-semibold uppercase text-text-muted">Properties</div>
          {properties.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {properties.map((property) => (
                <Badge key={`${property.key}-${property.value}`} tone="info">
                  {property.key}: {property.value}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-[var(--text-sm)] text-text-muted">No properties</span>
          )}
        </div>

        <div className="grid gap-3 rounded-hcbMd border border-border bg-bg-tertiary p-3">
          <div className="grid gap-2">
            <div className="text-[var(--text-xs)] font-semibold uppercase text-text-muted">Links</div>
            {links.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {links.map((title) => {
                  const link = parsePlannerLink(title);
                  const linkedNote = link.kind === "note"
                    ? noteByNormalizedTitle.get(normalizedNoteTitle(link.label))
                    : undefined;
                  const isBroken = brokenLinkTexts.has(title) || (link.kind === "note" && !linkedNote);
                  const label = linkedNote?.title ?? link.label;
                  const action = linkedNote ? () => void onOpenNote(linkedNote.id) : () => undefined;

                  return (
                    <button
                      aria-label={linkedNote ? `Open linked note ${linkedNote.title}` : `${link.kind} link ${link.label}`}
                      className={linkButtonClass(linkedNote ? "accent" : isBroken ? "warning" : "neutral")}
                      key={title}
                      onClick={action}
                      onKeyDown={(event) => handleLinkChipKeyDown(event, action)}
                      type="button"
                    >
                      <Search aria-hidden="true" size={14} />
                      {linkedNote ? label : `${isBroken ? "Broken" : link.kind}: ${label}`}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="text-[var(--text-sm)] text-text-muted">None</span>
            )}
          </div>

          {brokenLinks.length > 0 ? (
            <div className="grid gap-2">
              <div className="text-[var(--text-xs)] font-semibold uppercase text-warning">Broken links</div>
              <div className="flex flex-wrap gap-2">
                {brokenLinks.map((item) => (
                  <span
                    className="inline-flex min-h-8 items-center gap-2 rounded-hcbSm border border-warning bg-bg-tertiary px-2 text-[var(--text-sm)] text-warning"
                    key={item.linkText}
                  >
                    {item.linkText}
                    <button
                      aria-label={`Fix link ${item.linkText}`}
                      className="rounded-hcbSm px-1 text-warning underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      onClick={() => openRepair(item.linkText)}
                      type="button"
                    >
                      Fix link
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-2">
            <div className="text-[var(--text-xs)] font-semibold uppercase text-text-muted">Backlinks</div>
            {backlinks.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {backlinks.map((backlink) => {
                  const action = () => void onOpenNote(backlink.id);

                  return (
                    <button
                      aria-label={`Open backlink ${backlink.title}`}
                      className={linkButtonClass("accent")}
                      key={backlink.id}
                      onClick={action}
                      onKeyDown={(event) => handleLinkChipKeyDown(event, action)}
                      type="button"
                    >
                      <RotateCcw aria-hidden="true" size={14} />
                      {backlink.title}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="text-[var(--text-sm)] text-text-muted">None</span>
            )}
          </div>
        </div>
      </div>
    );
  }
);
