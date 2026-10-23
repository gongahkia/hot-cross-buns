import { Select, SelectItem } from "@renderer/components/Select";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CalendarEventRecurrence, EventTemplate, TaskTemplate } from "@shared/ipc/contracts";
import { CalendarPlus, CheckSquare, FileText, Gift, Clock3, X, type LucideIcon } from "lucide-react";
import type { CoreViewModelSource } from "../features/core/coreViewModelSource";
import {
  firstHashHint,
  normalizeDestinationToken,
  parseQuickAddEvent,
  parseQuickAddTask,
  stripHashToken,
  toDateInput,
  type MatchedToken,
  type QuickAddMode
} from "../features/core/quickAdd/naturalLanguage";
import { zonedDateTimeIso } from "../features/core/screens/calendar/calendarDateUtils";
import { Badge, Button, IconButton, cx } from "./primitives";

export type QuickAddSubmitPayload =
  | {
      mode: "task";
      title: string;
      dueDate: string;
      listId: string;
      notes: string;
    }
  | {
      mode: "note";
      title: string;
      body: string;
      listId?: string;
    }
  | {
      mode: "event" | "birthday";
      allDay: boolean;
      calendarId: string;
      endsAt: string;
      guestEmails: string[];
      location: string;
      notes: string;
      recurrence: CalendarEventRecurrence | null;
      startsAt: string;
      timeZone?: string;
      title: string;
    };

interface QuickAddDialogProps {
  onClose: () => void;
  onSubmit: (payload: QuickAddSubmitPayload) => void;
  open: boolean;
  fromPalette?: boolean;
  source: CoreViewModelSource;
}

const modes: Array<{ id: QuickAddMode; label: string; icon: LucideIcon }> = [
  { id: "event", label: "Event", icon: CalendarPlus },
  { id: "task", label: "Task", icon: CheckSquare },
  { id: "note", label: "Note", icon: FileText },
  { id: "birthday", label: "Birthday", icon: Gift }
];

function addDays(value: Date, days: number): Date {
  const next = new Date(value.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

function toUtcWallClockIso(value: Date): string {
  return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), value.getMinutes())).toISOString();
}

function eventDateTimeIso(value: Date, timeZone: string | undefined): string {
  return timeZone
    ? zonedDateTimeIso(toDateInput(value), value.getHours(), value.getMinutes(), timeZone)
    : toUtcWallClockIso(value);
}

function mergedGuestEmails(...groups: ReadonlyArray<readonly string[]>): string[] {
  const seen = new Set<string>();
  const guests: string[] = [];

  for (const group of groups) {
    for (const value of group) {
      const email = value.trim().toLowerCase();

      if (email && !seen.has(email)) {
        seen.add(email);
        guests.push(email);
      }
    }
  }

  return guests;
}

function dateOnlyFromDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function templateTextFields(template: TaskTemplate | EventTemplate | null): string[] {
  if (!template) {
    return [];
  }

  if ("dueExpression" in template) {
    return [template.title, template.notes ?? "", template.dueExpression ?? ""];
  }

  return [
    template.title,
    template.notes ?? "",
    template.location ?? "",
    template.startExpression ?? "",
    template.endExpression ?? ""
  ];
}

function templatePromptLabels(template: TaskTemplate | EventTemplate | null): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const pattern = /{{\s*prompt:([^}]+)\s*}}/gi;

  for (const field of templateTextFields(template)) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;

    while ((match = pattern.exec(field)) !== null) {
      const label = (match[1] ?? "").trim();

      if (label && !seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
    }
  }

  return labels;
}

function templateUsesClipboard(template: TaskTemplate | EventTemplate | null): boolean {
  return templateTextFields(template).some((field) => /{{\s*clipboard\s*}}/i.test(field));
}

function expandTemplateText(
  value: string | null | undefined,
  context: { clipboardText: string; now: Date; promptValues: Record<string, string> }
): string {
  if (!value) {
    return "";
  }

  return value.replace(/{{\s*([^}]+)\s*}}/g, (_token, expression: string) => {
    const trimmed = expression.trim();
    const lower = trimmed.toLowerCase();

    if (lower === "today") {
      return dateOnlyFromDate(context.now);
    }

    if (lower === "clipboard") {
      return context.clipboardText;
    }

    const offset = /^\+(\d{1,3})d$/.exec(lower);

    if (offset) {
      return dateOnlyFromDate(addDays(context.now, Number(offset[1])));
    }

    if (lower.startsWith("prompt:")) {
      const label = trimmed.slice(trimmed.indexOf(":") + 1).trim();
      return context.promptValues[label] ?? "";
    }

    return "";
  }).trim();
}

function parseTemplateEventExpression(expression: string, now: Date): Date | null {
  return expression ? parseQuickAddEvent(`event ${expression}`, now).startDate : null;
}

function destinationMatch<T extends { id: string; title: string }>(
  destinations: readonly T[],
  hint: string | null
): T | null {
  const key = normalizeDestinationToken(hint ?? "");

  if (!key) {
    return null;
  }

  return destinations.find((destination) => normalizeDestinationToken(destination.title) === key) ??
    destinations.find((destination) => normalizeDestinationToken(destination.title).includes(key)) ??
    null;
}

function tokenLabel(token: MatchedToken): string {
  if (token.kind === "date" || token.kind === "time") {
    return token.display;
  }

  if (token.kind === "duration") {
    return token.display;
  }

  if (token.kind === "location") {
    return token.display;
  }

  if (token.kind === "list") {
    return token.display;
  }

  if (token.kind === "recurrence") {
    return token.display;
  }

  return token.kind === "allDay" ? "All-day" : token.display;
}

function eventTimeLabel(startsAt: Date | null, endsAt: Date | null, allDay: boolean): string {
  if (!startsAt) {
    return "No time";
  }

  if (allDay) {
    return startsAt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  const start = startsAt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

  if (!endsAt) {
    return start;
  }

  return `${start}-${endsAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export function QuickAddDialog({
  onClose,
  onSubmit,
  open,
  fromPalette = false,
  source
}: QuickAddDialogProps): JSX.Element | null {
  const [mode, setMode] = useState<QuickAddMode>("event");
  const [input, setInput] = useState("");
  const [selectedTaskListId, setSelectedTaskListId] = useState(source.taskLists[0]?.id ?? "");
  const [selectedCalendarId, setSelectedCalendarId] = useState(source.calendarSources.find(calendar => calendar.canWrite !== false)?.id ?? "");
  const [selectedNoteListId, setSelectedNoteListId] = useState(source.noteLists[0]?.id ?? "");
  const [selectedTaskTemplateId, setSelectedTaskTemplateId] = useState("");
  const [selectedEventTemplateId, setSelectedEventTemplateId] = useState("");
  const [templatePromptValues, setTemplatePromptValues] = useState<Record<string, string>>({});
  const [templateClipboardText, setTemplateClipboardText] = useState("");
  const [templateError, setTemplateError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const parsedTask = useMemo(() => parseQuickAddTask(input), [input]);
  const parsedEvent = useMemo(() => parseQuickAddEvent(input), [input]);
  const activeTaskTemplate = useMemo(
    () => source.settings.taskTemplates.find((template) => template.id === selectedTaskTemplateId) ?? null,
    [selectedTaskTemplateId, source.settings.taskTemplates]
  );
  const activeEventTemplate = useMemo(
    () => source.settings.eventTemplates.find((template) => template.id === selectedEventTemplateId) ?? null,
    [selectedEventTemplateId, source.settings.eventTemplates]
  );
  const activeTemplate = mode === "task" ? activeTaskTemplate : mode === "event" ? activeEventTemplate : null;
  const activeTemplatePrompts = useMemo(() => templatePromptLabels(activeTemplate), [activeTemplate]);
  const activeTemplateUsesClipboard = templateUsesClipboard(activeTemplate);
  const templateNow = useMemo(() => new Date(), [selectedTaskTemplateId, selectedEventTemplateId]);
  const templateTitle = expandTemplateText(activeTemplate?.title, {
    clipboardText: templateClipboardText,
    now: templateNow,
    promptValues: templatePromptValues
  });
  const templateNotes = expandTemplateText(activeTemplate && "notes" in activeTemplate ? activeTemplate.notes : null, {
    clipboardText: templateClipboardText,
    now: templateNow,
    promptValues: templatePromptValues
  });
  const templateTaskDueDate = activeTaskTemplate
    ? parseQuickAddTask(expandTemplateText(activeTaskTemplate.dueExpression, {
        clipboardText: templateClipboardText,
        now: templateNow,
        promptValues: templatePromptValues
      }), templateNow).dueDate
    : null;
  const templateEventStart = activeEventTemplate
    ? parseTemplateEventExpression(expandTemplateText(activeEventTemplate.startExpression, {
        clipboardText: templateClipboardText,
        now: templateNow,
        promptValues: templatePromptValues
      }), templateNow)
    : null;
  const templateEventEnd = activeEventTemplate
    ? parseTemplateEventExpression(expandTemplateText(activeEventTemplate.endExpression, {
        clipboardText: templateClipboardText,
        now: templateEventStart ?? templateNow,
        promptValues: templatePromptValues
      }), templateEventStart ?? templateNow)
    : null;
  const templateEventLocation = expandTemplateText(activeEventTemplate?.location, {
    clipboardText: templateClipboardText,
    now: templateNow,
    promptValues: templatePromptValues
  });
  const hashHint = firstHashHint(input);
  const matchedTaskList = destinationMatch(source.taskLists, parsedTask.taskListHint);
  const matchedCalendar = destinationMatch(source.calendarSources.filter(calendar => calendar.canWrite !== false), hashHint);
  const matchedNoteList = destinationMatch(source.noteLists, parsedTask.taskListHint);
  const templateTaskListId = source.taskLists.some((list) => list.id === activeTaskTemplate?.listId) ? activeTaskTemplate?.listId ?? "" : "";
  const templateCalendarId = source.calendarSources.some((calendar) => calendar.id === activeEventTemplate?.calendarId && calendar.canWrite !== false) ? activeEventTemplate?.calendarId ?? "" : "";
  const effectiveTaskListId = matchedTaskList?.id ?? (templateTaskListId || selectedTaskListId);
  const effectiveCalendarId = matchedCalendar?.id ?? (templateCalendarId || selectedCalendarId);
  const effectiveNoteListId = matchedNoteList?.id ?? selectedNoteListId;
  const eventTitle = stripHashToken(parsedEvent.summary, hashHint);
  const noteTitle = parsedTask.title || input.trim();
  const taskTitle = parsedTask.title;
  const effectiveTaskTitle = taskTitle || templateTitle;
  const effectiveEventTitle = eventTitle || (mode === "event" ? templateTitle : "");
  const title = mode === "event" || mode === "birthday" ? effectiveEventTitle : mode === "note" ? noteTitle : effectiveTaskTitle;
  const canSubmit =
    title.trim().length > 0 &&
    (mode === "event" || mode === "birthday" ? effectiveCalendarId.length > 0 : mode === "note" ? true : effectiveTaskListId.length > 0);

  useEffect(() => {
    if (!open) {
      return;
    }

    setInput("");
    setSelectedTaskTemplateId("");
    setSelectedEventTemplateId("");
    setTemplatePromptValues({});
    setTemplateClipboardText("");
    setTemplateError(null);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setSelectedTaskListId((current) => current || (source.taskLists[0]?.id ?? ""));
    setSelectedCalendarId((current) => source.calendarSources.some(calendar => calendar.id === current && calendar.canWrite !== false) ? current : (source.calendarSources.find(calendar => calendar.canWrite !== false)?.id ?? ""));
    setSelectedNoteListId((current) => current || (source.noteLists[0]?.id ?? ""));
  }, [source.calendarSources, source.noteLists, source.taskLists]);

  useEffect(() => {
    setTemplatePromptValues({});
    setTemplateClipboardText("");
    setTemplateError(null);
  }, [selectedTaskTemplateId, selectedEventTemplateId]);

  async function loadTemplateClipboard(): Promise<void> {
    setTemplateError(null);

    if (!navigator.clipboard?.readText) {
      setTemplateError("Clipboard access is unavailable.");
      return;
    }

    try {
      setTemplateClipboardText(await navigator.clipboard.readText());
    } catch {
      setTemplateError("Clipboard access was blocked.");
    }
  }

  function setTemplatePrompt(label: string, value: string): void {
    setTemplatePromptValues((current) => ({
      ...current,
      [label]: value
    }));
  }

  function submit(): void {
    if (!canSubmit) {
      return;
    }

    if (mode === "task") {
      onSubmit({
        mode,
        title: effectiveTaskTitle,
        dueDate: parsedTask.dueDate ?? templateTaskDueDate ?? "",
        listId: effectiveTaskListId,
        notes: templateNotes
      });
      return;
    }

    if (mode === "note") {
      onSubmit({
        mode,
        title: noteTitle,
        body: "",
        ...(effectiveNoteListId ? { listId: effectiveNoteListId } : {})
      });
      return;
    }

    const fallbackStart = new Date();
    const start = parsedEvent.startDate ?? templateEventStart ?? fallbackStart;
    const allDay = mode === "birthday" || parsedEvent.isAllDay;
    const timeZone = allDay ? undefined : parsedEvent.timeZone ?? undefined;
    let end = allDay
      ? addDays(new Date(start.getFullYear(), start.getMonth(), start.getDate()), 1)
      : parsedEvent.endDate ?? templateEventEnd ?? addMinutes(start, 60);

    if (!allDay && end <= start) {
      end = addDays(end, 1);
    }

    onSubmit({
      mode,
      title: effectiveEventTitle,
      calendarId: effectiveCalendarId,
      startsAt: allDay ? `${toDateInput(start)}T00:00:00.000Z` : eventDateTimeIso(start, timeZone),
      endsAt: allDay ? `${toDateInput(end)}T00:00:00.000Z` : eventDateTimeIso(end, timeZone),
      allDay,
      guestEmails: mergedGuestEmails(activeEventTemplate?.attendeeEmails ?? [], parsedEvent.guestEmails),
      location: mode === "birthday" ? "" : parsedEvent.location ?? templateEventLocation,
      notes: templateNotes,
      recurrence: mode === "birthday" ? null : parsedEvent.recurrence,
      ...(timeZone ? { timeZone } : {})
    });
  }

  const previewTokens = mode === "event" || mode === "birthday"
    ? parsedEvent.matchedTokens
    : parsedTask.matchedTokens;

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="quick-add-overlay" data-from-palette={fromPalette} />
        <Dialog.Content
          className="quick-add-dialog"
          data-from-palette={fromPalette}
          aria-describedby="quick-add-hint"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
        <header className="quick-add-header">
          <Dialog.Title className="quick-add-title">Quick Add</Dialog.Title>
          <IconButton icon={X} label="Close quick add" onClick={onClose} variant="ghost" className="size-7" />
        </header>

        <div className="quick-add-body">
          <div className="quick-add-modes" role="tablist" aria-label="Quick add type">
            {modes.map((candidate) => {
              const Icon = candidate.icon;
              const selected = mode === candidate.id;

              return (
                <button
                  aria-selected={selected}
                  className={cx("quick-add-mode", selected && "quick-add-mode-selected")}
                  tabIndex={selected ? 0 : -1}
                  onKeyDown={(event) => {
                    const index = modes.findIndex((item) => item.id === candidate.id);
                    const next = event.key === "ArrowRight" ? (index + 1) % modes.length
                      : event.key === "ArrowLeft" ? (index + modes.length - 1) % modes.length
                      : event.key === "Home" ? 0 : event.key === "End" ? modes.length - 1 : null;
                    if (next === null) return;
                    event.preventDefault();
                    setMode(modes[next].id);
                    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                    tabs?.[next]?.focus();
                  }}
                  key={candidate.id}
                  onClick={() => setMode(candidate.id)}
                  role="tab"
                  type="button"
                >
                  <Icon aria-hidden="true" size={14} />
                  {candidate.label}
                </button>
              );
            })}
          </div>

          <textarea
            aria-label="Quick add text"
            className="quick-add-input"
            rows={3}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={
              mode === "task"
                ? "What needs to get done?"
                : mode === "note"
                  ? "Capture a thought…"
                  : mode === "birthday"
                    ? "Whose birthday is coming up?"
                    : "What’s happening?"
            }
            ref={inputRef}
            value={input}
          />
          <p className="quick-add-hint" id="quick-add-hint">
            {mode === "task" ? "Try “Send the proposal tomorrow #Work”"
              : mode === "note" ? "Try “Ideas for the next launch #Notes”"
              : mode === "birthday" ? "Try “Maya Apr 25”"
              : "Try “Lunch tomorrow 1pm at Philz”"}
          </p>

          {mode === "task" && source.settings.taskTemplates.length > 0 ? (
            <Select
              aria-label="Task template"
              className="min-h-10 min-w-44 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onValueChange={(value) => setSelectedTaskTemplateId(value)}
              value={selectedTaskTemplateId}
            >
              <SelectItem value="">No template</SelectItem>
              {source.settings.taskTemplates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </Select>
          ) : null}

          {mode === "event" && source.settings.eventTemplates.length > 0 ? (
            <Select
              aria-label="Event template"
              className="min-h-10 min-w-44 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onValueChange={(value) => setSelectedEventTemplateId(value)}
              value={selectedEventTemplateId}
            >
              <SelectItem value="">No template</SelectItem>
              {source.settings.eventTemplates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </Select>
          ) : null}

          {activeTemplatePrompts.length > 0 || activeTemplateUsesClipboard || templateError ? (
            <div className="grid gap-2 rounded-hcbMd border border-border bg-bg-secondary p-2">
              {activeTemplatePrompts.map((label) => (
                <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary" key={label}>
                  <span>{label}</span>
                  <input
                    className="min-h-10 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    onChange={(event) => setTemplatePrompt(label, event.currentTarget.value)}
                    value={templatePromptValues[label] ?? ""}
                  />
                </label>
              ))}
              {activeTemplateUsesClipboard ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => void loadTemplateClipboard()} size="sm" variant="secondary">
                    Load clipboard
                  </Button>
                  {templateClipboardText ? <Badge tone="success">Clipboard loaded</Badge> : null}
                </div>
              ) : null}
              {templateError ? <div className="text-[var(--text-sm)] text-warning">{templateError}</div> : null}
            </div>
          ) : null}

          {input.trim() || activeTemplate ? (
            <div className="quick-add-preview" aria-label="Quick add preview" aria-live="polite">
              {title ? <span className="quick-add-preview-title">{title}</span> : null}
              <div className="quick-add-details">
                {mode === "event" || mode === "birthday" ? (
                  <span className="quick-add-detail"><Clock3 aria-hidden="true" size={12} />
                    {eventTimeLabel(parsedEvent.startDate ?? templateEventStart, parsedEvent.endDate ?? templateEventEnd, mode === "birthday" || parsedEvent.isAllDay)}
                  </span>
                ) : parsedTask.dueDate || templateTaskDueDate ? (
                  <span className="quick-add-detail"><Clock3 aria-hidden="true" size={12} />{parsedTask.dueDate ?? templateTaskDueDate}</span>
                ) : null}
                {previewTokens.filter((token) => !["date", "time", "list", "duration", "allDay"].includes(token.kind)).map((token, index) => (
                  <span className="quick-add-detail" key={`${token.kind}-${index}`}>{tokenLabel(token)}</span>
                ))}
              </div>
            </div>
          ) : null}
        </div>

          <footer className="quick-add-footer">
            {mode === "event" || mode === "birthday" ? (
              <Select
                aria-label="Quick add calendar"
                className="quick-add-destination"
                onValueChange={(value) => setSelectedCalendarId(value)}
                value={effectiveCalendarId}
              >
                {source.calendarSources.map((calendar) => (
                  <SelectItem disabled={calendar.canWrite === false} key={calendar.id} value={calendar.id}>
                    {calendar.title}{calendar.canWrite === false ? " (read-only)" : ""}
                  </SelectItem>
                ))}
              </Select>
            ) : mode === "note" ? (
              <Select
                aria-label="Quick add note list"
                className="quick-add-destination"
                onValueChange={(value) => setSelectedNoteListId(value)}
                value={effectiveNoteListId}
              >
                {source.noteLists.length === 0 ? <SelectItem value="">Notes</SelectItem> : null}
                {source.noteLists.map((list) => (
                  <SelectItem key={list.id} value={list.id}>
                    {list.title}
                  </SelectItem>
                ))}
              </Select>
            ) : (
              <Select
                aria-label="Quick add task list"
                className="quick-add-destination"
                onValueChange={(value) => setSelectedTaskListId(value)}
                value={effectiveTaskListId}
              >
                {source.taskLists.map((list) => (
                  <SelectItem key={list.id} value={list.id}>
                    {list.title}
                  </SelectItem>
                ))}
              </Select>
            )}
            <div className="quick-add-submit">
              <span className="quick-add-shortcut" aria-hidden="true">{navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} ↵</span>
              <Button disabled={!canSubmit} onClick={submit} variant="primary" size="sm">Add</Button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
