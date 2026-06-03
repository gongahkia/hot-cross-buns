import { useEffect } from "react";
import type { Dispatch, KeyboardEvent, ReactNode, SetStateAction } from "react";
import { CalendarClock, FileText, Flag, List, ListPlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useDirtyState, useInspector } from "../../../components/Inspector";
import { EmojiInput, EmojiTextarea } from "../../../components/EmojiTextField";
import { Badge, Button, cx, Input } from "../../../components/primitives";
import type { useCoreViewModelSource } from "../coreViewModelSource";
import type { CorePriority, TaskViewModel } from "../coreViewModels";
import { MarkdownPreview } from "../MarkdownPreview";

export interface TaskDraft {
  mode: "create" | "edit";
  id?: string;
  title: string;
  notes: string;
  dueDate: string;
  listId: string;
  parentId: string;
  priority: CorePriority;
}

export function taskDraftsEqual(left: TaskDraft, right: TaskDraft): boolean {
  return (
    left.mode === right.mode &&
    left.id === right.id &&
    left.title === right.title &&
    left.notes === right.notes &&
    left.dueDate === right.dueDate &&
    left.listId === right.listId &&
    left.parentId === right.parentId &&
    left.priority === right.priority
  );
}

function taskPriorityLabel(priority: CorePriority): string {
  return priority === "none" ? "None" : `${priority[0].toUpperCase()}${priority.slice(1)}`;
}

function TaskDetailLine({
  children,
  icon: Icon,
  label
}: {
  children: ReactNode;
  icon?: LucideIcon;
  label?: string;
}): JSX.Element {
  return (
    <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-3">
      <div className="pt-0.5 text-text-muted">
        {Icon ? <Icon aria-hidden="true" size={16} /> : null}
      </div>
      <div className="min-w-0">
        {label ? (
          <div className="text-[var(--text-xs)] font-semibold uppercase text-text-muted">{label}</div>
        ) : null}
        <div className="min-w-0 text-[var(--text-base)] leading-relaxed text-text-primary">{children}</div>
      </div>
    </div>
  );
}

function taskAccentClass(priority: CorePriority, completed: boolean): string {
  if (completed) {
    return "bg-success";
  }

  if (priority === "high") {
    return "bg-danger";
  }

  if (priority === "medium") {
    return "bg-warning";
  }

  if (priority === "low") {
    return "bg-accent";
  }

  return "bg-text-muted";
}

export function TaskInspectorDetails({
  draft,
  parentOptions,
  source,
  task
}: {
  draft: TaskDraft;
  parentOptions: TaskViewModel[];
  source: ReturnType<typeof useCoreViewModelSource>;
  task?: TaskViewModel | null;
}): JSX.Element {
  const listTitle = source.taskLists.find((list) => list.id === draft.listId)?.title ?? "Task list";
  const parentTitle =
    parentOptions.find((candidate) => candidate.id === draft.parentId)?.title ??
    (draft.parentId ? "Parent task" : "No parent");
  const statusLabel = task?.status === "completed" ? "Completed" : "Open";
  const completed = task?.status === "completed";
  const priorityLabel = taskPriorityLabel(draft.priority);
  const notes = draft.notes.trim();

  return (
    <div className="grid gap-5 py-1">
      <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-4">
        <span
          aria-hidden="true"
          className={`mt-2 size-3.5 rounded-hcbSm ${taskAccentClass(draft.priority, completed)}`}
        />
        <div className="min-w-0">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <h3 className={cx(
              "min-w-0 break-words text-[var(--text-2xl)] font-semibold leading-tight",
              completed ? "text-text-muted line-through" : "text-text-primary"
            )}>
              {draft.title || "Untitled task"}
            </h3>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-[var(--text-xs)] text-text-muted">
            <Badge tone={completed ? "success" : "neutral"}>{statusLabel}</Badge>
            <Badge tone="neutral">{listTitle}</Badge>
            {draft.priority !== "none" ? (
              <Badge tone={draft.priority === "high" ? "danger" : draft.priority === "medium" ? "warning" : "accent"}>
                {priorityLabel}
              </Badge>
            ) : null}
            {draft.dueDate ? <Badge tone="neutral">{draft.dueDate}</Badge> : null}
          </div>
        </div>
      </div>

      {notes ? (
        <TaskDetailLine icon={FileText}>
          <MarkdownPreview
            ariaLabel="Task notes preview"
            body={notes}
            emptyDescription="No notes"
            emptyTitle="No notes"
            variant="plain"
          />
        </TaskDetailLine>
      ) : null}

      {draft.dueDate ? (
        <TaskDetailLine icon={CalendarClock}>
          {draft.dueDate}
        </TaskDetailLine>
      ) : null}

      {draft.priority !== "none" ? (
        <TaskDetailLine icon={Flag}>
          {priorityLabel}
        </TaskDetailLine>
      ) : null}

      <TaskDetailLine icon={List}>
        {listTitle}
      </TaskDetailLine>

      {draft.parentId ? (
        <TaskDetailLine icon={ListPlus}>
          {parentTitle}
        </TaskDetailLine>
      ) : null}

      {task?.subtasks.length ? (
        <TaskDetailLine icon={ListPlus} label="Subtasks">
          <div className="grid gap-2">
            {task.subtasks.map((subtask) => (
              <div className="flex items-center gap-2 text-text-secondary" key={subtask.id}>
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-accent"
                />
                <span className={subtask.completed ? "line-through" : undefined}>{subtask.title}</span>
              </div>
            ))}
          </div>
        </TaskDetailLine>
      ) : null}
    </div>
  );
}

export function TaskInspectorBody({
  canSaveTask,
  draft,
  onAddSubtask,
  onDelete,
  onSave,
  parentOptions,
  setDraft,
  source
}: {
  draft: TaskDraft;
  setDraft: Dispatch<SetStateAction<TaskDraft>>;
  source: ReturnType<typeof useCoreViewModelSource>;
  parentOptions: TaskViewModel[];
  canSaveTask: boolean;
  onSave: () => Promise<void> | void;
  onAddSubtask: () => void;
  onDelete: () => Promise<void> | void;
}): JSX.Element {
  const dirty = useDirtyState<TaskDraft>(draft);
  const { update } = useInspector();

  useEffect(() => {
    setDraft((current) => (taskDraftsEqual(current, dirty.value) ? current : dirty.value));
  }, [dirty.value, setDraft]);

  useEffect(() => {
    update({ dirty: dirty.isDirty });
  }, [dirty.isDirty, update]);

  function patchDraft(partial: Partial<TaskDraft>): void {
    dirty.patch(partial);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSaveTask) {
      event.preventDefault();
      void onSave();
      return;
    }

    if (
      (event.metaKey || event.ctrlKey) &&
      (event.key === "Backspace" || event.key === "Delete") &&
      dirty.value.mode === "edit"
    ) {
      event.preventDefault();
      void onDelete();
    }
  }

  return (
    <div className="grid gap-3" onKeyDown={handleKeyDown}>
      <EmojiInput
        aria-label="Task title"
        onValueChange={(title) => patchDraft({ title })}
        placeholder="Task title"
        value={dirty.value.title}
      />
      <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
        <span>List</span>
        <select
          aria-label="Task list"
          className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          disabled={source.taskLists.length === 0}
          onChange={(event) => patchDraft({ listId: event.target.value })}
          value={dirty.value.listId}
        >
          {source.taskLists.length === 0 ? <option value="">No lists available</option> : null}
          {source.taskLists.map((taskList) => (
            <option key={taskList.id} value={taskList.id}>
              {taskList.title}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Input
          aria-label="Task due date"
          onChange={(event) => patchDraft({ dueDate: event.target.value })}
          type="date"
          value={dirty.value.dueDate}
        />
        <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
          <span>Priority</span>
          <select
            aria-label="Task priority"
            className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onChange={(event) => patchDraft({ priority: event.target.value as CorePriority })}
            value={dirty.value.priority}
          >
            <option value="none">None</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
        <span>Parent</span>
        <select
          aria-label="Parent task"
          className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onChange={(event) => patchDraft({ parentId: event.target.value })}
          value={dirty.value.parentId}
        >
          <option value="">No parent</option>
          {parentOptions.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
      </label>
      <EmojiTextarea
        aria-label="Task notes"
        className="min-h-20 w-full resize-none rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-base)] text-text-primary placeholder:text-text-muted transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onValueChange={(notes) => patchDraft({ notes })}
        placeholder="Notes"
        value={dirty.value.notes}
      />
      <div className="flex items-center gap-2">
        <Button disabled={dirty.value.mode !== "edit"} onClick={onAddSubtask} size="sm" variant="secondary">
          <ListPlus aria-hidden="true" size={14} />
          Add subtask
        </Button>
      </div>
    </div>
  );
}
