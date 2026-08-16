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
import type { GoogleTask, GoogleTaskList, TaskInput, TaskMoveInput } from "@/types";

export interface TaskPanelCommand {
  readonly id: string;
  readonly type: "new-task" | "open-task";
  readonly taskId?: string;
}

interface TaskPanelProps {
  readonly taskLists: readonly GoogleTaskList[];
  readonly tasks: readonly GoogleTask[];
  readonly search: string;
  readonly command?: TaskPanelCommand;
  createTaskList(title: string): Promise<void>;
  updateTaskList(taskList: GoogleTaskList, title: string): Promise<void>;
  deleteTaskList(taskList: GoogleTaskList): Promise<void>;
  createTask(listId: string, task: TaskInput): Promise<void>;
  updateTask(task: GoogleTask, patch: Partial<GoogleTask>): Promise<void>;
  toggleTask(task: GoogleTask): Promise<void>;
  deleteTask(task: GoogleTask): Promise<void>;
  moveTask(task: GoogleTask, move: TaskMoveInput): Promise<void>;
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
  onToggle,
  onEdit
}: {
  readonly task: GoogleTask;
  readonly depth: number;
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
      </button>
    </li>
  );
}

export function TaskPanel({
  taskLists,
  tasks,
  search,
  command,
  createTaskList,
  updateTaskList,
  deleteTaskList,
  createTask,
  updateTask,
  toggleTask,
  deleteTask,
  moveTask
}: TaskPanelProps): React.JSX.Element {
  const [selectedListId, setSelectedListId] = useState("");
  const [newListTitle, setNewListTitle] = useState("");
  const [listTitle, setListTitle] = useState("");
  const [title, setTitle] = useState("");
  const [editingTask, setEditingTask] = useState<GoogleTask | undefined>();
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
  const visibleTasks = useMemo(() => flattenTaskTree(listTasks, query), [listTasks, query]);
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

  async function finishEdit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editingTask) {
      return;
    }
    const form = new FormData(event.currentTarget);
    const newTitle = String(form.get("title") ?? "").trim();
    const newNotes = String(form.get("notes") ?? "");
    const newDue = String(form.get("due") ?? "");
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
      await updateTask(taskForMove, { title: newTitle, notes: newNotes || undefined, due: dueTimestamp(newDue) });
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
          <h2 id="tasks-heading">Tasks and notes</h2>
        </div>
        <p className="field-help">Drag a task onto another task to make it a subtask. Drop near its top or bottom to reorder it.</p>
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
            {taskLists.length === 0 ? (
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
                {error && <p className="error" role="alert">{error}</p>}
                <SortableContext items={visibleTasks.map(({ task }) => `task:${task.id}`)} strategy={verticalListSortingStrategy}>
                  <ul className="task-list">
                    {visibleTasks.map(({ task, depth }) => (
                      <SortableTaskRow
                        key={task.id}
                        task={task}
                        depth={depth}
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
            <label>Notes<textarea name="notes" defaultValue={editingTask.notes ?? ""} rows={4} /></label>
            <label>Due date<input name="due" type="date" defaultValue={taskDueDate(editingTask)} /></label>
            <label>Task list<select name="list" defaultValue={editingTask.listId}>{taskLists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label>
            <label>Parent task<select name="parent" defaultValue={editingTask.parent ?? ""}><option value="">No parent</option>{parentChoices.map((task) => <option key={task.id} value={task.id}>{task.title || "Untitled task"}</option>)}</select></label>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="button-row"><button type="submit">Save task</button><button type="button" className="danger-button" onClick={() => void removeTask()}>Delete task</button></div>
          </form>
        </ModalDialog>
      )}
    </section>
  );
}
