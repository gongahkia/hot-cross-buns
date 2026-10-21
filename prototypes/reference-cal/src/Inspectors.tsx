import { useState } from "react";
import { addDays, format, isSameDay } from "date-fns";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, ArrowUpRight, CalendarDays, Check, ChevronRight, Clock3, FileText, Flag, Link2, ListTodo, MapPin, Pencil, Plus, Repeat2, Sparkles, Trash2, Users, Video } from "lucide-react";
import { MarkdownEditor } from "@renderer/components/MarkdownEditor";
import type { PlanEvent, Task } from "./model";
import { calendars, dateTimeValue, dayKey, lists, timeLabel, TODAY } from "./model";
import { Empty, IconButton, Tag, TaskRow } from "./ui";

export function DayPanel({ tasks, events, onTask, onEvent, onComplete, onSchedule, onPlan, onNew }: {
  tasks: Task[]; events: PlanEvent[]; onTask: (id: string) => void; onEvent: (id: string) => void; onComplete: (id: string) => void; onSchedule: (id: string) => void; onPlan: () => void; onNew: () => void;
}) {
  const [tab, setTab] = useState("To do");
  const todayTasks = tasks.filter(t => t.due === dayKey(TODAY)); const completed = todayTasks.filter(t => t.completed).length;
  const upcoming = events.filter(e => !e.isAllDay && e.end > new Date() && e.start < addDays(TODAY, 2)).sort((a, b) => a.start.getTime() - b.start.getTime());
  const next = upcoming[0];
  return <><div className="context-heading"><span className="eyebrow">YOUR DAY, WITH A LITTLE SPACE</span><h2>{format(TODAY, "EEEE, MMM d")}</h2><p>{completed} of {todayTasks.length} tasks complete</p><div className="day-progress"><span style={{ width: `${todayTasks.length ? completed / todayTasks.length * 100 : 0}%` }} /></div></div>
    {next && <section className="up-next"><div className="eyebrow">UP NEXT</div><button type="button" onClick={() => onEvent(next.id)}><span className={`up-next-mark color-${next.color}`} /><div><strong>{next.title}</strong><span>{isSameDay(next.start, TODAY) ? "Today" : format(next.start, "EEE")} · {timeLabel(next.start)}–{timeLabel(next.end)}</span></div><ArrowUpRight size={15} /></button></section>}
    <div className="context-tabs"><div className="small-tabs">{["To do", "Agenda"].map(label => <button key={label} aria-pressed={tab === label} onClick={() => setTab(label)}>{label}</button>)}</div><IconButton label="Add a task" onClick={onNew}><Plus size={16} /></IconButton></div>
    <div className="day-panel-list">{tab === "To do" ? todayTasks.map(task => <TaskRow key={task.id} task={task} compact scheduled={events.some(e => e.taskId === task.id)} onSelect={() => onTask(task.id)} onComplete={() => onComplete(task.id)} onSchedule={() => onSchedule(task.id)} />) : upcoming.map(event => <button className="agenda-mini" key={event.id} onClick={() => onEvent(event.id)}><span className={`event-dot color-${event.color}`} /><div><strong>{event.title}</strong><span>{format(event.start, "EEE, MMM d")} · {timeLabel(event.start)}</span></div><ChevronRight size={13} /></button>)}</div>
    <div className="plan-day-card"><Sparkles size={19} strokeWidth={1.5} /><h3>Good work needs a little room.</h3><p>Find time around your commitments. Review each block before adding it.</p><button className="primary-button" onClick={onPlan}><Sparkles size={14} />Plan my day</button></div>
    <div className="context-tip"><span>QUICK TIP</span><p>Drag a task onto the calendar to choose when to work on it.</p><div><kbd>⌘</kbd><kbd>K</kbd><span>Find anything</span></div></div>
  </>;
}

export function TaskInspector({ task, events, onSave, onDelete, onComplete, onBack, onSchedule, onEvent }: {
  task: Task; events: PlanEvent[]; onSave: (task: Task) => void; onDelete: () => void; onComplete: () => void; onBack: () => void; onSchedule: () => void; onEvent: (id: string) => void;
}) {
  const [draft, setDraft] = useState(task); const [editingNotes, setEditingNotes] = useState(false);
  const blocks = events.filter(e => e.taskId === task.id);
  return <form className="detail-form" onSubmit={e => { e.preventDefault(); if (draft.title.trim()) onSave({ ...draft, title: draft.title.trim(), completed: task.completed }); }}>
    <div className="detail-top"><IconButton label="Back to day" onClick={onBack}><ArrowLeft size={17} /></IconButton><span><ListTodo size={14} /> Task</span><IconButton label="Delete task" onClick={onDelete}><Trash2 size={15} /></IconButton></div>
    <div className="detail-title-row"><button type="button" className={`task-check ${task.completed ? "checked" : ""}`} aria-label={task.completed ? "Reopen selected task" : "Complete selected task"} onClick={onComplete}>{task.completed ? <Check size={16} /> : <span className="empty-check" />}</button><textarea required aria-label="Task title" className="detail-title" rows={3} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></div>
    <div className="detail-properties">
      <label><ListTodo size={15} /><span>List</span><select value={draft.list} onChange={e => setDraft({ ...draft, list: e.target.value })}>{lists.map(list => <option key={list}>{list}</option>)}</select></label>
      <label><CalendarDays size={15} /><span>Due date</span><input type="date" value={draft.due} onChange={e => setDraft({ ...draft, due: e.target.value })} /></label>
      <label><Clock3 size={15} /><span>Duration</span><select value={draft.minutes} onChange={e => setDraft({ ...draft, minutes: Number(e.target.value) })}>{[15, 30, 45, 60, 90, 120].map(minutes => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label>
      <label><Flag size={15} /><span>Priority</span><select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value as Task["priority"] })}>{["High", "Medium", "Low"].map(p => <option key={p}>{p}</option>)}</select></label>
    </div>
    <div className="detail-section"><div className="label-heading">TAGS</div><div className="flex flex-wrap gap-1.5">{draft.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}{!draft.tags.length && <span className="muted">No tags</span>}</div></div>
    <div className="detail-section"><div className="label-heading">TIME ON YOUR CALENDAR</div>{blocks.length ? blocks.map(block => <button type="button" key={block.id} className="scheduled-link" onClick={() => onEvent(block.id)}><CalendarDays size={16} /><div><strong>{format(block.start, "EEE, MMM d")}</strong><span>{timeLabel(block.start)}–{timeLabel(block.end)}</span></div><ArrowUpRight size={14} /></button>) : <button type="button" className="outline-button full" onClick={onSchedule}><Plus size={15} />Find a time</button>}<p className="field-help">A time block is separate from the task's due date.</p></div>
    <div className="detail-section"><div className="label-heading"><FileText size={14} /> NOTES <button type="button" aria-label="Edit task notes" onClick={() => setEditingNotes(!editingNotes)}><Pencil size={14} /></button></div>{editingNotes ? <MarkdownEditor aria-label="Task notes" value={draft.notes} onValueChange={notes => setDraft({ ...draft, notes })} showControls={false} /> : <div className="detail-markdown" onDoubleClick={() => setEditingNotes(true)}><ReactMarkdown>{draft.notes || "Add a little context…"}</ReactMarkdown></div>}</div>
    <div className="detail-actions"><button className="primary-button full" type="submit">Save changes</button><span className="muted">Sample task · changes stay in this tab</span></div>
  </form>;
}

export function EventInspector({ event, onSave, onDelete, onBack, onTask }: { event: PlanEvent; onSave: (event: PlanEvent) => void; onDelete: () => void; onBack: () => void; onTask: (id: string) => void }) {
  const [draft, setDraft] = useState(event); const [editingNotes, setEditingNotes] = useState(false); const [error, setError] = useState("");
  return <form className="detail-form" onSubmit={e => { e.preventDefault(); if (!draft.title.trim()) return; if (!draft.isAllDay && draft.end <= draft.start) { setError("Choose an end time after the start."); return; } if (draft.isAllDay && draft.end < draft.start) { setError("Choose an end date on or after the start."); return; } setError(""); onSave({ ...draft, title: draft.title.trim() }); }}>
    <div className="detail-top"><IconButton label="Back to day" onClick={onBack}><ArrowLeft size={17} /></IconButton><span><span className={`event-dot color-${draft.color}`} />{event.taskId ? "Task block" : "Event"}</span><IconButton label="Delete event" onClick={onDelete}><Trash2 size={15} /></IconButton></div>
    <textarea required aria-label="Event title" className="detail-title event-title" rows={3} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
    <div className="event-dates"><label><span>Starts</span><input required type={draft.isAllDay ? "date" : "datetime-local"} aria-label="Event starts" value={draft.isAllDay ? dayKey(draft.start) : dateTimeValue(draft.start)} onChange={e => { if(e.target.value) setDraft({ ...draft, start: new Date(draft.isAllDay ? `${e.target.value}T00:00` : e.target.value) }); }} /></label><label><span>Ends</span><input required type={draft.isAllDay ? "date" : "datetime-local"} aria-label="Event ends" value={draft.isAllDay ? dayKey(draft.end) : dateTimeValue(draft.end)} onChange={e => { if(e.target.value) setDraft({ ...draft, end: new Date(draft.isAllDay ? `${e.target.value}T00:00` : e.target.value) }); }} /></label></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <label className="check-label"><input type="checkbox" checked={Boolean(draft.isAllDay)} onChange={e => setDraft({ ...draft, isAllDay: e.target.checked })} />All-day event</label>
    <div className="detail-properties"><label><CalendarDays size={15} /><span>Calendar</span><select value={draft.calendarId} onChange={e => setDraft({ ...draft, calendarId: e.target.value, color: calendars.find(c => c.id === e.target.value)!.color })}>{calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><div><Clock3 size={15} /><span>Time zone</span><span>{Intl.DateTimeFormat().resolvedOptions().timeZone}</span></div>{draft.recurrence && <div><Repeat2 size={15} /><span>Repeats</span><span>{draft.recurrence}</span></div>}</div>
    {event.taskId && <div className="detail-section"><button className="scheduled-link" type="button" onClick={() => onTask(event.taskId!)}><Link2 size={16} /><div><strong>Linked task</strong><span>Open task and notes</span></div><ArrowUpRight size={14} /></button></div>}
    <div className="detail-section"><div className="event-field"><Users size={15} /><span>{draft.guests?.join(", ") || "Just you"}</span></div>{draft.meeting && <div className="event-field"><Video size={15} /><span className="muted">Sample meeting link</span></div>}<label className="event-field"><MapPin size={15} /><input aria-label="Location" placeholder="Add a location" value={draft.location ?? ""} onChange={e => setDraft({ ...draft, location: e.target.value })} /></label></div>
    <div className="detail-section"><div className="label-heading"><FileText size={14} /> DESCRIPTION <button type="button" aria-label="Edit event description" onClick={() => setEditingNotes(!editingNotes)}><Pencil size={14} /></button></div>{editingNotes ? <MarkdownEditor aria-label="Event description" value={draft.description ?? ""} onValueChange={description => setDraft({ ...draft, description })} showControls={false} /> : <div className="detail-markdown"><ReactMarkdown>{draft.description || "Add a little context…"}</ReactMarkdown></div>}</div>
    <div className="detail-actions"><button className="primary-button full" type="submit">Save changes</button><span className="muted">Sample event · changes stay in this tab</span></div>
  </form>;
}
