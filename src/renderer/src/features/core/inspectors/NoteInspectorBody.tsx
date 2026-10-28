import { Select, SelectItem } from "@renderer/components/Select";
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
  settle: () => Promise<void>;
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
      <p className="text-[var(--text-xs)] text-text-muted">{source.native.capabilityReport.platform === "web" ? "Saved in this browser profile. See Settings → Data for storage details." : "Stored on this device. Use Settings → Data to back up or export your notes."}</p>
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
    const [value, setValue] = useState<NoteDraftValue>({ title: note.title, body: note.body, tags: note.tags ?? [] });
    const baselineRef = useRef(value);
    const draftRef = useRef(value);
    const createdRef = useRef(!note.id.startsWith("note-draft-"));
    const saveInFlight = useRef<Promise<boolean> | null>(null);
    const { update } = useInspector();
    const [selectedTemplateId, setSelectedTemplateId] = useState("blank");
    const properties = useMemo(() => extractNoteProperties(value.body), [value.body]);
    const isDirty = !noteDraftValuesEqual(value, baselineRef.current);

    useEffect(() => {
      update({ dirty: isDirty, title: value.title || "Untitled note" });
    }, [isDirty, value.title, update]);

    const flush = useCallback(async (): Promise<boolean> => {
      if (saveInFlight.current) return saveInFlight.current;
      const pending = (async () => {
        // Drain edits made during a write before navigation can unmount this editor.
        while (!noteDraftValuesEqual(draftRef.current, baselineRef.current) || !createdRef.current) {
          const snapshot = draftRef.current;
          if (!createdRef.current && (!snapshot.title.trim() || snapshot.title.trim() === "Untitled note") && !snapshot.body.trim() && snapshot.tags.length === 0) return true;
          if (!await onPersist(note.id, snapshot).catch(() => false)) return false;
          createdRef.current = true;
          baselineRef.current = snapshot;
          update({ dirty: !noteDraftValuesEqual(draftRef.current, snapshot) });
        }
        return true;
      })();
      saveInFlight.current = pending;
      try { return await pending; } finally { if (saveInFlight.current === pending) saveInFlight.current = null; }
    }, [note.id, onPersist, update]);

    useImperativeHandle(ref, () => ({ flush, getDraft: () => draftRef.current, settle: async () => { await saveInFlight.current; } }), [flush]);

    function patchDraft(partial: Partial<NoteDraftValue>): void {
      const next = { ...draftRef.current, ...partial };
      draftRef.current = next;
      setValue(next);
      onDraftChange(note.id, next);
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
        <fieldset className="grid min-w-0 gap-3">
          <EmojiInput
            aria-label="Note title"
            autoFocus={createMode}
            onValueChange={(title) => patchDraft({ title })}
            value={value.title}
          />

          {createMode && templates.length > 0 ? (
            <label className="grid gap-1 text-[var(--text-sm)] font-medium text-text-secondary">
              Template
              <Select
                aria-label="Note template"
                className="h-9 rounded-hcbMd border border-border bg-surface-0 px-3 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onValueChange={(value) => applyTemplate(value)}
                value={selectedTemplateId}
              >
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </Select>
            </label>
          ) : null}

          <details className="text-sm text-text-muted"><summary className="cursor-pointer py-1">Tags and properties</summary>
          <TagInput onChange={(tags) => patchDraft({ tags })} value={value.tags} />
          <AutoTagAudit
            input={{
              kind: "note",
              title: value.title,
              body: value.body,
              existingTags: value.tags
            }}
            rules={rules}
          />

          </details>

          <MarkdownEditor className="document-markdown" aria-label="Note body" onValueChange={(body) => patchDraft({ body })} showControls={false} value={value.body} />

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
