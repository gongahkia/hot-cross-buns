import { useEffect, useMemo, useState } from "react";

import type { GoogleTask, GoogleTaskList } from "@/types";

interface TaskPanelProps {
  readonly taskLists: readonly GoogleTaskList[];
  readonly tasks: readonly GoogleTask[];
  readonly search: string;
  createTask(listId: string, title: string, notes?: string): Promise<void>;
  toggleTask(task: GoogleTask): Promise<void>;
}

export function TaskPanel({ taskLists, tasks, search, createTask, toggleTask }: TaskPanelProps): React.JSX.Element {
  const [selectedListId, setSelectedListId] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!taskLists.some((list) => list.id === selectedListId)) {
      setSelectedListId(taskLists[0]?.id ?? "");
    }
  }, [selectedListId, taskLists]);

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return tasks
      .filter((task) => task.listId === selectedListId)
      .filter((task) => !query || `${task.title} ${task.notes ?? ""}`.toLocaleLowerCase().includes(query))
      .sort((left, right) => Number(left.status === "completed") - Number(right.status === "completed") || left.title.localeCompare(right.title));
  }, [search, selectedListId, tasks]);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedListId || !title.trim()) {
      return;
    }
    setError("");
    try {
      await createTask(selectedListId, title, notes);
      setTitle("");
      setNotes("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Task could not be saved");
    }
  }

  return (
    <section className="workspace-panel" aria-labelledby="tasks-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Google Tasks</p>
          <h2 id="tasks-heading">Tasks and notes</h2>
        </div>
        <label className="compact-field">
          <span>Task list</span>
          <select value={selectedListId} onChange={(event) => setSelectedListId(event.target.value)}>
            {taskLists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}
          </select>
        </label>
      </div>
      {taskLists.length === 0 ? (
        <p className="empty-state">No Google Task lists were found.</p>
      ) : (
        <>
          <form className="inline-form" onSubmit={(event) => void submit(event)}>
            <input aria-label="New task title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add a task" />
            <input aria-label="New task notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional note" />
            <button type="submit">Add</button>
          </form>
          {error && <p className="error" role="alert">{error}</p>}
          <ul className="task-list">
            {visibleTasks.map((task) => (
              <li key={task.id} className={task.status === "completed" ? "task completed" : "task"}>
                <input
                  aria-label={`Mark ${task.title} ${task.status === "completed" ? "incomplete" : "complete"}`}
                  checked={task.status === "completed"}
                  type="checkbox"
                  onChange={() => void toggleTask(task).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Task could not be updated"))}
                />
                <div>
                  <strong>{task.title || "Untitled task"}</strong>
                  {task.notes && <p>{task.notes}</p>}
                  {task.due && <small>Due {new Date(task.due).toLocaleDateString()}</small>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
