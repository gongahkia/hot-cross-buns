import { useState } from "react";
import { Columns3, List, Plus, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import type { PlanEvent, Task } from "./model";
import { dayKey, lists, TODAY } from "./model";
import { Empty, IconButton, TaskRow } from "./ui";

export function TasksView({ tasks, events, filterList, onFilterList, selected, onSelect, onComplete, onSchedule, onPlan, onNew }: {
  tasks: Task[]; events: PlanEvent[]; filterList: string; onFilterList: (list: string) => void; selected?: string;
  onSelect: (id: string) => void; onComplete: (id: string) => void; onSchedule: (id: string) => void; onPlan: () => void; onNew: () => void;
}) {
  const [tab, setTab] = useState("Today"); const [query, setQuery] = useState(""); const [board, setBoard] = useState(false); const [priority, setPriority] = useState(false);
  const visible = tasks.filter(t => (filterList === "All tasks" || filterList === t.list) && (tab === "Completed" ? t.completed : !t.completed) && (tab !== "Today" || t.due === dayKey(TODAY)) && (tab !== "Upcoming" || t.due > dayKey(TODAY)) && `${t.title} ${t.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const ordered = priority ? [...visible].sort((a, b) => ["High", "Medium", "Low"].indexOf(a.priority) - ["High", "Medium", "Low"].indexOf(b.priority)) : visible;
  const row = (t: Task) => <TaskRow key={t.id} task={t} selected={selected === t.id} scheduled={events.some(e => e.taskId === t.id)} onSelect={() => onSelect(t.id)} onComplete={() => onComplete(t.id)} onSchedule={() => onSchedule(t.id)} />;
  return <div className="tasks-workspace"><div className="tasks-title"><div><div className="eyebrow">A LITTLE INTENTION GOES A LONG WAY</div><h1>{filterList === "All tasks" ? "Make room for what matters." : filterList}</h1><p>Your tasks, with a place to do them.</p></div><button className="primary-button" onClick={onPlan}><Sparkles size={15} />Plan my day</button></div>
    <div className="tasks-toolbar"><div className="section-tabs">{["Today", "All", "Upcoming", "Completed"].map(label => <button key={label} aria-pressed={tab === label} onClick={() => setTab(label)}>{label}{label === "Today" && <span>{tasks.filter(t => !t.completed && t.due === dayKey(TODAY)).length}</span>}</button>)}</div><div className="flex"><IconButton label="Sort by priority" aria-pressed={priority} onClick={() => setPriority(!priority)}><SlidersHorizontal size={16} /></IconButton><IconButton label="List layout" aria-pressed={!board} onClick={() => setBoard(false)}><List size={17} /></IconButton><IconButton label="Board layout" aria-pressed={board} onClick={() => setBoard(true)}><Columns3 size={17} /></IconButton></div></div>
    <div className="task-collection-tools"><div className="note-filter"><Search size={14} /><input aria-label="Filter tasks" placeholder="Filter tasks…" value={query} onChange={e => setQuery(e.target.value)} /></div><select aria-label="Task list" value={filterList} onChange={e => onFilterList(e.target.value)}>{["All tasks", ...lists].map(list => <option key={list}>{list}</option>)}</select><button className="subtle-button" onClick={onNew}><Plus size={15} />Add task</button></div>
    <div className={board ? "task-board" : "task-groups"}>{lists.filter(list => filterList === "All tasks" || filterList === list).map(list => { const items = ordered.filter(t => t.list === list); return <section className="task-group" key={list}><div className="task-group-heading"><span className={`list-dot list-${list.replaceAll(" ", "-")}`} /><strong>{list}</strong><span>{items.length}</span><IconButton label={`Add task to ${list}`} onClick={() => { onFilterList(list); onNew(); }}><Plus size={15} /></IconButton></div>{items.map(row)}{!items.length && <div className="quiet-empty">A little breathing room.</div>}</section>; })}{!visible.length && query && <Empty title="Nothing matches that search">Try a different word.</Empty>}</div>
    <div className="tasks-bottom-note">Drag a task from the day panel onto your calendar, or use + to review a time.</div>
  </div>;
}
