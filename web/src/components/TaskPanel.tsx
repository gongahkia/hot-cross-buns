import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { ModalDialog } from "@/components/ModalDialog";
import { parseTaskRecurrenceNotes, serializeTaskRecurrenceNotes, taskRecurrenceSummary, type TaskRecurrenceFrequency } from "@/features/taskRecurrence";
import type { GoogleCalendar, GoogleTask, GoogleTaskList, NotesProjectionMode, ScheduledTaskBlock, TaskInput, TaskMetadata, TaskMoveInput } from "@/types";
import type { BulkOperationResult, TaskBulkOperation } from "@/features/useWorkspace";

export interface TaskPanelCommand {
  readonly id: string;
  readonly type: "new-task" | "open-task";
  readonly taskId?: string;
}

interface TaskPanelProps {
  readonly taskLists: readonly GoogleTaskList[];
  readonly tasks: readonly GoogleTask[];
  readonly calendars?: readonly GoogleCalendar[];
  readonly metadata?: readonly TaskMetadata[];
  readonly scheduledTaskBlocks?: readonly ScheduledTaskBlock[];
  readonly notesProjectionMode?: NotesProjectionMode;
  readonly search: string;
  readonly command?: TaskPanelCommand;
  createTaskList(title: string): Promise<void>;
  updateTaskList(taskList: GoogleTaskList, title: string): Promise<void>;
  deleteTaskList(taskList: GoogleTaskList): Promise<void>;
  createTask(listId: string, task: TaskInput): Promise<unknown>;
  updateTask(task: GoogleTask, patch: Partial<GoogleTask>): Promise<void>;
  toggleTask(task: GoogleTask): Promise<void>;
  deleteTask(task: GoogleTask): Promise<void>;
  moveTask(task: GoogleTask, move: TaskMoveInput): Promise<void>;
  saveTaskMetadata?(taskId: string, update: Pick<TaskMetadata, "priority" | "dueTimeZone">): Promise<void>;
  scheduleTask?(task: GoogleTask, calendarId: string, start: string, end: string): Promise<void>;
  unscheduleTask?(taskId: string): Promise<void>;
  bulkTasks?(taskIds: readonly string[], operation: TaskBulkOperation): Promise<BulkOperationResult>;
}

interface FlatTask {
  readonly task: GoogleTask;
  readonly depth: number;
}

function taskSort(left: GoogleTask, right: GoogleTask): number {
  return (
    Number(left.status === "completed") - Number(right.status === "completed") ||
    (left.position ?? "").localeCompare(right.position ?? "") ||
    left.title.localeCompare(right.title)
  );
}

function priorityRank(priority: TaskMetadata["priority"] | undefined): number {
  return priority === "high" ? 0 : priority === "medium" ? 1 : priority === "low" ? 2 : 3;
}

function taskDueDate(task: GoogleTask): string {
  return task.due?.slice(0, 10) ?? "";
}

function dueTimestamp(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  return `${value}T12:00:00.000Z`;
}

function matchesTask(task: GoogleTask, query: string): boolean {
  return !query || `${task.title} ${task.notes ?? ""}`.toLocaleLowerCase().includes(query);
}

function flattenTaskTree(tasks: readonly GoogleTask[], query: string): FlatTask[] {
  const byParent = new Map<string | undefined, GoogleTask[]>();
  const availableIds = new Set(tasks.map((task) => task.id));
  for (const task of tasks) {
    const parent = task.parent && availableIds.has(task.parent) ? task.parent : undefined;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(task);
    byParent.set(parent, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort(taskSort);
  }
  const result: FlatTask[] = [];
  const append = (parent: string | undefined, depth: number): void => {
    for (const task of byParent.get(parent) ?? []) {
      const include = matchesTask(task, query) || hasMatchingDescendant(task.id);
      if (include) {
        result.push({ task, depth });
        append(task.id, depth + 1);
      }
    }
  };
  const hasMatchingDescendant = (parent: string): boolean => {
    for (const task of byParent.get(parent) ?? []) {
      if (matchesTask(task, query) || hasMatchingDescendant(task.id)) {
        return true;
      }
    }
    return false;
  };
  append(undefined, 0);
  return result;
}

function TaskListDropTarget({
  taskList,
  selected,
  select
}: {
  readonly taskList: GoogleTaskList;
  readonly selected: boolean;
  select(): void;
}): React.JSX.Element {
  const { isOver, setNodeRef } = useDroppable({ id: `list:${taskList.id}` });
  return (
    <li ref={setNodeRef} className={isOver ? "task-list-target is-over" : "task-list-target"}>
      <button type="button" className={selected ? "active" : ""} onClick={select}>{taskList.title}</button>
    </li>
  );
}

function SortableTaskRow({
  task,
  depth,
  priority,
  selected,
  onSelect,
  onToggle,
  onEdit
}: {
  readonly task: GoogleTask;
  readonly depth: number;
  readonly priority?: TaskMetadata["priority"];
  readonly selected: boolean;
  onSelect(): void;
  onToggle(): void;
  onEdit(): void;
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `task:${task.id}` });
  return (
    <li
      ref={setNodeRef}
      className={task.status === "completed" ? "task completed" : "task"}
      style={{ transform: CSS.Transform.toString(transform), transition, marginInlineStart: `${depth * 1.35}rem`, opacity: isDragging ? 0.45 : 1 }}
    >
      <button className="drag-handle" type="button" aria-label={`Move ${task.title || "untitled task"}`} {...attributes} {...listeners}>⠿</button>
      <input aria-label={`Select ${task.title || "untitled task"}`} checked={selected} type="checkbox" onChange={onSelect} />
      <input
        aria-label={`Mark ${task.title} ${task.status === "completed" ? "incomplete" : "complete"}`}
        checked={task.status === "completed"}
        type="checkbox"
        onChange={onToggle}
      />
      <button className="task-content" type="button" onClick={onEdit}>
        <strong>{task.title || "Untitled task"}</strong>
        {task.notes && <span>{task.notes}</span>}
        {task.due && <small>Due {new Date(task.due).toLocaleDateString()}</small>}
        {priority && priority !== "none" && <small>Priority: {priority}</small>}
        {parseTaskRecurrenceNotes(task.notes).marker && <small>{taskRecurrenceSummary(parseTaskRecurrenceNotes(task.notes).marker!)}</small>}
      </button>
    </li>
  );
}

export function TaskPanel({
  taskLists,
  tasks,
  calendars = [],
  metadata = [],
  scheduledTaskBlocks = [],
  notesProjectionMode = "mirrored",
  search,
  command,
  createTaskList,
  updateTaskList,
  deleteTaskList,
  createTask,
  updateTask,
  toggleTask,
  deleteTask,
  moveTask,
  saveTaskMetadata,
  scheduleTask,
  unscheduleTask,
  bulkTasks
}: TaskPanelProps): React.JSX.Element {
  const [selectedListId, setSelectedListId] = useState("");
  const [newListTitle, setNewListTitle] = useState("");
  const [listTitle, setListTitle] = useState("");
  const [title, setTitle] = useState("");
  const [editingTask, setEditingTask] = useState<GoogleTask | undefined>();
  const [selectedTaskIds, setSelectedTaskIds] = useState<readonly string[]>([]);
  const [surface, setSurface] = useState<"tasks" | "notes">(notesProjectionMode === "notes-only" ? "notes" : "tasks");
  const [bulkResult, setBulkResult] = useState<BulkOperationResult | undefined>();
  const [error, setError] = useState("");
  const quickAddRef = useRef<HTMLInputElement>(null);
  const taskTitleRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const selectedList = taskLists.find((list) => list.id === selectedListId);

  useEffect(() => {
    if (!taskLists.some((list) => list.id === selectedListId)) {
      setSelectedListId(taskLists[0]?.id ?? "");
    }
  }, [selectedListId, taskLists]);

  useEffect(() => {
    setListTitle(selectedList?.title ?? "");
  }, [selectedList?.id, selectedList?.title]);

  useEffect(() => {
    if (!command) {
      return;
    }
    if (command.type === "new-task") {
      queueMicrotask(() => quickAddRef.current?.focus());
      return;
    }
    const task = tasks.find((candidate) => candidate.id === command.taskId);
    if (task) {
      setSelectedListId(task.listId);
      setEditingTask(task);
    }
  }, [command, tasks]);

  const listTasks = useMemo(
    () => tasks.filter((task) => task.listId === selectedListId && !task.deleted),
    [selectedListId, tasks]
  );
  const query = search.trim().toLocaleLowerCase();
  const metadataByTaskId = useMemo(() => new Map(metadata.map((entry) => [entry.taskId, entry])), [metadata]);
  const visibleTasks = useMemo(() => flattenTaskTree(listTasks, query)
    .sort((left, right) => priorityRank(metadataByTaskId.get(left.task.id)?.priority) - priorityRank(metadataByTaskId.get(right.task.id)?.priority) || taskSort(left.task, right.task)), [listTasks, metadataByTaskId, query]);
  const notes = useMemo(() => tasks.filter((task) => !task.deleted && !task.parent && !task.due).filter((task) => matchesTask(task, query)), [query, tasks]);
  const parentChoices = useMemo(() => {
    if (!editingTask) {
      return [];
    }
    const descendants = new Set<string>();
    const collect = (parentId: string): void => {
      for (const candidate of listTasks.filter((task) => task.parent === parentId)) {
        descendants.add(candidate.id);
        collect(candidate.id);
      }
    };
    collect(editingTask.id);
    return listTasks.filter((task) => task.id !== editingTask.id && !descendants.has(task.id));
  }, [editingTask, listTasks]);
  const editingMetadata = editingTask ? metadataByTaskId.get(editingTask.id) : undefined;
  const editingRecurrence = editingTask ? parseTaskRecurrenceNotes(editingTask.notes) : undefined;
  const scheduledBlock = editingTask ? scheduledTaskBlocks.find((block) => block.taskId === editingTask.id) : undefined;

  useEffect(() => {
    setSelectedTaskIds((current) => current.filter((id) => tasks.some((task) => task.id === id && !task.deleted)));
  }, [tasks]);

  useEffect(() => {
    if (notesProjectionMode === "disabled" || notesProjectionMode === "mirrored") {
      setSurface("tasks");
    } else {
      setSurface("notes");
    }
  }, [notesProjectionMode]);

  async function submitNewList(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!newListTitle.trim()) {
      return;
    }
    setError("");
    try {
      await createTaskList(newListTitle);
      setNewListTitle("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Task list could not be created");
    }
  }

  async function saveListTitle(): Promise<void> {
    if (!selectedList || !listTitle.trim() || listTitle.trim() === selectedList.title) {
      return;
    }
    setError("");
    try {
      await updateTaskList(selectedList, listTitle);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Task-list name could not be saved");
    }
  }

  async function submitTask(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedListId || !title.trim()) {
      return;
    }
    setError("");
    try {
      await createTask(selectedListId, { title });
      setTitle("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Task could not be saved");
    }
  }

  async function runBulk(operation: TaskBulkOperation): Promise<void> {
    if (!bulkTasks || selectedTaskIds.length === 0) {
      return;
    }
    setError("");
    setBulkResult(undefined);
    try {
      const result = await bulkTasks(selectedTaskIds, operation);
      setBulkResult(result);
      if (result.failed.length === 0) {
        setSelectedTaskIds([]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The selected tasks could not be changed");
    }
  }

  function recurrenceNotes(form: FormData, task: GoogleTask, title: string, due: string, priority: TaskMetadata["priority"], dueTimeZone: string): string | undefined {
    const userNotes = String(form.get("notes") ?? "");
    const selectedFrequency = String(form.get("recurrence") ?? "none") as "none" | TaskRecurrenceFrequency;
    const existing = parseTaskRecurrenceNotes(task.notes);
    if (selectedFrequency === "none") {
      return userNotes || undefined;
    }
    if (task.parent) {
      throw new Error("Subtasks cannot use managed recurrence");
    }
    if (!due) {
      throw new Error("A recurring task needs a due date");
    }
    const interval = Number(form.get("recurrenceInterval") ?? "1");
    if (!Number.isInteger(interval) || interval < 1 || interval > 1_000) {
      throw new Error("Choose a recurrence interval between 1 and 1,000");
    }
    const endKind = String(form.get("recurrenceEnd") ?? "never");
    const end = endKind === "until"
      ? { kind: "until" as const, untilDate: String(form.get("recurrenceUntil") ?? "") }
      : endKind === "count"
        ? { kind: "count" as const, count: Number(form.get("recurrenceCount") ?? "") }
        : { kind: "never" as const };
    const seriesId = existing.marker?.seriesId ?? crypto.randomUUID();
    const ordinal = existing.marker?.ordinal ?? 0;
    const marker = {
      seriesId,
      occurrenceId: `${seriesId}:${ordinal}`,
      ordinal,
      frequency: selectedFrequency,
      interval,
      anchorDate: existing.marker?.anchorDate ?? due,
      timeZone: dueTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      end,
      recurrenceRule: existing.marker?.recurrenceRule ?? "",
      exclusionDates: existing.marker?.exclusionDates ?? [],
      additionDates: existing.marker?.additionDates ?? [],
      templateTitle: title,
      templateDueDate: due,
      templatePriority: priority
    };
    const serialized = serializeTaskRecurrenceNotes(userNotes, marker);
    if (!serialized.notes) {
      throw new Error(serialized.error ?? "The recurrence marker could not be saved");
    }
    return serialized.notes;
  }

  async function finishEdit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editingTask) {
      return;
    }
    const form = new FormData(event.currentTarget);
    const newTitle = String(form.get("title") ?? "").trim();
    const newNotes = String(form.get("notes") ?? "");
    const newDue = String(form.get("due") ?? "");
    const priority = String(form.get("priority") ?? "none") as TaskMetadata["priority"];
    const dueTimeZone = String(form.get("dueTimeZone") ?? "");
    const newListId = String(form.get("list") ?? editingTask.listId);
    const newParent = String(form.get("parent") ?? "") || undefined;
    if (!newTitle) {
      setError("Enter a task title");
      return;
    }
    const parentTask = newParent ? tasks.find((task) => task.id === newParent) : undefined;
    if (parentTask && parentTask.listId !== newListId) {
      setError("Choose a parent task from the same task list");
      return;
    }
    setError("");
    try {
      let taskForMove: GoogleTask = editingTask;
      if (newListId !== editingTask.listId) {
        await moveTask(editingTask, { destinationListId: newListId });
        taskForMove = { ...taskForMove, listId: newListId, parent: undefined };
      }
      if (newParent !== taskForMove.parent) {
        await moveTask(taskForMove, { parent: newParent });
        taskForMove = { ...taskForMove, parent: newParent };
      }
      const notes = recurrenceNotes(form, taskForMove, newTitle, newDue, priority, dueTimeZone);
      await updateTask(taskForMove, { title: newTitle, notes: (notes ?? newNotes) || undefined, due: dueTimestamp(newDue) });
      await saveTaskMetadata?.(taskForMove.id, { priority, dueTimeZone: dueTimeZone || undefined });
      setEditingTask(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Task could not be updated");
    }
  }

  async function removeTaskList(): Promise<void> {
    if (!selectedList || !window.confirm(`Delete the task list “${selectedList.title}” and its tasks?`)) {
      return;
    }
    setError("");
    try {
      await deleteTaskList(selectedList);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Task list could not be deleted");
    }
  }

  async function removeTask(): Promise<void> {
    if (!editingTask || !window.confirm(`Delete “${editingTask.title || "Untitled task"}”?`)) {
      return;
    }
    setError("");
    try {
      await deleteTask(editingTask);
      setEditingTask(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Task could not be deleted");
    }
  }

  async function scheduleEditingTask(container: HTMLElement): Promise<void> {
    if (!editingTask || !scheduleTask) return;
    const calendarId = (container.querySelector("select[name='scheduleCalendar']") as HTMLSelectElement | null)?.value ?? "";
    const start = (container.querySelector("input[name='scheduleStart']") as HTMLInputElement | null)?.value ?? "";
    const end = (container.querySelector("input[name='scheduleEnd']") as HTMLInputElement | null)?.value ?? "";
    if (!calendarId || !start || !end) {
      setError("Choose a calendar, start, and end time");
      return;
    }
    setError("");
    try {
      await scheduleTask(editingTask, calendarId, new Date(start).toISOString(), new Date(end).toISOString());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The task could not be scheduled");
    }
  }

  function previousSibling(task: GoogleTask, excludingId: string): GoogleTask | undefined {
    const siblings = listTasks.filter((candidate) => candidate.parent === task.parent && candidate.id !== excludingId).sort(taskSort);
    const index = siblings.findIndex((candidate) => candidate.id === task.id);
    return index > 0 ? siblings[index - 1] : undefined;
  }

  function wouldCreateCycle(source: GoogleTask, parentId: string): boolean {
    let current = listTasks.find((task) => task.id === parentId);
    while (current) {
      if (current.id === source.id) {
        return true;
      }
      current = current.parent ? listTasks.find((task) => task.id === current?.parent) : undefined;
    }
    return false;
  }

  function handleDragEnd(event: DragEndEvent): void {
    const sourceId = String(event.active.id).replace(/^task:/, "");
    const overId = event.over ? String(event.over.id) : "";
    const source = listTasks.find((task) => task.id === sourceId);
    if (!source || !overId || overId === `task:${source.id}`) {
      return;
    }
    let move: TaskMoveInput | undefined;
    if (overId.startsWith("list:")) {
      move = { destinationListId: overId.slice("list:".length) };
    } else if (overId.startsWith("task:")) {
      const target = listTasks.find((task) => task.id === overId.slice("task:".length));
      if (!target || wouldCreateCycle(source, target.id)) {
        return;
      }
      const translated = event.active.rect.current.translated;
      const center = (translated?.top ?? event.active.rect.current.initial?.top ?? 0) + (translated?.height ?? event.active.rect.current.initial?.height ?? 0) / 2;
      const targetHeight = event.over?.rect.height ?? 1;
      const ratio = (center - event.over!.rect.top) / targetHeight;
      if (ratio > 0.3 && ratio < 0.7) {
        move = { parent: target.id };
      } else if (ratio >= 0.7) {
        move = { parent: target.parent, previous: target.id };
      } else {
        const previous = previousSibling(target, source.id);
        move = { parent: target.parent, previous: previous?.id };
      }
    }
    if (move) {
      void moveTask(source, move).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Task could not be moved"));
    }
  }

  return (
    <section className="workspace-panel task-panel" aria-labelledby="tasks-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Google Tasks</p>
          <h2 id="tasks-heading">Tasks</h2>
        </div>
        <div className="button-row">
          <p className="field-help">Drag a task onto another task to make it a subtask. Drop near its top or bottom to reorder it.</p>
          {notesProjectionMode !== "disabled" && <div className="view-switcher" role="group" aria-label="Task projection"><button type="button" className={surface === "tasks" ? "active" : ""} onClick={() => setSurface("tasks")}>Tasks</button><button type="button" className={surface === "notes" ? "active" : ""} onClick={() => setSurface("notes")}>Notes</button></div>}
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="task-workspace">
          <aside className="task-sidebar" aria-label="Task lists">
            <ul className="task-list-tabs">
              {taskLists.map((taskList) => (
                <TaskListDropTarget key={taskList.id} taskList={taskList} selected={taskList.id === selectedListId} select={() => setSelectedListId(taskList.id)} />
              ))}
            </ul>
            <form className="list-create-form" onSubmit={(event) => void submitNewList(event)}>
              <input aria-label="New task-list name" value={newListTitle} onChange={(event) => setNewListTitle(event.target.value)} placeholder="New list" />
              <button type="submit">Add list</button>
            </form>
          </aside>
          <div className="task-main">
            {surface === "notes" ? (
              <>
                <div className="task-list-heading"><div><strong>Notes</strong><p className="field-help">Undated root Google Tasks. Changes remain ordinary Google Tasks.</p></div></div>
                <ul className="task-list">
                  {notes.map((task) => <SortableTaskRow key={task.id} task={task} depth={0} priority={metadataByTaskId.get(task.id)?.priority} selected={selectedTaskIds.includes(task.id)} onSelect={() => setSelectedTaskIds((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id])} onToggle={() => void toggleTask(task).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Task could not be updated"))} onEdit={() => setEditingTask(task)} />)}
                </ul>
                {notes.length === 0 && <p className="empty-state">No undated root tasks qualify as notes.</p>}
              </>
            ) : taskLists.length === 0 ? (
              <p className="empty-state">No Google Task lists were found.</p>
            ) : (
              <>
                <div className="task-list-heading">
                  <label className="compact-field">
                    <span>Current list</span>
                    <input value={listTitle} onChange={(event) => setListTitle(event.target.value)} onBlur={() => void saveListTitle()} />
                  </label>
                  <button type="button" className="danger-button" onClick={() => void removeTaskList()}>Delete list</button>
                </div>
                <form className="task-create-form" onSubmit={(event) => void submitTask(event)}>
                  <input ref={quickAddRef} aria-label="New task title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add a task — details can be added after" />
                  <button type="submit">Add task</button>
                </form>
                {selectedTaskIds.length > 0 && bulkTasks && <fieldset className="bulk-actions"><legend>{selectedTaskIds.length} selected task{selectedTaskIds.length === 1 ? "" : "s"}</legend><div className="button-row"><button type="button" onClick={() => void runBulk({ kind: "complete" })}>Complete</button><button type="button" className="danger-button" onClick={() => void runBulk({ kind: "delete" })}>Delete</button><select aria-label="Bulk priority" defaultValue=""><option value="" disabled>Set priority…</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="none">Clear priority</option></select><button type="button" onClick={(event) => { const select = event.currentTarget.previousElementSibling as HTMLSelectElement; if (select.value) void runBulk({ kind: "priority", priority: select.value as TaskMetadata["priority"] }); }}>Apply priority</button><button type="button" onClick={() => setSelectedTaskIds([])}>Clear selection</button></div><div className="bulk-form"><label>Move to<select aria-label="Bulk destination list" defaultValue=""> <option value="">Choose task list</option>{taskLists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label><button type="button" onClick={(event) => { const select = event.currentTarget.previousElementSibling?.querySelector("select") as HTMLSelectElement | null; if (select?.value) void runBulk({ kind: "move", destinationListId: select.value }); }}>Move selected</button><label>Due date<input aria-label="Bulk due date" type="date" /></label><button type="button" onClick={(event) => { const input = event.currentTarget.previousElementSibling?.querySelector("input") as HTMLInputElement | null; void runBulk({ kind: "due", due: dueTimestamp(input?.value ?? "") }); }}>Set due date</button></div></fieldset>}
                {error && <p className="error" role="alert">{error}</p>}
                {bulkResult && <p className={bulkResult.failed.length ? "error" : "status"} role="status">{bulkResult.succeeded.length} changed{bulkResult.failed.length ? `; ${bulkResult.failed.length} need attention: ${bulkResult.failed.map((entry) => entry.error).join(" · ")}` : ""}</p>}
                <SortableContext items={visibleTasks.map(({ task }) => `task:${task.id}`)} strategy={verticalListSortingStrategy}>
                  <ul className="task-list">
                    {visibleTasks.map(({ task, depth }) => (
                      <SortableTaskRow
                        key={task.id}
                        task={task}
                        depth={depth}
                        priority={metadataByTaskId.get(task.id)?.priority}
                        selected={selectedTaskIds.includes(task.id)}
                        onSelect={() => setSelectedTaskIds((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id])}
                        onToggle={() => void toggleTask(task).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Task could not be updated"))}
                        onEdit={() => setEditingTask(task)}
                      />
                    ))}
                  </ul>
                </SortableContext>
                {visibleTasks.length === 0 && <p className="empty-state">{query ? "No cached tasks match your search." : "No tasks in this list yet."}</p>}
              </>
            )}
          </div>
        </div>
      </DndContext>
      {editingTask && (
        <ModalDialog className="task-editor" labelledBy="edit-task-heading" initialFocusRef={taskTitleRef} onClose={() => setEditingTask(undefined)}>
          <form onSubmit={(event) => void finishEdit(event)}>
            <div className="panel-heading">
              <div><p className="eyebrow">Google Tasks</p><h2 id="edit-task-heading">Edit task</h2></div>
              <button type="button" onClick={() => setEditingTask(undefined)}>Close</button>
            </div>
            <label>Title<input ref={taskTitleRef} name="title" defaultValue={editingTask.title} required /></label>
            <datalist id="time-zones">{(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [Intl.DateTimeFormat().resolvedOptions().timeZone]).map((zone) => <option key={zone} value={zone} />)}</datalist>
            {editingRecurrence?.state === "malformed" && <p className="error" role="alert">{editingRecurrence.diagnostic}. Saving without recurrence will preserve this text as notes.</p>}
            {editingRecurrence?.state === "unsupported-version" && <p className="error" role="alert">{editingRecurrence.diagnostic}. This browser will not silently modify it.</p>}
            <label>Notes<textarea name="notes" defaultValue={editingRecurrence?.userNotes ?? editingTask.notes ?? ""} rows={4} /></label>
            <label>Due date<input name="due" type="date" defaultValue={taskDueDate(editingTask)} /></label>
            <label>Due date time zone<input name="dueTimeZone" list="time-zones" defaultValue={editingMetadata?.dueTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone} /></label>
            <label>Priority<select name="priority" defaultValue={editingMetadata?.priority ?? "none"}><option value="none">No local priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
            <fieldset className="recurrence-editor"><legend>Managed task recurrence</legend><p className="field-help">This writes the portable HCB marker to Google Task notes; Google Tasks itself has no recurrence field.</p><label>Repeat<select name="recurrence" defaultValue={editingRecurrence?.marker?.frequency ?? "none"}><option value="none">Does not repeat</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option><option value="yearly">Every year</option></select></label><label>Every <input name="recurrenceInterval" type="number" min="1" max="1000" defaultValue={editingRecurrence?.marker?.interval ?? 1} /></label><label>Ends<select name="recurrenceEnd" defaultValue={editingRecurrence?.marker?.end.kind ?? "never"}><option value="never">Never</option><option value="until">On date</option><option value="count">After count</option></select></label><label>Final date<input name="recurrenceUntil" type="date" defaultValue={editingRecurrence?.marker?.end.kind === "until" ? editingRecurrence.marker.end.untilDate : ""} /></label><label>Occurrence count<input name="recurrenceCount" type="number" min="1" max="10000" defaultValue={editingRecurrence?.marker?.end.kind === "count" ? editingRecurrence.marker.end.count : ""} /></label>{editingRecurrence?.marker && <p className="field-help">{taskRecurrenceSummary(editingRecurrence.marker)}</p>}</fieldset>
            <label>Task list<select name="list" defaultValue={editingTask.listId}>{taskLists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label>
            <label>Parent task<select name="parent" defaultValue={editingTask.parent ?? ""}><option value="">No parent</option>{parentChoices.map((task) => <option key={task.id} value={task.id}>{task.title || "Untitled task"}</option>)}</select></label>
            <fieldset className="recurrence-editor"><legend>Schedule in Calendar</legend>{scheduledBlock ? <><p className="field-help">Scheduled on {calendars.find((calendar) => calendar.id === scheduledBlock.calendarId)?.summary ?? scheduledBlock.calendarId}. The event is retained if you unschedule this task.</p><button type="button" onClick={() => void unscheduleTask?.(editingTask.id)}>Unschedule task</button></> : scheduleTask ? <><label>Calendar<select name="scheduleCalendar"><option value="">Choose calendar</option>{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}</select></label><label>Starts<input name="scheduleStart" type="datetime-local" /></label><label>Ends<input name="scheduleEnd" type="datetime-local" /></label><button type="button" onClick={(event) => void scheduleEditingTask(event.currentTarget.parentElement!)}>Schedule task</button></> : <p className="field-help">Calendar scheduling is unavailable until Calendar access is connected.</p>}</fieldset>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="button-row"><button type="submit">Save task</button><button type="button" className="danger-button" onClick={() => void removeTask()}>Delete task</button></div>
          </form>
        </ModalDialog>
      )}
    </section>
  );
}
