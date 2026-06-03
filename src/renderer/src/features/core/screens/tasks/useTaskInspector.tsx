import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Pencil, Save, Trash2, X } from "lucide-react";
import { useInspector } from "../../../../components/Inspector";
import { Button } from "../../../../components/primitives";
import { rendererNow, reportRendererTimingSince } from "../../../../hooks/useRenderTiming";
import type { useCoreViewModelSource } from "../../coreViewModelSource";
import { playCompletionSound } from "../../completionSounds";
import type { TaskViewModel } from "../../coreViewModels";
import {
  TaskInspectorDetails,
  TaskInspectorBody,
  taskDraftsEqual,
  type TaskDraft
} from "../../inspectors/TaskInspectorBody";
import {
  canSaveTaskDraft,
  defaultTaskListId,
  editTaskDraft,
  newTaskDraft,
  taskCreatePayload,
  taskInspectorTitle,
  taskParentOptions,
  taskUpdatePayload
} from "./taskDrafts";

type CoreViewModelSource = ReturnType<typeof useCoreViewModelSource>;

export interface TaskInspectorController {
  addSubtaskForTask: (task: TaskViewModel | null) => void;
  deleteTask: (taskId: string) => Promise<void>;
  openNewTask: (seed?: string | Partial<Omit<TaskDraft, "mode">>) => void;
  selectedTaskId: string | null;
  selectTask: (taskId: string) => void;
  toggleTask: (taskId: string) => Promise<void>;
}

export function useTaskInspector(source: CoreViewModelSource): TaskInspectorController {
  const {
    close: closeInspector,
    current: currentInspector,
    open: openInspector,
    update: updateInspector
  } = useInspector();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [draft, setDraftState] = useState<TaskDraft>(() => newTaskDraft(source));
  const [taskInspectorMode, setTaskInspectorModeState] = useState<"view" | "edit">("edit");
  const ownerIdRef = useRef(`task-inspector-${Math.random().toString(36).slice(2)}`);
  const taskDraftRef = useRef<TaskDraft>(draft);
  const taskDraftBaselineRef = useRef<TaskDraft>(draft);
  const taskInspectorDirtyRef = useRef(false);
  const taskInspectorInstanceRef = useRef(0);
  const taskInspectorModeRef = useRef<"view" | "edit">("edit");
  const setDraft = useCallback<Dispatch<SetStateAction<TaskDraft>>>((next) => {
    setDraftState((current) => {
      const resolved =
        typeof next === "function" ? (next as (value: TaskDraft) => TaskDraft)(current) : next;
      taskDraftRef.current = resolved;
      taskInspectorDirtyRef.current = !taskDraftsEqual(resolved, taskDraftBaselineRef.current);
      return resolved;
    });
  }, []);
  const selectedTask = selectedTaskId ? source.getTaskById(selectedTaskId) : null;
  const parentOptions = useMemo(
    () => taskParentOptions(source.largeTaskWindow, draft),
    [draft.id, source.largeTaskWindow]
  );
  const canSaveTask = canSaveTaskDraft(draft, source.taskMutationPending);

  function setTaskInspectorMode(mode: "view" | "edit"): void {
    taskInspectorModeRef.current = mode;
    setTaskInspectorModeState(mode);
  }

  useEffect(() => {
    const listId = defaultTaskListId(source);

    if (!listId) {
      return;
    }

    setDraft((current) => (current.listId ? current : { ...current, listId }));
  }, [source.taskLists, setDraft]);

  useEffect(() => {
    if (currentInspector?.kind !== "task" || currentInspector.ownerId !== ownerIdRef.current) {
      return;
    }

    const dirty = taskInspectorMode === "edit" && !taskDraftsEqual(draft, taskDraftBaselineRef.current);
    taskInspectorDirtyRef.current = dirty;
    updateInspector({
      actions: taskInspectorActions(draft, taskInspectorMode),
      body: taskInspectorBody(draft, taskInspectorMode),
      dirty,
      hideHeader: taskInspectorHidesHeader(draft, taskInspectorMode),
      title: taskInspectorTitle(draft)
    });
  }, [
    canSaveTask,
    currentInspector?.kind,
    currentInspector?.ownerId,
    draft,
    parentOptions,
    selectedTask?.id,
    selectedTask?.status,
    taskInspectorMode,
    source.taskLists,
    source.taskMutationPending,
    updateInspector
  ]);

  function canReplaceTaskInspector(): boolean {
    if (currentInspector?.kind !== "task") {
      return true;
    }

    if (currentInspector.ownerId !== ownerIdRef.current) {
      return !currentInspector.dirty;
    }

    return taskInspectorModeRef.current !== "edit" || !taskInspectorDirtyRef.current;
  }

  function taskInspectorBody(nextDraft: TaskDraft, mode = taskInspectorModeRef.current): ReactNode {
    if (nextDraft.mode === "edit" && mode === "view") {
      return (
        <TaskInspectorDetails
          draft={nextDraft}
          key={`view-${taskInspectorInstanceRef.current}`}
          parentOptions={taskParentOptions(source.largeTaskWindow, nextDraft)}
          source={source}
          task={selectedTask}
        />
      );
    }

    return (
      <TaskInspectorBody
        canSaveTask={canSaveTaskDraft(nextDraft, source.taskMutationPending)}
        draft={nextDraft}
        key={taskInspectorInstanceRef.current}
        onAddSubtask={addSubtaskDraft}
        onDelete={() => nextDraft.id ? void deleteTask(nextDraft.id) : undefined}
        onSave={saveTask}
        parentOptions={taskParentOptions(source.largeTaskWindow, nextDraft)}
        setDraft={setDraft}
        source={source}
      />
    );
  }

  function taskInspectorActions(nextDraft: TaskDraft, mode = taskInspectorModeRef.current): ReactNode {
    if (nextDraft.mode === "edit" && mode === "view") {
      return (
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              data-action-id="task.deleteSelected"
              onClick={() => nextDraft.id ? void deleteTask(nextDraft.id) : undefined}
              size="sm"
              variant="danger"
            >
              <Trash2 aria-hidden="true" size={14} />
              Delete
            </Button>
            <Button onClick={() => setTaskInspectorMode("edit")} size="sm" variant="secondary">
              <Pencil aria-hidden="true" size={14} />
              Edit
            </Button>
          </div>
          <Button onClick={() => void cancelTaskInspector()} size="sm" variant="ghost">
            <X aria-hidden="true" size={14} />
            Close
          </Button>
        </div>
      );
    }

    return (
      <>
        {nextDraft.mode === "edit" ? (
          <Button
            data-action-id="task.deleteSelected"
            onClick={() => nextDraft.id ? void deleteTask(nextDraft.id) : undefined}
            size="sm"
            variant="danger"
          >
            <Trash2 aria-hidden="true" size={14} />
            Delete
          </Button>
        ) : null}
        <Button onClick={() => void cancelTaskInspector()} size="sm" variant="ghost">
          <X aria-hidden="true" size={14} />
          Cancel
        </Button>
        <Button
          disabled={!canSaveTaskDraft(nextDraft, source.taskMutationPending)}
          onClick={() => void saveTask()}
          size="sm"
          variant="primary"
        >
          <Save aria-hidden="true" size={14} />
          Save
        </Button>
      </>
    );
  }

  function taskInspectorHidesHeader(nextDraft: TaskDraft, mode = taskInspectorModeRef.current): boolean {
    return nextDraft.mode === "edit" && mode === "view";
  }

  function openTaskInspector(
    nextDraft: TaskDraft,
    mode: "view" | "edit" = nextDraft.mode === "edit" ? "view" : "edit"
  ): void {
    taskInspectorInstanceRef.current += 1;
    taskDraftBaselineRef.current = nextDraft;
    taskDraftRef.current = nextDraft;
    taskInspectorDirtyRef.current = false;
    setTaskInspectorMode(mode);
    setDraft(nextDraft);
    openInspector({
      actions: taskInspectorActions(nextDraft, mode),
      body: taskInspectorBody(nextDraft, mode),
      dirty: false,
      hideHeader: taskInspectorHidesHeader(nextDraft, mode),
      id: nextDraft.id ?? "new",
      kind: "task",
      onConfirmClose: () => taskInspectorModeRef.current !== "edit" || !taskInspectorDirtyRef.current,
      ownerId: ownerIdRef.current,
      title: taskInspectorTitle(nextDraft)
    });
  }

  function openNewTask(seed?: string | Partial<Omit<TaskDraft, "mode">>): void {
    if (!canReplaceTaskInspector()) {
      return;
    }

    const draftSeed = typeof seed === "string" ? { listId: seed } : seed ?? {};

    setSelectedTaskId(null);
    openTaskInspector(newTaskDraft(source, draftSeed), "edit");
  }

  function selectTask(taskId: string): void {
    if (!canReplaceTaskInspector()) {
      return;
    }

    const task = source.getTaskById(taskId);
    setSelectedTaskId(taskId);
    openTaskInspector(editTaskDraft(task), "view");
  }

  async function saveTask(): Promise<void> {
    const currentDraft = taskDraftRef.current;

    if (!canSaveTaskDraft(currentDraft, source.taskMutationPending)) {
      return;
    }

    const saved = currentDraft.mode === "edit"
      ? await source.updateTask(taskUpdatePayload(currentDraft))
      : await source.createTask(taskCreatePayload(currentDraft));

    if (saved) {
      const nextDraft = newTaskDraft(source, { listId: currentDraft.listId });
      taskDraftBaselineRef.current = nextDraft;
      taskDraftRef.current = nextDraft;
      taskInspectorDirtyRef.current = false;
      setTaskInspectorMode("edit");
      setSelectedTaskId(null);
      setDraft(nextDraft);
      await closeInspector();
    }
  }

  async function toggleTask(taskId: string): Promise<void> {
    const task = source.getTaskById(taskId);
    const startedAt = rendererNow();
    const action = task.status === "completed" ? "reopen" : "complete";
    let saved = false;

    if (task.status === "completed") {
      saved = await source.reopenTask(taskId);
      reportRendererTimingSince("tasks.completion", startedAt, {
        action,
        saved
      });
      return;
    }

    saved = await source.completeTask(taskId);
    if (saved && source.settings.taskCompletionSoundEnabled) {
      playCompletionSound(source.settings.taskCompletionSoundId);
    }
    reportRendererTimingSince("tasks.completion", startedAt, {
      action,
      saved
    });
  }

  async function deleteTask(taskId: string): Promise<void> {
    const deleted = await source.deleteTask(taskId);

    if (deleted && selectedTaskId === taskId) {
      const nextDraft = newTaskDraft(source);
      taskDraftBaselineRef.current = nextDraft;
      taskDraftRef.current = nextDraft;
      taskInspectorDirtyRef.current = false;
      setTaskInspectorMode("edit");
      setSelectedTaskId(null);
      setDraft(nextDraft);
      await closeInspector();
    }
  }

  async function cancelTaskInspector(): Promise<void> {
    const nextDraft = newTaskDraft(source, { listId: taskDraftRef.current.listId });
    taskDraftBaselineRef.current = nextDraft;
    taskDraftRef.current = nextDraft;
    taskInspectorDirtyRef.current = false;
    setTaskInspectorMode("edit");
    setSelectedTaskId(null);
    setDraft(nextDraft);
    await closeInspector();
  }

  function addSubtaskDraft(): void {
    addSubtaskForTask(selectedTask);
  }

  function addSubtaskForTask(task: TaskViewModel | null): void {
    if (!task) {
      return;
    }

    setSelectedTaskId(null);
    openTaskInspector(
      newTaskDraft(source, {
        listId: task.listId,
        parentId: task.id
      }),
      "edit"
    );
  }

  return {
    addSubtaskForTask,
    deleteTask,
    openNewTask,
    selectedTaskId,
    selectTask,
    toggleTask
  };
}
