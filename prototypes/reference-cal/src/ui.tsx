import { useId } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { addDays, addMonths, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { Check, ChevronLeft, ChevronRight, Circle, X } from "lucide-react";
import type { Task } from "./model";
import { TODAY } from "./model";

export function IconButton({ label, children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" title={label} aria-label={label} className={`icon-button ${className}`} {...props}>{children}</button>;
}
export function Modal({ open, onOpenChange, title, description, children, wide = false, className = "" }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode; wide?: boolean; className?: string;
}) {
  const descriptionId = useId();
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="prototype-overlay" />
    <Dialog.Content className={`prototype-modal ${wide ? "modal-wide" : ""} ${className}`} aria-describedby={description ? descriptionId : undefined}>
      <div className="modal-heading"><div><Dialog.Title>{title}</Dialog.Title>{description && <Dialog.Description id={descriptionId}>{description}</Dialog.Description>}</div><Dialog.Close asChild><IconButton label="Close dialog"><X size={18} /></IconButton></Dialog.Close></div>
      {children}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
export function MiniCalendar({ date, month, setMonth, onSelect }: { date: Date; month: Date; setMonth: (date: Date) => void; onSelect: (date: Date) => void }) {
  const first = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  return <section className="mini-calendar" aria-label="Date picker">
    <div className="mini-heading"><strong>{format(month, "MMMM yyyy")}</strong><div className="flex"><IconButton label="Previous mini-calendar month" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft size={15} /></IconButton><IconButton label="Next mini-calendar month" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={15} /></IconButton></div></div>
    <div className="mini-grid">{["M", "T", "W", "T", "F", "S", "S"].map((day, i) => <span className="mini-weekday" key={i}>{day}</span>)}
      {Array.from({ length: 42 }, (_, i) => { const day = addDays(first, i); return <button key={i} type="button" aria-label={format(day, "EEEE, MMMM d, yyyy")} aria-pressed={isSameDay(date, day)} className={`mini-date ${!isSameMonth(day, month) ? "outside" : ""} ${isSameDay(TODAY, day) ? "today" : ""} ${isSameDay(date, day) ? "chosen" : ""}`} onClick={() => onSelect(day)}><span>{format(day, "d")}</span></button>; })}
    </div>
  </section>;
}
export function TaskRow({ task, selected = false, scheduled = false, onSelect, onComplete, onSchedule }: {
  task: Task; selected?: boolean; scheduled?: boolean; onSelect: () => void; onComplete: () => void; onSchedule?: () => void;
}) {
  return <div className={`task-row ${selected ? "selected" : ""} ${task.completed ? "completed" : ""} ${task.parentId ? "subtask" : ""}`} draggable={!task.completed} onDragStart={event => event.dataTransfer.setData("application/x-hcb-prototype-task", task.id)}>
    <button className="task-check" type="button" aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`} aria-pressed={Boolean(task.completed)} onClick={onComplete}>{task.completed ? <Check size={13} strokeWidth={2} /> : <Circle size={17} strokeWidth={1.5} />}</button>
    <button type="button" className="task-main" onClick={onSelect}><span className="task-title">{task.title}</span><span className="task-meta">{task.list}{task.priority === "High" && <><span>·</span><span className="priority-dot" />High priority</>}{scheduled && <><span>·</span>On calendar</>}</span></button>
    <span className="duration">{task.minutes}m</span>
    {onSchedule && !task.completed && !scheduled && <button className="schedule-small" type="button" title={`Schedule ${task.title}`} aria-label={`Schedule ${task.title}`} onClick={onSchedule}>+</button>}
  </div>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) { return <div className="empty-state"><Circle size={24} strokeWidth={1} /><h3>{title}</h3><p>{children}</p></div>; }
export function Tag({ children }: { children: ReactNode }) { return <span className="tag">{children}</span>; }
