import { useEffect, useId, useRef, useState } from "react";
import { addMinutes, format } from "date-fns";
import { CalendarDays, Check, FileText, ListTodo, Search, Sparkles } from "lucide-react";
import { MarkdownEditor } from "@renderer/components/MarkdownEditor";
import type { Note, PlanEvent, Proposal, Section, Selection, Task } from "./model";
import { calendars, dateTimeValue, lists, timeLabel, TODAY } from "./model";
import { Empty, Modal } from "./ui";

export type NewKind = "task" | "event" | "note";
export type NewItem = { kind: NewKind; title: string; body: string; list: string; start: Date; end: Date; minutes: number };

export function NewItemDialog({ kind, list: initialList, date, onClose, onCreate }: { kind: NewKind; list: string; date: Date; onClose: () => void; onCreate: (item: NewItem) => void }) {
  const titleId = useId();
  const [active, setActive] = useState(kind); const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [list, setList] = useState(initialList === "All tasks" ? "Inbox" : initialList); const [minutes, setMinutes] = useState(30);
  const initial = new Date(date); initial.setHours(10, 0, 0, 0);
  const [start, setStart] = useState(dateTimeValue(initial)); const [end, setEnd] = useState(dateTimeValue(addMinutes(initial, 30))); const [error, setError] = useState("");
  return <Modal open onOpenChange={open => { if (!open) onClose(); }} title={`New ${active}`} description="Sample data · changes stay in this tab." className="create-item-modal">
    <form className="new-item-form" onSubmit={e => { e.preventDefault(); if (!title.trim()) return; if (active === "event" && new Date(end) <= new Date(start)) { setError("Choose an end time after the start."); return; } onCreate({ kind: active, title: title.trim(), body, list, start: new Date(start), end: new Date(end), minutes }); }}>
      <div className="new-kind-tabs" role="group" aria-label="Item type">{(["task", "event", "note"] as const).map(type => <button type="button" key={type} aria-pressed={active === type} onClick={() => { setActive(type); setError(""); }}>{type === "task" ? <ListTodo size={16} /> : type === "event" ? <CalendarDays size={16} /> : <FileText size={16} />}{type[0].toUpperCase() + type.slice(1)}</button>)}</div>
      <label className="new-title-label" htmlFor={titleId}>Title</label>
      <input id={titleId} autoFocus required aria-label="New item title" className="new-title" placeholder={active === "note" ? "Untitled note" : active === "event" ? "Event title" : "What needs to get done?"} value={title} onChange={e => setTitle(e.target.value)} />
      {active === "task" && <div className="new-item-properties"><label>List<select value={list} onChange={e => setList(e.target.value)}>{lists.map(name => <option key={name}>{name}</option>)}</select></label><label>Estimated time<select value={minutes} onChange={e => setMinutes(Number(e.target.value))}>{[15, 30, 45, 60, 90, 120].map(n => <option key={n} value={n}>{n} minutes</option>)}</select></label></div>}
      {active === "event" && <div className="new-item-properties"><label>Starts<input required type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></label><label>Ends<input required type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></label></div>}
      <div className="new-body-heading"><span>{active === "note" ? "Content" : active === "event" ? "Description" : "Notes"}</span><span>Optional</span></div>
      <MarkdownEditor aria-label="New item notes" className="create-item-editor" value={body} onValueChange={setBody} placeholder="Start writing…" showControls={false} />
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="modal-actions"><button className="outline-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={!title.trim()}>Create {active}</button></div>
    </form>
  </Modal>;
}

export function ScheduleDialog({ proposals, tasks, onClose, onApply }: { proposals: Proposal[]; tasks: Task[]; onClose: () => void; onApply: (proposals: Proposal[]) => void }) {
  const [selected, setSelected] = useState(new Set(proposals.map(p => p.taskId)));
  return <Modal open onOpenChange={open => { if (!open) onClose(); }} title="Make a little room for good work." description="Review these sample time blocks before adding them to your calendar." wide>
    <div className="schedule-review"><div className="schedule-summary"><span className="sparkle-tile"><Sparkles size={21} /></span><div><strong>{proposals.length} tasks, with time to do them</strong><p>Between 9 AM and 5 PM, around your sample events and lunch.</p></div></div>
      {proposals.map(p => { const task = tasks.find(t => t.id === p.taskId)!; return <label className="proposal" key={p.taskId}><input type="checkbox" checked={selected.has(p.taskId)} onChange={e => setSelected(current => { const next = new Set(current); e.target.checked ? next.add(p.taskId) : next.delete(p.taskId); return next; })} /><div><strong>{task.title}</strong><span>{task.list} · {task.minutes} minutes</span></div><div><strong>{format(p.start, "EEE, MMM d")}</strong><span>{timeLabel(p.start)}–{timeLabel(p.end)}</span></div></label>; })}
      {!proposals.length && <Empty title="No free slots in this sample day">Choose another day or unschedule a block.</Empty>}
      <p className="schedule-explanation"><Check size={15} />Task due dates stay the same. You can move or remove each time block later.</p>
      <div className="demo-note">Sample schedule preview · no Google account connected</div>
    </div><div className="modal-actions"><button className="outline-button" onClick={onClose}>Keep planning</button><button className="primary-button" disabled={!selected.size} onClick={() => onApply(proposals.filter(p => selected.has(p.taskId)))}>Add {selected.size} {selected.size === 1 ? "block" : "blocks"} to calendar</button></div>
  </Modal>;
}

export function ConflictDialog({ task, onClose, onResolve }: { task: Task; onClose: () => void; onResolve: (google: boolean) => void }) {
  return <Modal open onOpenChange={open => { if (!open) onClose(); }} title="Two versions. One clear choice." description="A sample conflict review. Compare the versions before choosing what to keep." wide>
    <div className="conflict-body"><span className="conflict-chip">Task changed in two places · 2 related edits</span><div className="comparison"><div><span>ON THIS DEVICE</span><h3>{task.title}</h3><p>Keep the opening simple. Add the customer example.</p><dl><dt>Priority</dt><dd>{task.priority}</dd><dt>Duration</dt><dd>{task.minutes} minutes</dd></dl></div><div><span>ON GOOGLE</span><h3>Shape the launch story — revised brief</h3><p>Use the updated positioning from the latest review.</p><dl><dt>Priority</dt><dd>Medium</dd><dt>Duration</dt><dd>45 minutes</dd></dl></div></div><p className="field-help">The choice also settles the related queued edit. In HCB, changed versions are checked again before applying.</p><div className="demo-note">Illustration with sample versions · both choices change this prototype only</div></div>
    <div className="modal-actions"><button className="outline-button" onClick={() => onResolve(false)}>Keep local · 2 edits</button><button className="primary-button" onClick={() => onResolve(true)}>Use Google · 2 edits</button></div>
  </Modal>;
}

export function CommandDialog({ tasks, events, notes, onClose, onSelect, onSection, onPlan, onTheme }: {
  tasks: Task[]; events: PlanEvent[]; notes: Note[]; onClose: () => void; onSelect: (selection: Selection) => void; onSection: (section: Section) => void; onPlan: () => void; onTheme: () => void;
}) {
  const [query, setQuery] = useState(""); const [active, setActive] = useState(0); const id = useId(); const list = useRef<HTMLDivElement>(null);
  const actions = [
    ...(["calendar", "tasks", "notes", "settings"] as const).map(section => ({ id: section, title: `Open ${section}`, subtitle: "Navigation", run: () => onSection(section) })),
    { id: "plan", title: "Plan my day", subtitle: "Preview time for your tasks", run: onPlan }, { id: "theme", title: "Switch appearance", subtitle: "Light / dark", run: onTheme }
  ];
  const records = [
    ...tasks.map(task => ({ id: task.id, title: task.title, subtitle: `Task · ${task.list}`, run: () => onSelect({ kind: "task", id: task.id }) })),
    ...notes.map(note => ({ id: note.id, title: note.title, subtitle: `Note · ${note.list}`, run: () => onSelect({ kind: "note", id: note.id }) })),
    ...events.filter(e => e.start >= TODAY).map(event => ({ id: event.id, title: event.title, subtitle: `Event · ${format(event.start, "EEE, MMM d, h:mm a")}`, run: () => onSelect({ kind: "event", id: event.id }) }))
  ];
  const results = [...actions, ...records].filter(item => `${item.title} ${item.subtitle}`.toLowerCase().includes(query.toLowerCase())).slice(0, 24);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [active]);
  const choose = (index: number) => { results[index]?.run(); onClose(); };
  return <Modal open onOpenChange={open => { if (!open) onClose(); }} title="Find a little clarity" description="Search sample tasks, notes, events, and commands."><div className="command-search"><Search size={20} /><input autoFocus placeholder="Search anything…" aria-label="Search everything" aria-controls={id} aria-expanded="true" aria-autocomplete="list" aria-activedescendant={results[active] ? `${id}-${active}` : undefined} value={query} onChange={e => { setQuery(e.target.value); setActive(0); }} onKeyDown={e => { if (e.nativeEvent.isComposing) return; if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => (a + 1) % Math.max(results.length, 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => (a - 1 + Math.max(results.length, 1)) % Math.max(results.length, 1)); } if (e.key === "Enter") { e.preventDefault(); choose(active); } }} /></div><div className="command-results" id={id} ref={list} role="listbox" aria-label="Search results">{results.map((item, i) => <button key={`${item.subtitle}-${item.id}`} id={`${id}-${i}`} role="option" aria-selected={active === i} onClick={() => choose(i)} onPointerMove={e => { if (e.movementX || e.movementY) setActive(i); }}><span>{item.subtitle.startsWith("Task") ? <ListTodo size={17} /> : item.subtitle.startsWith("Note") ? <FileText size={17} /> : <CalendarDays size={17} />}</span><div><strong>{item.title}</strong><small>{item.subtitle}</small></div><kbd>↵</kbd></button>)}{!results.length && <Empty title="No matching items">Try another word.</Empty>}</div><div className="command-footer"><span>↑ ↓ to navigate</span><span>↵ to open</span><span>esc to close</span></div></Modal>;
}
