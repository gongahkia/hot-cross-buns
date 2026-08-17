import { useEffect, useMemo, useRef, useState } from "react";

import {
  calendarResultKind,
  type CalendarSearchDocument,
  type CalendarSearchHit,
  searchCalendarHistory,
  searchScore
} from "@/features/calendarSearch";
import {
  includesResultType,
  matchesEventFilters,
  matchesTaskFilters,
  parsePaletteQuery,
  type ParsedPaletteQuery
} from "@/features/paletteFilters";
import type { GoogleCalendarEvent, GoogleDriveFile, GoogleTask, SavedSearch, TaskMetadata, WorkspaceSnapshot } from "@/types";

export type PaletteAction =
  | { readonly type: "navigate"; readonly view: "tasks" | "calendar" | "settings" }
  | { readonly type: "sync" }
  | { readonly type: "refresh-tasks" }
  | { readonly type: "quick-capture" }
  | { readonly type: "new-task" }
  | { readonly type: "new-event" }
  | { readonly type: "find-time" }
  | { readonly type: "manage-calendars" }
  | { readonly type: "open-task"; readonly task: GoogleTask }
  | { readonly type: "open-event"; readonly event: GoogleCalendarEvent }
  | { readonly type: "open-drive-file"; readonly file: GoogleDriveFile };

interface CommandPaletteProps {
  readonly open: boolean;
  readonly workspace: WorkspaceSnapshot;
  readonly busy: boolean;
  readonly taskMetadata?: readonly TaskMetadata[];
  readonly savedSearches?: readonly SavedSearch[];
  saveSearch?(name: string, query: string): Promise<void>;
  deleteSearch?(id: string): Promise<void>;
  readonly calendarHistory?: CalendarHistory;
  readonly driveHistory?: DriveHistory;
  readonly close: () => void;
  readonly run: (action: PaletteAction) => void;
}

export interface CalendarHistory {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly documents: readonly CalendarSearchDocument[];
}

export interface DriveHistory {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly files: readonly GoogleDriveFile[];
}

const emptyCalendarHistory: CalendarHistory = { status: "idle", documents: [] };
const emptyDriveHistory: DriveHistory = { status: "idle", files: [] };

interface PaletteItem {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly score: number;
  readonly action: PaletteAction | "deep-search";
}

function actionItems(busy: boolean): PaletteItem[] {
  return [
    { id: "go-tasks", title: "Go to Tasks", detail: "Navigation", score: 0, action: { type: "navigate", view: "tasks" } },
    { id: "go-calendar", title: "Go to Calendar", detail: "Navigation", score: 1, action: { type: "navigate", view: "calendar" } },
    { id: "go-settings", title: "Go to Settings", detail: "Navigation", score: 2, action: { type: "navigate", view: "settings" } },
    { id: "new-task", title: "New task", detail: "Action", score: 3, action: { type: "new-task" } },
    { id: "quick-capture", title: "Quick capture", detail: "Parse a task or event before creating it", score: 4, action: { type: "quick-capture" } },
    { id: "new-event", title: "New event", detail: "Action", score: 5, action: { type: "new-event" } },
    { id: "find-time", title: "Find a free time", detail: "Calendar action", score: 6, action: { type: "find-time" } },
    { id: "manage-calendars", title: "Manage calendars", detail: "Calendar action", score: 7, action: { type: "manage-calendars" } },
    { id: "sync", title: "Sync now", detail: busy ? "Currently syncing" : "Action", score: 8, action: { type: "sync" } },
    { id: "refresh-tasks", title: "Refresh all Tasks from Google", detail: "Rebuilds this browser's task cache", score: 9, action: { type: "refresh-tasks" } }
  ];
}

function eventDateLabel(event: GoogleCalendarEvent): string {
  const value = event.originalStartTime ?? event.start;
  if (value.date) {
    return new Date(`${value.date}T00:00:00`).toLocaleDateString();
  }
  return value.dateTime ? new Date(value.dateTime).toLocaleString() : "No date";
}

function taskDueLabel(task: GoogleTask): string {
  if (!task.due) {
    return "No due date";
  }
  const due = new Date(task.due);
  return Number.isNaN(due.valueOf()) ? "Due date unavailable" : `Due ${due.toLocaleDateString()}`;
}

function calendarDetail(accessRole: string | undefined): string {
  if (!accessRole) {
    return "Calendar";
  }
  const access = accessRole === "freeBusyReader" ? "Availability only" : `${accessRole[0]?.toUpperCase()}${accessRole.slice(1)}`;
  return `Calendar · ${access}`;
}

function driveTypeLabel(mimeType: string | undefined): string {
  switch (mimeType) {
    case "application/vnd.google-apps.document":
      return "Google Doc";
    case "application/vnd.google-apps.spreadsheet":
      return "Google Sheet";
    case "application/vnd.google-apps.presentation":
      return "Google Slides";
    case "application/vnd.google-apps.folder":
      return "Drive folder";
    default:
      return mimeType?.split("/").at(-1) ?? "Drive file";
  }
}

function resultScore(title: string, body: string, parsed: ParsedPaletteQuery, deepSearch: boolean): number | undefined {
  if (!parsed.text) {
    return 500;
  }
  const titleScore = searchScore(title, parsed.text);
  if (titleScore !== undefined) {
    return titleScore;
  }
  if (!deepSearch) {
    return undefined;
  }
  const bodyScore = searchScore(body, parsed.text);
  return bodyScore === undefined ? undefined : 1_000 + bodyScore;
}

function searchableItems(
  workspace: WorkspaceSnapshot,
  parsed: ParsedPaletteQuery,
  deepSearch: boolean,
  canonicalEventIds: ReadonlySet<string>,
  driveFiles: readonly GoogleDriveFile[],
  taskMetadata: readonly TaskMetadata[]
): PaletteItem[] {
  const taskLists = new Map(workspace.taskLists.map((list) => [list.id, list.title]));
  const calendars = new Map(workspace.calendars.map((calendar) => [calendar.id, calendar.summary]));
  const metadata = new Map(taskMetadata.map((entry) => [entry.taskId, entry]));
  const items: PaletteItem[] = [];
  for (const task of workspace.tasks) {
    if (!matchesTaskFilters(task, parsed.filters, undefined, metadata.get(task.id), taskLists.get(task.listId))) {
      continue;
    }
    const title = task.title || "Untitled task";
    const score = resultScore(title, task.notes ?? "", parsed, deepSearch);
    if (score !== undefined) {
      items.push({
        id: `task:${task.listId}:${task.id}`,
        title,
        detail: `Task · ${taskLists.get(task.listId) ?? "Unknown list"} · ${taskDueLabel(task)} · ${task.status === "completed" ? "Completed" : "Open"}`,
        score,
        action: { type: "open-task", task }
      });
    }
  }
  for (const event of workspace.events) {
    if (canonicalEventIds.has(`${event.calendarId}:${event.id}`) || !matchesEventFilters(event, parsed.filters, calendars.get(event.calendarId))) {
      continue;
    }
    const title = event.summary || "Untitled event";
    const score = resultScore(title, `${event.description ?? ""}\n${event.location ?? ""}`, parsed, deepSearch);
    if (score !== undefined) {
      items.push({
        id: `event:${event.calendarId}:${event.id}`,
        title,
        detail: `Event · ${calendars.get(event.calendarId) ?? "Unknown calendar"} · ${eventDateLabel(event)}`,
        score,
        action: { type: "open-event", event }
      });
    }
  }
  if (includesResultType(parsed.filters, "calendar")) {
    for (const calendar of workspace.calendars) {
      const score = resultScore(calendar.summary, calendar.description ?? "", parsed, deepSearch);
      if (score !== undefined) {
        items.push({ id: `calendar:${calendar.id}`, title: calendar.summary, detail: calendarDetail(calendar.accessRole), score, action: { type: "navigate", view: "calendar" } });
      }
    }
  }
  if (parsed.filters.types.length === 0) {
    for (const list of workspace.taskLists) {
      const score = resultScore(list.title, "", parsed, false);
      if (score !== undefined) {
        items.push({ id: `list:${list.id}`, title: list.title, detail: "Task list", score, action: { type: "navigate", view: "tasks" } });
      }
    }
  }
  if (includesResultType(parsed.filters, "drive")) {
    for (const file of driveFiles) {
      if (!file.webViewLink) {
        continue;
      }
      const score = resultScore(file.name, `${file.mimeType ?? ""}\n${file.webViewLink ?? ""}`, parsed, deepSearch);
      if (score !== undefined) {
        items.push({
          id: `drive:${file.id}`,
          title: file.name || "Untitled Drive file",
          detail: `Drive · ${driveTypeLabel(file.mimeType)} · Open in Drive`,
          score,
          action: { type: "open-drive-file", file }
        });
      }
    }
  }
  return items;
}

export function CommandPalette({
  open,
  workspace,
  busy,
  calendarHistory = emptyCalendarHistory,
  driveHistory = emptyDriveHistory,
  taskMetadata = [],
  savedSearches = [],
  saveSearch,
  deleteSearch,
  close,
  run
}: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = useState("");
  const [deepSearch, setDeepSearch] = useState(false);
  const [selected, setSelected] = useState(0);
  const [historyHits, setHistoryHits] = useState<readonly CalendarSearchHit[]>([]);
  const [historyIndexed, setHistoryIndexed] = useState(false);
  const [limit, setLimit] = useState(12);
  const [saveName, setSaveName] = useState("");
  const [saveSearchOpen, setSaveSearchOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | undefined>(undefined);
  const indexGenerationRef = useRef(0);
  const searchRequestRef = useRef(0);
  const parsedQuery = useMemo(() => parsePaletteQuery(query), [query]);
  const calendarNames = useMemo(
    () => Object.fromEntries(workspace.calendars.map((calendar) => [calendar.id, calendar.summary])),
    [workspace.calendars]
  );

  useEffect(() => {
    if (typeof Worker === "undefined") {
      return;
    }
    const worker = new Worker(new URL("../workers/calendarSearchWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{
      readonly type: "indexed" | "results";
      readonly generation?: number;
      readonly requestId?: number;
      readonly hits?: readonly CalendarSearchHit[];
    }>) => {
      if (event.data.type === "indexed" && event.data.generation === indexGenerationRef.current) {
        setHistoryIndexed(true);
      }
      if (event.data.type === "results" && event.data.requestId === searchRequestRef.current) {
        setHistoryHits(event.data.hits ?? []);
      }
    };
    return () => {
      worker.terminate();
      workerRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    setHistoryHits([]);
    if (calendarHistory.status !== "ready") {
      setHistoryIndexed(false);
      return;
    }
    const worker = workerRef.current;
    if (!worker) {
      setHistoryIndexed(true);
      return;
    }
    const generation = indexGenerationRef.current + 1;
    indexGenerationRef.current = generation;
    setHistoryIndexed(false);
    worker.postMessage({ type: "index", generation, documents: calendarHistory.documents });
  }, [calendarHistory.documents, calendarHistory.status]);

  useEffect(() => {
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setHistoryHits([]);
    const shouldSearch = open
      && calendarHistory.status === "ready"
      && historyIndexed
      && includesResultType(parsedQuery.filters, "event")
      && (Boolean(parsedQuery.text) || parsedQuery.hasFilters);
    if (!shouldSearch) {
      return;
    }
    const timer = window.setTimeout(() => {
      const worker = workerRef.current;
      if (worker) {
        worker.postMessage({
          type: "search",
          requestId,
          query: parsedQuery.text,
          includeBody: deepSearch || Boolean(parsedQuery.searchBody),
          filters: parsedQuery.filters,
          calendarNames
        });
      } else {
        setHistoryHits(searchCalendarHistory(
          calendarHistory.documents,
          parsedQuery.text,
          deepSearch || Boolean(parsedQuery.searchBody),
          24,
          parsedQuery.filters,
          calendarNames
        ));
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [calendarHistory.documents, calendarHistory.status, calendarNames, deepSearch, historyIndexed, open, parsedQuery]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setDeepSearch(false);
      setSelected(0);
      setLimit(12);
      setSaveSearchOpen(false);
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  const canonicalEventIds = useMemo(
    () => new Set(calendarHistory.documents.map((document) => document.id)),
    [calendarHistory.documents]
  );

  const items = useMemo(() => {
    const commands = actionItems(busy);
    if (!query.trim()) {
      return commands;
    }
    const commandsMatching = parsedQuery.filters.types.length === 0 && !parsedQuery.filters.calendarQuery && !parsedQuery.filters.due && parsedQuery.filters.completed === undefined && !parsedQuery.filters.date
      ? commands.flatMap((item) => {
          const score = resultScore(item.title, item.detail, parsedQuery, false);
          return score === undefined ? [] : [{ ...item, score }];
        })
      : [];
    const results = searchableItems(workspace, parsedQuery, deepSearch || Boolean(parsedQuery.searchBody), canonicalEventIds, driveHistory.files, taskMetadata);
    const calendars = new Map(workspace.calendars.map((calendar) => [calendar.id, calendar.summary]));
    for (const hit of historyHits) {
      const event = hit.document.event;
      if (!matchesEventFilters(event, parsedQuery.filters, calendars.get(event.calendarId))) {
        continue;
      }
      results.push({
        id: `history-event:${hit.document.id}`,
        title: hit.document.title,
        detail: `${calendarResultKind(event)} · ${calendars.get(event.calendarId) ?? "Unknown calendar"} · ${eventDateLabel(event)}`,
        score: hit.score,
        action: { type: "open-event", event }
      });
    }
    if (!deepSearch && !parsedQuery.searchBody && parsedQuery.text) {
      results.push({
        id: "deep-search",
        title: `Search notes and descriptions for “${parsedQuery.text}”`,
        detail: "Continue search",
        score: 900,
        action: "deep-search"
      });
    }
    return [...commandsMatching, ...results]
      .sort((left, right) => left.score - right.score || left.title.localeCompare(right.title))
      .slice(0, limit);
  }, [busy, canonicalEventIds, deepSearch, driveHistory.files, historyHits, limit, parsedQuery, query, taskMetadata, workspace]);

  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);

  if (!open) {
    return null;
  }

  function choose(item: PaletteItem | undefined): void {
    if (!item) {
      return;
    }
    if (item.action === "deep-search") {
      setDeepSearch(true);
      setSelected(0);
      return;
    }
    close();
    run(item.action);
  }

  function trapFocus(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((current) => Math.min(current + 1, Math.max(0, items.length - 1)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(items[selected]);
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
    if (!focusable || focusable.length === 0) {
      return;
    }
    const currentIndex = [...focusable].indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1);
    event.preventDefault();
    focusable[nextIndex]?.focus();
  }

  return (
    <div className="modal-backdrop command-palette-backdrop" role="presentation">
      <section ref={dialogRef} className="modal-card command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-heading" onKeyDown={trapFocus}>
        <div className="panel-heading">
          <div><p className="eyebrow">Workspace</p><h2 id="command-palette-heading">Command palette</h2></div>
          <button type="button" onClick={close}>Close</button>
        </div>
        <label className="palette-search">
          <span>Search cached work and commands</span>
          <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setDeepSearch(false); setSelected(0); }} placeholder="Search tasks, events, calendars, Drive, or commands" />
        </label>
        {saveSearch && query.trim() && <details className="saved-search-control" open={saveSearchOpen} onToggle={(event) => setSaveSearchOpen(event.currentTarget.open)}><summary>Save this search</summary><div className="saved-search-create"><input aria-label="Saved search name" value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Name this search" /><button type="button" disabled={!saveName.trim()} onClick={() => { void saveSearch(saveName, query).then(() => { setSaveName(""); setSaveSearchOpen(false); }); }}>Save</button></div></details>}
        {savedSearches.length > 0 && <div className="saved-searches" aria-label="Saved searches">{savedSearches.map((search) => <span key={search.id}><button type="button" onClick={() => { setQuery(search.query); setDeepSearch(false); setSelected(0); }}>{search.name}</button>{deleteSearch && <button type="button" aria-label={`Delete saved search ${search.name}`} onClick={() => void deleteSearch(search.id)}>×</button>}</span>)}</div>}
        <p className="field-help">Calendar and Drive results are browser-local; Drive results use metadata already cached after Drive authorization and an attachment search.</p>
        {calendarHistory.status === "loading" && <p className="field-help" role="status">Indexing your synced Calendar history…</p>}
        {calendarHistory.status === "error" && <p className="field-help" role="status">Calendar history is unavailable until the next successful sync.</p>}
        {driveHistory.status === "loading" && <p className="field-help" role="status">Loading cached Drive metadata…</p>}
        {driveHistory.status === "error" && <p className="field-help" role="status">Cached Drive metadata is unavailable in this browser session.</p>}
        <ul className="palette-results" role="listbox" aria-label="Command palette results">
          {items.map((item, index) => (
            <li key={item.id} role="option" aria-selected={selected === index}>
              <button className={selected === index ? "active" : ""} type="button" onMouseMove={() => setSelected(index)} onClick={() => choose(item)}>
                <strong>{item.title}</strong><span>{item.detail}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="empty-state">No cached results. Try a shorter title, a different filter, or continue into notes.</li>}
        </ul>
        {items.length >= limit && <button type="button" onClick={() => setLimit((current) => current + 24)}>More results</button>}
      </section>
    </div>
  );
}
