import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import { AlertTriangle, Pencil, RotateCcw, Search } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AutoTagRule } from "@shared/ipc/contracts";
import { useDirtyState, useInspector } from "../../../components/Inspector";
import { EmojiInput } from "../../../components/EmojiTextField";
import { MarkdownEditor } from "../../../components/MarkdownEditor";
import { Badge, Button, cx } from "../../../components/primitives";
import { AutoTagAudit } from "../AutoTagAudit";
import type { useCoreViewModelSource } from "../coreViewModelSource";
import type { NoteViewModel } from "../coreViewModels";
import { MarkdownPreview } from "../MarkdownPreview";
import { plannerLinkTargets } from "../plannerLinkTargets";
import { TagBadges, TagInput } from "../TagInput";
import {
  extractNoteLinks,
  extractNoteProperties,
  extractPlannerLinks,
  normalizedNoteTitle,
  parsePlannerLink,
  plannerLinkDisplayLabel
} from "../notesParsing";

export interface NoteDraftValue {
  title: string;
  body: string;
  tags: string[];
}

export interface NoteInspectorBodyHandle {
  flush: () => Promise<boolean>;
  getDraft: () => NoteDraftValue;
}

export interface NoteTemplateOption {
  body: string;
  id: string;
  name: string;
  title: string;
}

interface NoteInspectorBodyProps {
  createMode?: boolean;
  saving?: boolean;
  error?: string;
  note: NoteViewModel;
  notes: NoteViewModel[];
  onDraftChange: (noteId: string, draft: NoteDraftValue) => void;
  onOpenNote: (noteId: string) => Promise<void> | void;
  onPersist: (noteId: string, draft: NoteDraftValue) => Promise<boolean>;
  rules: readonly AutoTagRule[];
  source: ReturnType<typeof useCoreViewModelSource>;
  templates?: NoteTemplateOption[];
}

function noteDraftValuesEqual(left: NoteDraftValue, right: NoteDraftValue): boolean {
  return left.title === right.title &&
    left.body === right.body &&
    JSON.stringify(left.tags) === JSON.stringify(right.tags);
}

export function NoteInspectorSummary({
  note,
  notes,
  onOpenNote,
  source
}: {
  note: NoteViewModel;
  notes: NoteViewModel[];
  onOpenNote: (noteId: string) => Promise<void> | void;
  source: ReturnType<typeof useCoreViewModelSource>;
}): JSX.Element {
  const properties = useMemo(() => extractNoteProperties(note.body), [note.body]);

  return (
    <div className="grid gap-5 py-1">
      <p className="text-[var(--text-xs)] text-text-muted">Stored on this device. Use Settings → Data to back up or export your notes.</p>
      <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-4">
        <span aria-hidden="true" className="mt-2 size-3.5 rounded-hcbSm bg-info" />
        <div className="min-w-0">
          <h3 className="min-w-0 break-words text-[var(--text-2xl)] font-semibold leading-tight text-text-primary">
            {note.title || "Untitled note"}
          </h3>
          <p className="mt-2 text-[var(--text-sm)] text-text-muted">{note.updatedLabel}</p>
          {note.preview ? (
            <p className="mt-2 text-[var(--text-base)] leading-relaxed text-text-secondary">{note.preview}</p>
          ) : null}
          <div className="mt-2">
            <TagBadges tags={note.tags} />
          </div>
        </div>
      </div>

      {note.body.trim() ? (
        <MarkdownPreview ariaLabel="Note preview" body={note.body} plannerLinkTargets={plannerLinkTargets(source)} />
      ) : <p className="text-[var(--text-base)] text-text-muted">No content</p>}


      {properties.length > 0 ? (
        <div className="grid gap-2">
          <div className="text-[var(--text-xs)] font-semibold uppercase text-text-muted">Properties</div>
          <div className="flex flex-wrap gap-2">
            {properties.map((property) => (
              <Badge key={`${property.key}-${property.value}`} tone="info">
                {property.key}: {property.value}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}


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
    { createMode = false, saving = false, error, note, notes, onDraftChange, onOpenNote, onPersist, rules, source, templates = [] },
    ref
  ): JSX.Element {
    const dirty = useDirtyState<NoteDraftValue>({ title: note.title, body: note.body, tags: note.tags ?? [] });
    const { update } = useInspector();

    const [selectedTemplateId, setSelectedTemplateId] = useState("blank");
    const draftRef = useRef<NoteDraftValue>(dirty.value);
    const dirtyRef = useRef(dirty.isDirty);
    const lastNotifiedDraftRef = useRef<NoteDraftValue>(dirty.value);
    const onDraftChangeRef = useRef(onDraftChange);
    const flushRef = useRef<() => Promise<boolean>>(async () => true);
    const debounceRef = useRef<number | null>(null);
    const properties = useMemo(() => extractNoteProperties(dirty.value.body), [dirty.value.body]);


    useEffect(() => {
      onDraftChangeRef.current = onDraftChange;
    }, [onDraftChange]);

    useEffect(() => {
      if (createMode) {
        setSelectedTemplateId("blank");
      }
    }, [createMode, note.id]);

    useEffect(() => {
      const next = { title: note.title, body: note.body, tags: note.tags ?? [] };

      if (!dirtyRef.current && !noteDraftValuesEqual(draftRef.current, next)) {
        lastNotifiedDraftRef.current = next;
        dirty.reset(next);
      }
    }, [dirty.reset, note.body, note.id, note.tags, note.title]);

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

    const saveInFlight = useRef<Promise<boolean> | null>(null);
    const flush = useCallback(async (): Promise<boolean> => {
      if (saveInFlight.current) await saveInFlight.current;
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      if (note.id.startsWith("note-draft-")) {
        return draftRef.current.title.trim() === "Untitled note" && draftRef.current.body.trim().length === 0;
      }
      if (!dirtyRef.current) return true;
      const draft = draftRef.current;
      const pending = onPersist(note.id, draft).catch(() => false);
      saveInFlight.current = pending;
      const saved = await pending;
      if (saveInFlight.current === pending) saveInFlight.current = null;

      if (saved && noteDraftValuesEqual(draftRef.current, draft)) dirty.reset(draft);
      // A successful older write must not overwrite text entered while it was pending.
      if (saved && !noteDraftValuesEqual(draftRef.current, draft)) return flushRef.current();
      return saved;
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

    function applyTemplate(templateId: string): void {
      const template = templates.find((candidate) => candidate.id === templateId);

      if (!template) {
        return;
      }

      setSelectedTemplateId(templateId);
      patchDraft({ title: template.title, body: template.body });
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
      <div className="note-document grid min-h-full gap-4">
        <fieldset disabled={saving} className="grid min-w-0 gap-3">
          <EmojiInput
            aria-label="Note title"
            autoFocus={createMode}
            onValueChange={(title) => patchDraft({ title })}
            value={dirty.value.title}
          />

          {createMode && templates.length > 0 ? (
            <label className="grid gap-1 text-[var(--text-sm)] font-medium text-text-secondary">
              Template
              <select
                aria-label="Note template"
                className="h-9 rounded-hcbMd border border-border bg-surface-0 px-3 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onChange={(event) => applyTemplate(event.currentTarget.value)}
                value={selectedTemplateId}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <details className="text-sm text-text-muted"><summary className="cursor-pointer py-1">Tags and properties</summary>
          <TagInput onChange={(tags) => patchDraft({ tags })} value={dirty.value.tags} />
          <AutoTagAudit
            input={{
              kind: "note",
              title: dirty.value.title,
              body: dirty.value.body,
              existingTags: dirty.value.tags
            }}
            rules={rules}
          />

          </details>

          {error ? (
            <div
              className="flex items-start gap-2 rounded-hcbMd border border-danger/40 bg-danger/10 px-3 py-2 text-[var(--text-sm)] text-danger"
              role="alert"
            >
              <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={15} />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-muted">Local document</span>
            {error && !note.id.startsWith("note-draft-") ? (
              <Button onClick={() => void flush()} size="sm" variant="danger">
                Couldn’t save · Retry
              </Button>
            ) : (
              <Badge tone={dirty.isDirty ? "warning" : "success"}>
                {note.id.startsWith("note-draft-") ? "Draft · use Create note to save" : dirty.isDirty ? "Saving…" : "Saved on this device"}
              </Badge>
            )}
          </div>

          <MarkdownEditor className="document-markdown" aria-label="Note body" onValueChange={(body) => patchDraft({ body })} disabled={saving} value={dirty.value.body} />

        </fieldset>

        {properties.length > 0 ? <div className="grid gap-2">
          <div className="text-[var(--text-xs)] font-semibold uppercase text-text-muted">Properties</div>
          <div className="flex flex-wrap gap-2">
            {properties.map((property) => (
              <Badge key={`${property.key}-${property.value}`} tone="info">
                {property.key}: {property.value}
              </Badge>
            ))}
          </div>
        </div> : null}


      </div>
    );
  }
);
