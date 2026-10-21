import { useCallback, useEffect, useRef, useState } from "react";
import { addDays, addMinutes, addMonths, addWeeks, format, getISOWeek, isSameDay, isSameWeek, startOfMonth, startOfWeek } from "date-fns";
import { ArrowDownUp, ArrowUpRight, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Cloud, Columns2, FileText, Folder, Inbox, ListTodo, Moon, PanelLeft, PanelRight, Play, Plus, Search, Settings2, Sparkles, Sun, X } from "lucide-react";
import { WeekView } from "./vendor/components/week-view";
import { MonthView } from "./vendor/components/month-view";
import { calendars, dayKey, initialNotes, initialTasks, lists, seedEvents, suggestSlots, timeLabel, TODAY, WEEK } from "./model";
import type { Note, PlanEvent, Proposal, Section, Selection, Task } from "./model";
import { IconButton, MiniCalendar } from "./ui";
import { NoteDocument, NotesView } from "./Documents";
import { TasksView } from "./Tasks";
import { DayPanel, EventInspector, TaskInspector } from "./Inspectors";
import { CommandDialog, ConflictDialog, NewItemDialog, ScheduleDialog } from "./Dialogs";
import type { NewItem, NewKind } from "./Dialogs";
import { SettingsView } from "./Settings";

type CalendarView = "week" | "day" | "month" | "agenda";

export function App() {
  const [section, setSection] = useState<Section>("calendar");
  const [tasks, setTasks] = useState<Task[]>(() => structuredClone(initialTasks));
  const [notes, setNotes] = useState<Note[]>(() => structuredClone(initialNotes));
  const [events, setEvents] = useState(seedEvents);
  const [date, setDate] = useState(WEEK); const [miniMonth, setMiniMonth] = useState(TODAY); const [displayMonth, setDisplayMonth] = useState(TODAY);
  const [focusedDate, setFocusedDate] = useState(TODAY);
  const [view, setView] = useState<CalendarView>("week");
  const [sidebar, setSidebar] = useState(window.innerWidth >= 1000); const [context, setContext] = useState(window.innerWidth >= 1200); const [split, setSplit] = useState(false);
  const [splitTab, setSplitTab] = useState("Notes"); const [referencePaused, setReferencePaused] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [visibleCalendars, setVisibleCalendars] = useState(new Set(calendars.map(c => c.id as string)));
  const [selection, setSelection] = useState<Selection>(null); const [noteId, setNoteId] = useState("weekly"); const [taskList, setTaskList] = useState("All tasks");
  const [newKind, setNewKind] = useState<NewKind | null>(null); const [command, setCommand] = useState(false); const [review, setReview] = useState<Proposal[] | null>(null);
  const [conflict, setConflict] = useState(false); const [hasConflict, setHasConflict] = useState(true); const [pending, setPending] = useState(2);
  const [toast, setToast] = useState("");
  const calendarRef = useRef<HTMLDivElement>(null);
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => { document.documentElement.classList.toggle("dark", theme === "dark"); }, [theme]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 3800); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (section !== "calendar" || (view !== "week" && view !== "day")) return;
    const frame = requestAnimationFrame(() => {
      const scroller = calendarRef.current?.querySelector<HTMLElement>(".scrollbar-hide");
      if (scroller) scroller.scrollTop = 7.5 * ((scroller.firstElementChild as HTMLElement).offsetHeight / 24);
    });
    return () => cancelAnimationFrame(frame);
  }, [section, view]);
  const toggleTheme = () => setTheme(current => current === "light" ? "dark" : "light");
  const nav = (next: Section) => { setSection(next); setSelection(null); if (window.innerWidth < 1000) setSidebar(false); };
  const select = (value: Selection) => { setSelection(value); setContext(true); setSplit(false); };
  const openSelection = (value: Selection) => {
    if (!value) return;
    if (value.kind === "note") { nav("notes"); setNoteId(value.id); return; }
    if (value.kind === "event") { nav("calendar"); const event = events.find(e => e.id === value.id); if (event) { setFocusedDate(event.start); setView("week"); setDate(startOfWeek(event.start, { weekStartsOn: 1 })); } }
    else { nav("tasks"); setTaskList("All tasks"); }
    select(value);
  };
  const updateNote = (note: Note) => setNotes(current => current.map(n => n.id === note.id ? note : n));
  const saveTask = (task: Task) => { setTasks(current => current.map(t => t.id === task.id ? task : t)); setPending(n => n + 1); notify("Sample task updated"); };
  const saveEvent = (event: PlanEvent) => { setEvents(current => current.map(e => e.id === event.id ? { ...e, ...event } : e)); setPending(n => n + 1); notify("Sample calendar updated"); };
  const completeTask = (id: string) => { setTasks(current => current.map(t => t.id === id ? { ...t, completed: !t.completed } : t)); setPending(n => n + 1); };
  const plan = () => setReview(suggestSlots(tasks, events, TODAY));
  const schedule = (id: string) => setReview(suggestSlots(tasks.filter(t => t.id === id), events, TODAY));
  const applySchedule = (proposals: Proposal[]) => {
    setEvents(current => [...current, ...proposals.map(p => ({ id: crypto.randomUUID(), title: tasks.find(t => t.id === p.taskId)!.title, start: p.start, end: p.end, calendarId: "focus", color: "purple" as const, taskId: p.taskId, description: tasks.find(t => t.id === p.taskId)!.notes }))]);
    setReview(null); setPending(n => n + proposals.length); nav("calendar"); setView("week"); setDate(WEEK); setFocusedDate(TODAY); notify(`${proposals.length} sample ${proposals.length === 1 ? "block added" : "blocks added"}. Task due dates are unchanged.`);
  };
  const create = (item: NewItem) => {
    const id = crypto.randomUUID(); setNewKind(null);
    if (item.kind === "task") { setTasks(current => [...current, { id, title: item.title, notes: item.body, list: item.list, minutes: item.minutes, priority: "Medium", due: dayKey(TODAY), tags: [] }]); select({ kind: "task", id }); if (section !== "calendar") nav("tasks"); setSelection({ kind: "task", id }); setPending(n => n + 1); }
    if (item.kind === "event") { setEvents(current => [...current, { id, title: item.title, description: item.body, start: item.start, end: item.end, color: "blue", calendarId: "work" }]); nav("calendar"); setView("week"); setFocusedDate(item.start); setDate(startOfWeek(item.start, { weekStartsOn: 1 })); select({ kind: "event", id }); setPending(n => n + 1); }
    if (item.kind === "note") { setNotes(current => [...current, { id, title: item.title, body: item.body || `# ${item.title}\n\n`, list: "Journal", tags: [], updated: "Today" }]); nav("notes"); setNoteId(id); }
    notify(`Sample ${item.kind} created`);
  };
  const changeView = (next: CalendarView) => {
    const anchor = focusedDate;
    setDate(next === "month" ? startOfWeek(startOfMonth(anchor)) : next === "week" || next === "agenda" ? startOfWeek(anchor, { weekStartsOn: 1 }) : anchor);
    setView(next); setSelection(null);
  };
  const today = () => { setFocusedDate(TODAY); setDate(view === "day" ? TODAY : view === "month" ? startOfWeek(startOfMonth(TODAY)) : WEEK); setMiniMonth(TODAY); };
  const navigate = (direction: number) => { const next = view === "day" ? addDays(focusedDate, direction) : view === "month" ? addMonths(focusedDate, direction) : addWeeks(focusedDate, direction); setFocusedDate(next); setMiniMonth(next); setDate(view === "day" ? next : view === "month" ? startOfWeek(startOfMonth(next)) : startOfWeek(next, { weekStartsOn: 1 })); };
  const calendarDateChanged = (next: Date) => { setDate(next); const focus = view === "month" ? addDays(next, 21) : next; setFocusedDate(focus); setMiniMonth(focus); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommand(current => !current); return; }
      if (command || newKind || review || conflict) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "Escape") { setSelection(null); if (window.innerWidth < 1000) setSidebar(false); return; }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() === "t" && section === "calendar") today();
      if (event.key.toLowerCase() === "w" && section === "calendar") changeView("week");
      if (event.key.toLowerCase() === "d" && section === "calendar") changeView("day");
      if (event.key.toLowerCase() === "m" && section === "calendar") changeView("month");
      if (event.key.toLowerCase() === "n") setNewKind(section === "notes" ? "note" : section === "calendar" ? "event" : "task");
      if (event.key === "ArrowLeft" && section === "calendar") navigate(-1);
      if (event.key === "ArrowRight" && section === "calendar") navigate(1);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });
  const filteredEvents = events.filter(event => visibleCalendars.has(event.calendarId ?? "work"));
  const selectedTask = selection?.kind === "task" ? tasks.find(t => t.id === selection.id) : undefined;
  const selectedEvent = selection?.kind === "event" ? events.find(e => e.id === selection.id) : undefined;
  const showContext = context && !split && (section === "calendar" || section === "tasks");
  const shownMonth = view === "month" ? displayMonth : view === "week" || view === "agenda" ? addDays(date, 6) : date;
  const reset = () => { setTasks(structuredClone(initialTasks)); setNotes(structuredClone(initialNotes)); setEvents(seedEvents()); setPending(2); setHasConflict(true); setSelection(null); notify("Sample data reset"); };
  return <div className={`prototype-shell ${sidebar ? "sidebar-open" : ""}`}>
    {sidebar && <><button className="sidebar-scrim" aria-label="Dismiss navigation overlay" onClick={() => setSidebar(false)} /><aside className="navigation-sidebar" aria-label="Workspace navigation">
      <IconButton className="mobile-nav-close" label="Close navigation" onClick={() => setSidebar(false)}><X size={17} /></IconButton>
      <button className="workspace-brand" onClick={() => nav("calendar")}><span className="bun-mark"><span /></span><div><strong>Hot Cross Buns</strong><span>Your personal workspace</span></div><ChevronDown size={14} /></button>
      <button className="sidebar-search" onClick={() => setCommand(true)}><Search size={16} /><span>Search anything</span><kbd>⌘ K</kbd></button>
      <nav aria-label="Main navigation">{([{ id: "calendar", title: "Calendar", icon: CalendarDays }, { id: "tasks", title: "Tasks", icon: ListTodo }, { id: "notes", title: "Notes", icon: FileText }] as const).map(item => <button key={item.id} className={`nav-item ${section === item.id ? "active" : ""}`} aria-current={section === item.id ? "page" : undefined} onClick={() => { nav(item.id); if (item.id === "tasks") setTaskList("All tasks"); }}><item.icon size={17} /><span>{item.title}</span>{item.id === "tasks" && <span className="nav-count">{tasks.filter(t => !t.completed).length}</span>}</button>)}</nav>
      <div className="sidebar-scroll"><MiniCalendar date={focusedDate} month={miniMonth} setMonth={setMiniMonth} onSelect={day => { nav("calendar"); setFocusedDate(day); setDate(view === "day" ? day : view === "month" ? startOfWeek(startOfMonth(day)) : startOfWeek(day, { weekStartsOn: 1 })); setMiniMonth(day); }} />
        <div className="sidebar-group"><div className="sidebar-group-heading"><span>MY LISTS</span><IconButton label="Create a task" onClick={() => setNewKind("task")}><Plus size={14} /></IconButton></div>{lists.map((list, i) => <button key={list} className={`nav-item list-nav ${section === "tasks" && taskList === list ? "active" : ""}`} onClick={() => { nav("tasks"); setTaskList(list); }}>{i === 0 ? <Inbox size={16} /> : <Folder size={16} />}<span>{list}</span><span className="nav-count">{tasks.filter(t => t.list === list && !t.completed).length}</span></button>)}</div>
        <div className="sidebar-group"><div className="sidebar-group-heading"><span>CALENDARS</span><ChevronDown size={13} /></div><div className="calendar-account"><span className="account-avatar">A</span><span>alex@example.test</span><span className="sample-label">Demo</span></div>{calendars.map(calendar => <label className="calendar-source" key={calendar.id}><input type="checkbox" checked={visibleCalendars.has(calendar.id)} onChange={event => setVisibleCalendars(current => { const next = new Set(current); event.target.checked ? next.add(calendar.id) : next.delete(calendar.id); return next; })} style={{ accentColor: calendar.css }} /><span style={{ color: calendar.css }}>{calendar.name}</span></label>)}</div>
        <div className="sidebar-group favorites"><div className="sidebar-group-heading"><span>PINNED NOTES</span></div>{notes.slice(0, 2).map(note => <button className="nav-item" key={note.id} onClick={() => { nav("notes"); setNoteId(note.id); }}><FileText size={15} /><span>{note.title}</span></button>)}</div>
      </div>
      <div className="sidebar-footer"><div><button className={`nav-item ${section === "settings" ? "active" : ""}`} onClick={() => nav("settings")}><Settings2 size={16} /><span>Settings</span></button><IconButton label={`Switch to ${theme === "light" ? "dark" : "light"} appearance`} onClick={toggleTheme}>{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</IconButton></div><span className="prototype-label"><span />Design prototype · sample data</span></div>
    </aside></>}
    <main className="main-workspace">
      <header className="main-toolbar"><div className="toolbar-left"><IconButton label="Toggle navigation" aria-pressed={sidebar} onClick={() => setSidebar(!sidebar)}><PanelLeft size={18} /></IconButton><span className="toolbar-divider" /><div className="toolbar-title">{section === "calendar" ? <><strong>{format(shownMonth, "MMMM yyyy")}</strong><span>{view === "day" ? format(date, "EEEE") : view === "month" ? "Month view" : `Week ${getISOWeek(date)}`}</span></> : <><strong>{section[0].toUpperCase() + section.slice(1)}</strong><span>{section === "tasks" ? "A little more intention" : section === "notes" ? "A place for your thinking" : "Make yourself at home"}</span></>}</div></div>
        <div className="toolbar-right">{section === "calendar" && <><select aria-label="Calendar view" value={view} onChange={e => changeView(e.target.value as CalendarView)}>{["day", "week", "month", "agenda"].map(v => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}</select><button className="today-button" onClick={today}>Today</button><div className="flex period-navigation"><IconButton label="Previous period" onClick={() => navigate(-1)}><ChevronLeft size={17} /></IconButton><IconButton label="Next period" onClick={() => navigate(1)}><ChevronRight size={17} /></IconButton></div><span className="toolbar-divider" /></>}
          {(section === "calendar" || section === "tasks") && <><IconButton label="Split workspace" aria-pressed={split} onClick={() => setSplit(!split)}><Columns2 size={17} /></IconButton><IconButton label="Toggle day panel" aria-pressed={showContext} onClick={() => { setSplit(false); setContext(!showContext); }}><PanelRight size={18} /></IconButton></>}
          <button className="new-button" onClick={() => setNewKind(section === "notes" ? "note" : section === "calendar" ? "event" : "task")}><Plus size={16} /><span>New</span></button><span className="user-avatar" title="Sample workspace">AM</span>
        </div>
      </header>
      <div className="workspace-body"><div className="primary-pane">
        {section === "calendar" && <div ref={calendarRef} className="calendar-stage" onContextMenuCapture={event => { event.preventDefault(); event.stopPropagation(); }} onDragOver={event => { if (event.dataTransfer.types.includes("application/x-hcb-prototype-task")) event.preventDefault(); }} onDrop={event => {
          const taskId = event.dataTransfer.getData("application/x-hcb-prototype-task"); const task = tasks.find(t => t.id === taskId); if (!task || view === "month" || view === "agenda") return; event.preventDefault();
          const scroller = event.currentTarget.querySelector<HTMLElement>(".scrollbar-hide"); if (!scroller) return; const box = scroller.getBoundingClientRect(); if (event.clientY < box.top || event.clientY > box.bottom || event.clientX < box.left + 64) return;
          const days = view === "day" ? 1 : 7; const column = Math.max(0, Math.min(days - 1, Math.floor((event.clientX - box.left - 64) / ((box.width - 64) / days)))); const hourHeight = (scroller.firstElementChild as HTMLElement).offsetHeight / 24;
          const minutes = Math.max(0, Math.min(24 * 60 - task.minutes, Math.round((event.clientY - box.top + scroller.scrollTop) / hourHeight * 4) * 15)); const start = addDays(date, column); start.setHours(0, minutes, 0, 0); setReview([{ taskId, start, end: addMinutes(start, task.minutes) }]);
        }}>
          {view === "month" ? <MonthView currentDate={date} events={filteredEvents} onEventClick={event => select({ kind: "event", id: event.id })} selectedEventId={selectedEvent?.id} onEventChange={saveEvent} onDateChange={calendarDateChanged} onDisplayMonthChange={setDisplayMonth} isSidebarOpen onBackgroundClick={() => setSelection(null)} onDayNumberClick={day => { setFocusedDate(day); setDate(day); setView("day"); }} onMoreClick={day => { setFocusedDate(day); setDate(day); setView("day"); }} />
            : view === "agenda" ? <div className="agenda-view">{Array.from({ length: 7 }, (_, i) => addDays(date, i)).map(day => <section key={dayKey(day)}><div className={`agenda-day ${isSameDay(day, TODAY) ? "is-today" : ""}`}><strong>{format(day, "d")}</strong><span>{format(day, "EEE")}<small>{format(day, "MMM")}</small></span></div><div>{filteredEvents.filter(event => isSameDay(event.start, day) || (event.isAllDay && event.start <= day && event.end >= day)).sort((a, b) => a.start.getTime() - b.start.getTime()).map(event => <button key={event.id} className="agenda-event" onClick={() => select({ kind: "event", id: event.id })}><span className={`event-dot color-${event.color}`} /><span>{event.isAllDay ? "All day" : `${timeLabel(event.start)}–${timeLabel(event.end)}`}</span><strong>{event.title}</strong><span>{calendars.find(c => c.id === event.calendarId)?.name}</span><ArrowUpRight size={15} /></button>)}</div></section>)}</div>
            : <WeekView view={view} weekStartsOn={1} currentDate={date} events={filteredEvents} selectedEventId={selectedEvent?.id} onEventClick={event => select({ kind: "event", id: event.id })} onEventChange={saveEvent} onDateChange={calendarDateChanged} onBackgroundClick={() => setSelection(null)} isSidebarOpen onEventCreate={range => { const id = crypto.randomUUID(); setEvents(current => [...current, { id, title: "New event", start: range.start, end: range.end, calendarId: "work", color: "blue" }]); select({ kind: "event", id }); setPending(n => n + 1); }} />}
        </div>}
        {section === "tasks" && <TasksView tasks={tasks} events={events} filterList={taskList} onFilterList={setTaskList} selected={selectedTask?.id} onSelect={id => select({ kind: "task", id })} onComplete={completeTask} onSchedule={schedule} onPlan={plan} onNew={() => setNewKind("task")} />}
        {section === "notes" && <NotesView notes={notes} selected={noteId} onSelect={setNoteId} onChange={updateNote} onNew={() => setNewKind("note")} />}
        {section === "settings" && <SettingsView theme={theme} onTheme={setTheme} onReset={reset} onConflict={() => hasConflict ? setConflict(true) : notify("No remaining sample conflicts")} pending={pending} hasConflict={hasConflict} />}
      </div>
      {split && (section === "calendar" || section === "tasks") && <aside className="split-pane" aria-label="Split workspace"><div className="split-heading"><div className="small-tabs">{["Notes", "Reference"].map(tab => <button aria-pressed={splitTab === tab} key={tab} onClick={() => setSplitTab(tab)}>{tab}</button>)}</div><IconButton label="Close split workspace" onClick={() => setSplit(false)}><X size={16} /></IconButton></div>{splitTab === "Notes" ? <NoteDocument note={notes.find(n => n.id === noteId) ?? notes[0]} onChange={updateNote} small /> : <div className="reference-pane"><div className="reference-address"><span>example.test / project-brief</span><button onClick={() => setReferencePaused(!referencePaused)}>{referencePaused ? "Resume" : "Pause"}</button></div>{referencePaused ? <div className="reference-paused"><span className="reference-symbol"><Play size={24} strokeWidth={1.3} /></span><h3>A reference, when you need it.</h3><p>Keep a page beside your plan. Paused pages leave room for the work in front of you.</p><button className="outline-button" onClick={() => setReferencePaused(false)}><Play size={14} />Show sample reference</button></div> : <div className="sample-reference"><span className="eyebrow">PROJECT SPACE</span><h2>Something good is taking shape.</h2><p>A small collection of ideas, sketches, and questions for the next chapter.</p><h3>The brief</h3><p>Build a calmer place for the work that matters.</p><div>01 / Make the important things clear.</div><div>02 / Bring context closer.</div><div>03 / Leave a little breathing room.</div><span className="demo-note">Static sample page · no website loaded</span></div>}</div>}</aside>}
      {showContext && <aside className="context-panel" aria-label="Day and details panel">{selectedTask ? <TaskInspector key={selectedTask.id} task={selectedTask} events={events} onSave={saveTask} onComplete={() => completeTask(selectedTask.id)} onBack={() => setSelection(null)} onSchedule={() => schedule(selectedTask.id)} onEvent={id => select({ kind: "event", id })} onDelete={() => { if (tasks.some(t => t.parentId === selectedTask.id)) { notify("Move the subtasks before deleting this sample task."); return; } setTasks(current => current.filter(t => t.id !== selectedTask.id)); setEvents(current => current.filter(e => e.taskId !== selectedTask.id)); setSelection(null); notify("Sample task deleted"); }} /> : selectedEvent ? <EventInspector key={`${selectedEvent.id}-${selectedEvent.start.getTime()}-${selectedEvent.end.getTime()}`} event={selectedEvent} onSave={saveEvent} onBack={() => setSelection(null)} onTask={id => select({ kind: "task", id })} onDelete={() => { setEvents(current => current.filter(e => e.id !== selectedEvent.id)); setSelection(null); notify("Sample event deleted"); }} /> : <DayPanel tasks={tasks} events={events} onTask={id => select({ kind: "task", id })} onEvent={id => select({ kind: "event", id })} onComplete={completeTask} onSchedule={schedule} onPlan={plan} onNew={() => setNewKind("task")} />}</aside>}
      </div>
      <footer className="workspace-status"><span><span className="status-dot" />Local design prototype <span className="status-divider">/</span><span className="status-caption">Changes stay in this tab</span></span><div><button onClick={() => hasConflict ? setConflict(true) : notify("No remaining sample conflicts")}><Cloud size={13} />Demo sync <span className={hasConflict ? "sync-attention" : ""}>{hasConflict ? "1 needs review" : "Reviewed"}</span><span className="status-caption">· {pending} queued</span></button><button className="status-help" onClick={() => setCommand(true)} aria-label="Open commands and search"><CircleHelp size={14} /><span>⌘ K</span></button></div></footer>
    </main>
    {toast && <div className="prototype-toast" role="status"><Check size={16} />{toast}<IconButton label="Dismiss notification" onClick={() => setToast("")}><X size={14} /></IconButton></div>}
    {newKind && <NewItemDialog kind={newKind} list={taskList} date={TODAY} onClose={() => setNewKind(null)} onCreate={create} />}
    {review && <ScheduleDialog proposals={review} tasks={tasks} onClose={() => setReview(null)} onApply={applySchedule} />}
    {conflict && <ConflictDialog task={tasks.find(t => t.id === "launch") ?? initialTasks[0]} onClose={() => setConflict(false)} onResolve={google => { if (google) setTasks(current => current.map(t => t.id === "launch" ? { ...t, title: "Shape the launch story — revised brief", notes: "Use the updated positioning from the latest review.", priority: "Medium", minutes: 45 } : t)); setHasConflict(false); setConflict(false); setPending(current => google ? Math.max(0, current - 2) : current); notify(`Sample conflict resolved · ${google ? "Google version" : "local version"} kept`); }} />}
    {command && <CommandDialog tasks={tasks} events={events} notes={notes} onClose={() => setCommand(false)} onSelect={openSelection} onSection={nav} onPlan={plan} onTheme={toggleTheme} />}
  </div>;
}
