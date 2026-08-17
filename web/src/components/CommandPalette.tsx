import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CalendarDays, CheckSquare2, ChevronRight, FileText, ListTodo, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { LoadingState } from "@/components/LoadingState";
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
import type { GoogleCalendarEvent, GoogleDriveFile, GoogleTask, TaskMetadata, WorkspaceSnapshot } from "@/types";

export type PaletteAction =
  | { readonly type: "navigate"; readonly view: "tasks" | "calendar" }
  | { readonly type: "open-task"; readonly task: GoogleTask }
  | { readonly type: "open-event"; readonly event: GoogleCalendarEvent }
  | { readonly type: "open-drive-file"; readonly file: GoogleDriveFile };

interface CommandPaletteProps {
  readonly open: boolean;
  readonly workspace: WorkspaceSnapshot;
  readonly taskMetadata?: readonly TaskMetadata[];
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

function paletteItemIcon(item: PaletteItem): ReactNode {
  if (item.action === "deep-search") return <Search />;
  switch (item.action.type) {
    case "navigate":
      return item.action.view === "calendar" ? <CalendarDays /> : <ListTodo />;
    case "open-task":
      return <CheckSquare2 />;
    case "open-event":
      return <CalendarDays />;
    case "open-drive-file":
      return <FileText />;
  }
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
  calendarHistory = emptyCalendarHistory,
  driveHistory = emptyDriveHistory,
  taskMetadata = [],
  close,
  run
}: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = useState("");
  const [deepSearch, setDeepSearch] = useState(false);
  const [selected, setSelected] = useState(0);
  const [historyHits, setHistoryHits] = useState<readonly CalendarSearchHit[]>([]);
  const [historyIndexed, setHistoryIndexed] = useState(false);
  const [historySearching, setHistorySearching] = useState(false);
  const [limit, setLimit] = useState(12);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hoveredResult, setHoveredResult] = useState<number>();
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | undefined>(undefined);
  const loadMoreTimerRef = useRef<number | undefined>(undefined);
  const indexGenerationRef = useRef(0);
  const searchRequestRef = useRef(0);
  const reducedMotion = useReducedMotion();
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
        setHistorySearching(false);
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
      setHistorySearching(false);
      return;
    }
    setHistorySearching(true);
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
        setHistorySearching(false);
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
      setLoadingMore(false);
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => () => {
    if (loadMoreTimerRef.current !== undefined) {
      window.clearTimeout(loadMoreTimerRef.current);
    }
  }, []);

  const canonicalEventIds = useMemo(
    () => new Set(calendarHistory.documents.map((document) => document.id)),
    [calendarHistory.documents]
  );

  const allItems = useMemo(() => {
    if (!query.trim()) {
      return [];
    }
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
    return results.sort((left, right) => left.score - right.score || left.title.localeCompare(right.title));
  }, [canonicalEventIds, deepSearch, driveHistory.files, historyHits, parsedQuery, query, taskMetadata, workspace]);

  const items = useMemo(() => allItems.slice(0, limit), [allItems, limit]);
  const hasMoreResults = items.length < allItems.length;

  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);

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

  function requestMoreResults(): void {
    if (!hasMoreResults || loadingMore) {
      return;
    }
    setLoadingMore(true);
    loadMoreTimerRef.current = window.setTimeout(() => {
      setLimit((current) => Math.min(current + 24, allItems.length));
      setLoadingMore(false);
      loadMoreTimerRef.current = undefined;
    }, 120);
  }

  function handleResultScroll(event: React.UIEvent<HTMLDivElement>): void {
    const container = event.currentTarget;
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 48) {
      requestMoreResults();
    }
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

  const spotlightItem = hoveredResult === undefined ? undefined : items[hoveredResult];
  const placeholder = spotlightItem?.title ?? "Search tasks, events, calendars, or Drive";
  const transition = { type: "spring" as const, stiffness: 550, damping: 50 };

  return <AnimatePresence mode="wait">
    {open && <motion.div
      className="modal-backdrop command-palette-backdrop"
      role="presentation"
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, filter: "blur(16px)", scaleX: 1.04, scaleY: 1.02, y: -10 }}
      animate={{ opacity: 1, filter: "blur(0px)", scaleX: 1, scaleY: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, filter: "blur(16px)", scaleX: 1.04, scaleY: 1.02, y: 10 }}
      transition={transition}
      onClick={close}
    >
      <svg className="spotlight-filter" aria-hidden="true"><filter id="hcb-spotlight-blob"><feGaussianBlur stdDeviation="10" in="SourceGraphic" /><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 18 -9" result="blob" /><feBlend in="SourceGraphic" in2="blob" /></filter></svg>
      <div className="spotlight-cluster" style={{ filter: "url(#hcb-spotlight-blob)" }} onMouseLeave={() => setHoveredResult(undefined)} onClick={(event) => event.stopPropagation()}>
        <motion.section layout="position" ref={dialogRef} className="modal-card command-palette spotlight-card" role="dialog" aria-modal="true" aria-labelledby="command-palette-heading" onKeyDown={trapFocus}>
          <h2 id="command-palette-heading" className="visually-hidden">Command palette</h2>
          <div className="spotlight-input-row">
            <Search className="spotlight-search-icon" aria-hidden="true" />
            <label className="visually-hidden" htmlFor="command-palette-search">Search cached work</label>
            <div className="spotlight-query-wrap">
              {(!query || spotlightItem) && <motion.p key={placeholder} className="spotlight-placeholder" initial={reducedMotion ? false : { opacity: 0, y: 8, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={reducedMotion ? undefined : { opacity: 0, y: -8, filter: "blur(4px)" }} transition={{ duration: 0.18 }} aria-hidden="true">{placeholder}</motion.p>}
              <input id="command-palette-search" ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setDeepSearch(false); setSelected(0); setLimit(12); setLoadingMore(false); setHoveredResult(undefined); }} autoComplete="off" />
            </div>
            <button className="spotlight-close" type="button" aria-label="Close command palette" title="Close command palette" onClick={close}><X aria-hidden="true" /></button>
          </div>
          <AnimatePresence initial={false}>
            {query.trim() && <motion.div className="spotlight-results-container" initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }} transition={{ duration: 0.18 }} onScroll={handleResultScroll}>
              {calendarHistory.status === "loading" && <LoadingState label="Indexing synced Calendar history" variant="Dots" className="inline-loader" />}
              {calendarHistory.status === "error" && <p className="field-help" role="status">Calendar history is unavailable until the next successful sync.</p>}
              {driveHistory.status === "loading" && <LoadingState label="Loading cached Drive metadata" variant="Dots" className="inline-loader" />}
              {driveHistory.status === "error" && <p className="field-help" role="status">Cached Drive metadata is unavailable in this browser session.</p>}
              {(historySearching || loadingMore) && <LoadingState label={loadingMore ? "Loading more results" : "Searching cached work"} variant="Drive" className="inline-loader palette-loading" />}
              <ul className="palette-results spotlight-results" role="listbox" aria-label="Command palette results">
                {items.map((item, index) => <motion.li key={item.id} role="option" aria-selected={selected === index} initial={false} animate={{ opacity: 1 }} exit={reducedMotion ? undefined : { opacity: 0 }} transition={{ delay: Math.min(index, 8) * 0.035, duration: 0.16 }} onMouseEnter={() => { setSelected(index); setHoveredResult(index); }}>
                  <button className={selected === index ? "active" : ""} type="button" onClick={() => choose(item)}>
                    <span className="spotlight-result-icon" aria-hidden="true">{paletteItemIcon(item)}</span><span className="spotlight-result-copy"><strong>{item.title}</strong><span>{item.detail}</span></span><ChevronRight className="spotlight-result-chevron" aria-hidden="true" />
                  </button>
                </motion.li>)}
                {items.length === 0 && !historySearching && calendarHistory.status !== "loading" && driveHistory.status !== "loading" && <li className="empty-state">No cached results. Try a shorter title, a different filter, or continue into notes.</li>}
              </ul>
            </motion.div>}
          </AnimatePresence>
        </motion.section>
      </div>
    </motion.div>}
  </AnimatePresence>;
}
