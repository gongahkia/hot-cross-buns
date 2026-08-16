import { useEffect, useMemo, useRef, useState } from "react";

import type { GoogleCalendarEvent, GoogleTask, WorkspaceSnapshot } from "@/types";

export type PaletteAction =
  | { readonly type: "navigate"; readonly view: "tasks" | "calendar" | "settings" }
  | { readonly type: "sync" }
  | { readonly type: "new-task" }
  | { readonly type: "new-event" }
  | { readonly type: "find-time" }
  | { readonly type: "manage-calendars" }
  | { readonly type: "open-task"; readonly task: GoogleTask }
  | { readonly type: "open-event"; readonly event: GoogleCalendarEvent };

interface CommandPaletteProps {
  readonly open: boolean;
  readonly workspace: WorkspaceSnapshot;
  readonly busy: boolean;
  readonly close: () => void;
  readonly run: (action: PaletteAction) => void;
}

interface PaletteItem {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly score: number;
  readonly action: PaletteAction | "deep-search";
}

function titleScore(value: string, query: string): number | undefined {
  const source = value.toLocaleLowerCase();
  const target = query.toLocaleLowerCase();
  if (source === target) {
    return 0;
  }
  if (source.startsWith(target)) {
    return 10 + source.length - target.length;
  }
  const containedAt = source.indexOf(target);
  if (containedAt >= 0) {
    return 100 + containedAt;
  }
  let cursor = 0;
  for (const character of source) {
    if (character === target[cursor]) {
      cursor += 1;
    }
    if (cursor === target.length) {
      return 300 + source.length;
    }
  }
  return undefined;
}

function actionItems(busy: boolean): PaletteItem[] {
  return [
    { id: "go-tasks", title: "Go to Tasks", detail: "Navigation", score: 0, action: { type: "navigate", view: "tasks" } },
    { id: "go-calendar", title: "Go to Calendar", detail: "Navigation", score: 1, action: { type: "navigate", view: "calendar" } },
    { id: "go-settings", title: "Go to Settings", detail: "Navigation", score: 2, action: { type: "navigate", view: "settings" } },
    { id: "new-task", title: "New task", detail: "Action", score: 3, action: { type: "new-task" } },
    { id: "new-event", title: "New event", detail: "Action", score: 4, action: { type: "new-event" } },
    { id: "find-time", title: "Find a free time", detail: "Calendar action", score: 5, action: { type: "find-time" } },
    { id: "manage-calendars", title: "Manage calendars", detail: "Calendar action", score: 6, action: { type: "manage-calendars" } },
    { id: "sync", title: "Sync now", detail: busy ? "Currently syncing" : "Action", score: 7, action: { type: "sync" } }
  ];
}

function searchableItems(workspace: WorkspaceSnapshot, query: string, deepSearch: boolean): PaletteItem[] {
  const taskLists = new Map(workspace.taskLists.map((list) => [list.id, list.title]));
  const calendars = new Map(workspace.calendars.map((calendar) => [calendar.id, calendar.summary]));
  const items: PaletteItem[] = [];
  for (const task of workspace.tasks) {
    const title = task.title || "Untitled task";
    const score = titleScore(title, query) ?? (deepSearch ? titleScore(task.notes ?? "", query) : undefined);
    if (score !== undefined) {
      items.push({
        id: `task:${task.listId}:${task.id}`,
        title,
        detail: `Task · ${taskLists.get(task.listId) ?? "Unknown list"}${task.status === "completed" ? " · Completed" : ""}`,
        score,
        action: { type: "open-task", task }
      });
    }
  }
  for (const event of workspace.events) {
    const title = event.summary || "Untitled event";
    const searchBody = `${event.description ?? ""}\n${event.location ?? ""}`;
    const score = titleScore(title, query) ?? (deepSearch ? titleScore(searchBody, query) : undefined);
    if (score !== undefined) {
      items.push({
        id: `event:${event.calendarId}:${event.id}`,
        title,
        detail: `Event · ${calendars.get(event.calendarId) ?? "Unknown calendar"}`,
        score,
        action: { type: "open-event", event }
      });
    }
  }
  for (const list of workspace.taskLists) {
    const score = titleScore(list.title, query);
    if (score !== undefined) {
      items.push({ id: `list:${list.id}`, title: list.title, detail: "Task list", score, action: { type: "navigate", view: "tasks" } });
    }
  }
  for (const calendar of workspace.calendars) {
    const score = titleScore(calendar.summary, query);
    if (score !== undefined) {
      items.push({ id: `calendar:${calendar.id}`, title: calendar.summary, detail: "Calendar", score, action: { type: "navigate", view: "calendar" } });
    }
  }
  return items;
}

export function CommandPalette({ open, workspace, busy, close, run }: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = useState("");
  const [deepSearch, setDeepSearch] = useState(false);
  const [selected, setSelected] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setDeepSearch(false);
      setSelected(0);
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  const items = useMemo(() => {
    const normalized = query.trim();
    const commands = actionItems(busy);
    if (!normalized) {
      return commands;
    }
    const commandsMatching = commands.flatMap((item) => {
      const score = titleScore(item.title, normalized);
      return score === undefined ? [] : [{ ...item, score }];
    });
    const results = searchableItems(workspace, normalized, deepSearch);
    if (!deepSearch) {
      results.push({
        id: "deep-search",
        title: `Search notes and descriptions for “${normalized}”`,
        detail: "Continue search",
        score: 900,
        action: "deep-search"
      });
    }
    return [...commandsMatching, ...results].sort((left, right) => left.score - right.score || left.title.localeCompare(right.title)).slice(0, 12);
  }, [busy, deepSearch, query, workspace]);

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
          <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setDeepSearch(false); setSelected(0); }} placeholder="Search tasks, events, calendars, or commands" />
        </label>
        <p className="field-help">Use ↑ ↓ to move, Enter to open, and Escape to close. Search is browser-local.</p>
        <ul className="palette-results" role="listbox" aria-label="Command palette results">
          {items.map((item, index) => (
            <li key={item.id} role="option" aria-selected={selected === index}>
              <button className={selected === index ? "active" : ""} type="button" onMouseMove={() => setSelected(index)} onClick={() => choose(item)}>
                <strong>{item.title}</strong><span>{item.detail}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="empty-state">No cached results. Try a shorter title or continue into notes.</li>}
        </ul>
      </section>
    </div>
  );
}
