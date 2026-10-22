import { useEffect, useRef, useState } from "react";
import { CalendarSearch, Gift, ListTodo, X } from "lucide-react";
import { useInspector } from "./InspectorContext";
import { useCoreViewModelSource } from "../../features/core/coreViewModelSource";
import { useLocalSearch } from "../../features/core/viewModelSource/searchViewModels";
import { useCalendarEventInspector } from "../../features/core/screens/calendar/useCalendarEventInspector";
import { useTaskInspector } from "../../features/core/screens/tasks/useTaskInspector";
import { stableCalendarEventViewModel } from "../../features/core/viewModelSource/calendarViewModels";
import { calendarLocalPoint, calendarAddUtcDays, calendarDateTitleFromIso } from "../../features/core/screens/calendar/calendarGrid";
import { useCalendarNavigation } from "../../features/shell/CalendarNavigation";
import { displayAccelerator } from "../../features/core/hotkeys";

type Hit = { id: string; kind: "event" | "task"; title: string; day: string; detail: string; birthday: boolean; color?: string; completed: boolean };

/** Editors live outside the active workspace so search can open any item in place. */
export function InspectorSearchHost({ onCommandMenu, onSettings }: { onCommandMenu: () => void; onSettings: () => void }) {
  const source = useCoreViewModelSource();
  const inspector = useInspector();
  const events = useCalendarEventInspector(source);
  const tasks = useTaskInspector(source);
  const query = useRef("");
  const current = useRef(inspector.current);
  current.current = inspector.current;
  useEffect(() => {
    const open = () => inspector.open({ kind: "search", id: "planner-search", title: "Search", body: <InspectorSearchBody initialQuery={() => query.current} onQuery={value => { query.current = value; }} onCommandMenu={onCommandMenu} onOpen={async hit => {
      if (hit.kind === "task") { await tasks.selectTask(hit.id); return; }
      const result = await window.hcb?.calendar.get({ id: hit.id });
      if (!result?.ok) throw new Error(result?.error.message ?? "This event could not be opened.");
      if (current.current?.kind !== "search") return;
      const calendar = source.calendarSources.find(item => item.id === result.data.calendarId);
      events.openEdit(stableCalendarEventViewModel(result.data, calendar?.title ?? result.data.calendarTitle, calendar?.timeZone ?? null, calendar?.backgroundColor ?? null, calendar?.foregroundColor ?? null, source.settings.calendarEventColorOverrides, source.activeColorTheme, source.settings.defaultTimeZone, new Map()));
    }} /> });
    window.addEventListener("hcb:open-sidebar-search", open);
    window.addEventListener("hcb:open-settings", onSettings);
    return () => { window.removeEventListener("hcb:open-sidebar-search", open); window.removeEventListener("hcb:open-settings", onSettings); };
  });
  return null;
}

function InspectorSearchBody({ initialQuery, onQuery, onOpen, onCommandMenu }: { initialQuery: () => string; onQuery: (value: string) => void; onOpen: (hit: Hit) => Promise<void>; onCommandMenu: () => void }) {
  const source = useCoreViewModelSource();
  const { todayKey } = useCalendarNavigation();
  const [query, setQuery] = useState(initialQuery);
  const search = useLocalSearch(query);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    const results = search.viewModel.results.filter(hit => hit.source !== "note");
    setHits([]); setError("");
    if (!query.trim() || search.state !== "results") { setLoading(false); return; }
    setLoading(true);
    void Promise.all(results.map(async hit => {
      const result = hit.source === "task" ? await window.hcb?.tasks.get({ id: hit.targetId }) : await window.hcb?.calendar.get({ id: hit.targetId });
      if (!result?.ok) throw new Error(result?.error.message ?? "Search details could not be loaded.");
      const item = result.data;
      const task = hit.source === "task";
      const day = task ? item.dueDate?.slice(0, 10) ?? "" : item.allDay ? item.startsAt.slice(0, 10) : calendarLocalPoint(item.startsAt, source.settings.defaultTimeZone).dayKey;
      return { id: hit.targetId, kind: task ? "task" : "event", title: item.title, day, birthday: item.hcbKind === "birthday", detail: task ? item.status === "completed" ? "Completed task" : "Task" : item.allDay ? "All day" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: source.settings.defaultTimeZone }).format(new Date(item.startsAt)), color: source.calendarSources.find(c => c.id === item.calendarId)?.backgroundColor, completed: task ? item.status === "completed" : Boolean(item.completedAt) } as Hit;
    })).then(items => { if (!cancelled) setHits(items.sort((a, b) => (a.day || "9999").localeCompare(b.day || "9999"))); }).catch(reason => { if (!cancelled) setError(reason.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, search.viewModel, search.state, source.settings.defaultTimeZone, source.calendarSources]);
  const groups = [...new Set(hits.map(hit => hit.day))];
  const busy = loading || search.state === "loading" || search.state === "stale";
  return <div className="inspector-search">
    <div className="inspector-search-input"><CalendarSearch size={18} /><input ref={input} autoFocus type="search" aria-label="Search events, tasks and birthdays" placeholder="Search events, tasks, birthdays" value={query} onChange={event => { setQuery(event.target.value); onQuery(event.target.value); }} />{query ? <button aria-label="Clear search" onClick={() => { setQuery(""); onQuery(""); input.current?.focus(); }}><X size={16} /></button> : null}</div>
    {!query.trim() ? <div className="inspector-shortcuts"><h3>Useful shortcuts</h3><button onClick={onCommandMenu}><span>Command menu</span><kbd>{displayAccelerator(source.settings.keybindings["navigation.search"] ?? "CommandOrControl+P")}</kbd></button><p>Find an event, task or birthday by its title or description.</p></div> : <>
      <p className="sr-only" role="status">{busy ? "Searching…" : `${hits.length} results`}</p>
      {error || search.errorMessage ? <p role="alert">{error || search.errorMessage}</p> : null}
      {busy ? <p className="inspector-search-message">Searching…</p> : !hits.length && !error && !search.errorMessage ? <p className="inspector-search-message">No matching events, tasks or birthdays.</p> : null}
      <div className="inspector-search-results" onKeyDown={event => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        event.preventDefault(); buttons[next]?.focus();
      }}>{groups.map(day => <section key={day}><h3 data-today={day === todayKey}>{!day ? "No due date" : day === todayKey ? "Today" : day === calendarAddUtcDays(todayKey, 1) ? "Tomorrow" : calendarDateTitleFromIso(day)}</h3>{hits.filter(hit => hit.day === day).map(hit => <button key={`${hit.kind}-${hit.id}`} className="inspector-search-result" data-completed={hit.completed} style={{ borderLeftColor: hit.color || "var(--color-accent)" }} onClick={() => { void onOpen(hit).catch(reason => setError(reason.message)); }}><span>{hit.birthday ? <Gift size={14} /> : hit.kind === "task" ? <ListTodo size={14} /> : null}{hit.title}</span><small>{hit.birthday ? "Birthday · " : ""}{hit.detail}</small></button>)}</section>)}</div>
    </>}
  </div>;
}
