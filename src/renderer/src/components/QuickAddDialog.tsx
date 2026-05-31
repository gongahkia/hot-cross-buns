import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, CheckSquare, FileText, Gift, Search, X, type LucideIcon } from "lucide-react";
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
      location: string;
      notes: string;
      startsAt: string;
      title: string;
    };

interface QuickAddDialogProps {
  onClose: () => void;
  onSubmit: (payload: QuickAddSubmitPayload) => void;
  open: boolean;
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

  return "All-day";
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
  source
}: QuickAddDialogProps): JSX.Element | null {
  const [mode, setMode] = useState<QuickAddMode>("event");
  const [input, setInput] = useState("");
  const [selectedTaskListId, setSelectedTaskListId] = useState(source.taskLists[0]?.id ?? "");
  const [selectedCalendarId, setSelectedCalendarId] = useState(source.calendarSources[0]?.id ?? "");
  const [selectedNoteListId, setSelectedNoteListId] = useState(source.noteLists[0]?.id ?? "");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const parsedTask = useMemo(() => parseQuickAddTask(input), [input]);
  const parsedEvent = useMemo(() => parseQuickAddEvent(input), [input]);
  const hashHint = firstHashHint(input);
  const matchedTaskList = destinationMatch(source.taskLists, parsedTask.taskListHint);
  const matchedCalendar = destinationMatch(source.calendarSources, hashHint);
  const matchedNoteList = destinationMatch(source.noteLists, parsedTask.taskListHint);
  const effectiveTaskListId = matchedTaskList?.id ?? selectedTaskListId;
  const effectiveCalendarId = matchedCalendar?.id ?? selectedCalendarId;
  const effectiveNoteListId = matchedNoteList?.id ?? selectedNoteListId;
  const eventTitle = stripHashToken(parsedEvent.summary, hashHint);
  const noteTitle = parsedTask.title || input.trim();
  const taskTitle = parsedTask.title;
  const title = mode === "event" || mode === "birthday" ? eventTitle : mode === "note" ? noteTitle : taskTitle;
  const canSubmit =
    title.trim().length > 0 &&
    (mode === "event" || mode === "birthday" ? effectiveCalendarId.length > 0 : mode === "note" ? true : effectiveTaskListId.length > 0);

  useEffect(() => {
    if (!open) {
      return;
    }

    setInput("");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setSelectedTaskListId((current) => current || (source.taskLists[0]?.id ?? ""));
    setSelectedCalendarId((current) => current || (source.calendarSources[0]?.id ?? ""));
    setSelectedNoteListId((current) => current || (source.noteLists[0]?.id ?? ""));
  }, [source.calendarSources, source.noteLists, source.taskLists]);

  if (!open) {
    return null;
  }

  function submit(): void {
    if (!canSubmit) {
      return;
    }

    if (mode === "task") {
      onSubmit({
        mode,
        title: taskTitle,
        dueDate: parsedTask.dueDate ?? "",
        listId: effectiveTaskListId,
        notes: ""
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
    const start = parsedEvent.startDate ?? fallbackStart;
    const allDay = mode === "birthday" || parsedEvent.isAllDay;
    const end = allDay
      ? addDays(new Date(start.getFullYear(), start.getMonth(), start.getDate()), 1)
      : parsedEvent.endDate ?? addMinutes(start, 60);

    onSubmit({
      mode,
      title: eventTitle,
      calendarId: effectiveCalendarId,
      startsAt: allDay ? `${toDateInput(start)}T00:00:00.000Z` : toUtcWallClockIso(start),
      endsAt: allDay ? `${toDateInput(end)}T00:00:00.000Z` : toUtcWallClockIso(end),
      allDay,
      location: mode === "birthday" ? "" : parsedEvent.location ?? "",
      notes: ""
    });
  }

  const destinationLabel =
    mode === "event" || mode === "birthday"
      ? source.calendarSources.find((calendar) => calendar.id === effectiveCalendarId)?.title ?? "Calendar"
      : mode === "note"
        ? source.noteLists.find((list) => list.id === effectiveNoteListId)?.title ?? "Notes"
        : source.taskLists.find((list) => list.id === effectiveTaskListId)?.title ?? "Inbox";
  const previewTokens = mode === "event" || mode === "birthday"
    ? parsedEvent.matchedTokens
    : parsedTask.matchedTokens;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-bg-tertiary/45 px-4 pt-[12vh] backdrop-blur-sm"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      role="presentation"
    >
      <section
        aria-labelledby="quick-add-title"
        aria-modal="true"
        className="w-full max-w-[720px] overflow-hidden rounded-hcbLg border border-border bg-bg-primary shadow-2xl"
        role="dialog"
      >
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-bg-secondary px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Search aria-hidden="true" className="text-accent" size={17} />
            <h2 className="text-[var(--text-md)] font-semibold text-text-primary" id="quick-add-title">
              Quick add
            </h2>
          </div>
          <IconButton icon={X} label="Close quick add" onClick={onClose} variant="ghost" />
        </header>

        <div className="grid gap-3 p-3">
          <div className="inline-flex max-w-full overflow-hidden rounded-hcbMd border border-border bg-surface-0 p-1" role="tablist" aria-label="Quick add type">
            {modes.map((candidate) => {
              const Icon = candidate.icon;
              const selected = mode === candidate.id;

              return (
                <button
                  aria-selected={selected}
                  className={cx(
                    "inline-flex min-h-8 items-center gap-2 rounded-hcbSm px-3 text-[var(--text-sm)] font-medium transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    selected ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
                  )}
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
            className="min-h-24 resize-none rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-lg)] font-medium leading-snug text-text-primary placeholder:text-text-muted transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={
              mode === "task"
                ? "Email rent receipt tmr #Inbox"
                : mode === "note"
                  ? "Follow up on pricing #Notes"
                  : mode === "birthday"
                    ? "Maya Apr 25"
                    : "Lunch with Bob tomorrow 1pm at Philz #Product"
            }
            ref={inputRef}
            value={input}
          />

          <div className="flex min-h-8 flex-wrap items-center gap-2">
            {title ? (
              <Badge tone="neutral">{title}</Badge>
            ) : null}
            <Badge tone="accent">{destinationLabel}</Badge>
            {mode === "event" || mode === "birthday" ? (
              <Badge tone="info">
                {eventTimeLabel(parsedEvent.startDate, parsedEvent.endDate, mode === "birthday" || parsedEvent.isAllDay)}
              </Badge>
            ) : parsedTask.dueDate ? (
              <Badge tone="info">{parsedTask.dueDate}</Badge>
            ) : null}
            {previewTokens.map((token, index) => (
              <Badge key={`${token.kind}-${index}`} tone={token.kind === "location" ? "success" : "neutral"}>
                {tokenLabel(token)}
              </Badge>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            {mode === "event" || mode === "birthday" ? (
              <select
                aria-label="Quick add calendar"
                className="h-8 min-w-44 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onChange={(event) => setSelectedCalendarId(event.target.value)}
                value={effectiveCalendarId}
              >
                {source.calendarSources.map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.title}
                  </option>
                ))}
              </select>
            ) : mode === "note" ? (
              <select
                aria-label="Quick add note list"
                className="h-8 min-w-44 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onChange={(event) => setSelectedNoteListId(event.target.value)}
                value={effectiveNoteListId}
              >
                {source.noteLists.length === 0 ? <option value="">Notes</option> : null}
                {source.noteLists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.title}
                  </option>
                ))}
              </select>
            ) : (
              <select
                aria-label="Quick add task list"
                className="h-8 min-w-44 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onChange={(event) => setSelectedTaskListId(event.target.value)}
                value={effectiveTaskListId}
              >
                {source.taskLists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.title}
                  </option>
                ))}
              </select>
            )}
            <div className="flex items-center gap-2">
              <Button onClick={onClose} variant="ghost">
                Cancel
              </Button>
              <Button disabled={!canSubmit} onClick={submit} variant="primary">
                Add
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
