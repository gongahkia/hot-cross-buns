import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { ArrowRightLeft, Copy, Pencil, Save, Trash2 } from "lucide-react";
import { useInspector, type InspectorDirtyState } from "../../../../components/Inspector";
import { Button } from "../../../../components/primitives";
import { rendererNow, reportRendererTimingSince } from "../../../../hooks/useRenderTiming";
import type { useCoreViewModelSource } from "../../coreViewModelSource";
import { playCompletionSound } from "../../completionSounds";
import {
  conversionCleanup,
  dispatchConvertCommand,
  type ConvertSourceCleanup
} from "../../conversionEvents";
import { copiedTitle } from "../../copyLabels";
import type { TaskViewModel } from "../../coreViewModels";
import {
  TaskInspectorDetails,
  TaskInspectorBody,
  taskDraftsEqual,
  type TaskDraft
} from "../../inspectors/TaskInspectorBody";
import type { CalendarEventDraft } from "../calendar/types";
import {
  canSaveTaskDraft,
  defaultTaskListId,
  duplicateTaskDraft,
  editTaskDraft,
  newTaskDraft,
  taskCreatePayload,
  taskInspectorTitle,
  taskParentOptions,
  taskUpdatePayload
} from "./taskDrafts";

type CoreViewModelSource = ReturnType<typeof useCoreViewModelSource>;

interface InspectorFlagState extends InspectorDirtyState {
  set: (value: boolean) => void;
}

function createInspectorFlagState(initialValue = false): InspectorFlagState {
  let value = initialValue;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => value,
    set: (next) => {
      if (next === value) {
        return;
      }

      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

function TaskInspectorSaveAction({
  canSaveState,
  mode,
  onSave
}: {
  canSaveState: InspectorFlagState;
  mode: TaskDraft["mode"];
  onSave: () => Promise<void>;
}): JSX.Element {
  const canSave = useSyncExternalStore(
    canSaveState.subscribe,
    canSaveState.getSnapshot,
    canSaveState.getSnapshot
  );

  return (
    <Button disabled={!canSave} onClick={() => void onSave()} size="sm" variant="primary">
      <Save aria-hidden="true" size={14} />
      {mode === "create" ? "Add task" : "Save changes"}
    </Button>
  );
}

export interface TaskInspectorController {
  addSubtaskForTask: (task: TaskViewModel | null) => void;
  deleteTask: (taskId: string) => Promise<void>;
  duplicateTask: (taskId: string) => void;
  openNewTask: (
    seed?: string | Partial<Omit<TaskDraft, "mode">> | TaskDraft,
    cleanup?: ConvertSourceCleanup
  ) => void;
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
  const conversionCleanupRef = useRef<ConvertSourceCleanup | null>(null);
  const taskInspectorDirtyStateRef = useRef<InspectorFlagState | null>(null);
  const taskInspectorCanSaveStateRef = useRef<InspectorFlagState | null>(null);
  taskInspectorDirtyStateRef.current ??= createInspectorFlagState();
  taskInspectorCanSaveStateRef.current ??= createInspectorFlagState();
  const taskInspectorDirtyState = taskInspectorDirtyStateRef.current;
  const taskInspectorCanSaveState = taskInspectorCanSaveStateRef.current;
  const setDraft = useCallback<Dispatch<SetStateAction<TaskDraft>>>((next) => {
    setDraftState((current) => {
      const resolved =
        typeof next === "function" ? (next as (value: TaskDraft) => TaskDraft)(current) : next;
      taskDraftRef.current = resolved;
      return resolved;
    });
  }, []);
  const updateTaskDraftRef = useCallback((nextDraft: TaskDraft) => {
    taskDraftRef.current = nextDraft;
    const dirty = !taskDraftsEqual(nextDraft, taskDraftBaselineRef.current);
    taskInspectorDirtyRef.current = dirty;
    taskInspectorDirtyState.set(dirty);
  }, [taskInspectorDirtyState]);
  const updateTaskInspectorDirty = useCallback((dirty: boolean) => {
    taskInspectorDirtyRef.current = dirty;
    taskInspectorDirtyState.set(dirty);
  }, [taskInspectorDirtyState]);
  const setTaskInspectorCanSave = useCallback((canSave: boolean) => {
    taskInspectorCanSaveState.set(canSave);
  }, [taskInspectorCanSaveState]);
  const selectedTask = selectedTaskId ? source.getTaskById(selectedTaskId) : null;
  const parentOptions = useMemo(
    () => taskParentOptions(source.largeTaskWindow, taskDraftRef.current),
    [source.largeTaskWindow]
  );

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

    const dirty = taskInspectorMode === "edit" && taskInspectorDirtyRef.current;
    taskInspectorDirtyRef.current = dirty;
    taskInspectorDirtyState.set(dirty);
    updateInspector({
      actions: taskInspectorActions(draft, taskInspectorMode),
      body: taskInspectorBody(draft, taskInspectorMode),
      hideHeader: taskInspectorHidesHeader(draft, taskInspectorMode),
      title: taskInspectorScreenTitle(draft, taskInspectorMode)
    });
  }, [
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
      return !(currentInspector.dirtyState?.getSnapshot() ?? currentInspector.dirty);
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
          showTitle={false}
          source={source}
          task={selectedTask}
        />
      );
    }

    return (
      <TaskInspectorBody
        draft={nextDraft}
        key={taskInspectorInstanceRef.current}
        onAddSubtask={addSubtaskDraft}
        onCanSaveChange={setTaskInspectorCanSave}
        onDelete={() => nextDraft.id ? void deleteTask(nextDraft.id) : undefined}
        onDirtyChange={updateTaskInspectorDirty}
        onDraftChange={updateTaskDraftRef}
        onSave={saveTask}
        parentOptions={parentOptions}
        mutationPending={source.taskMutationPending}
        source={source}
      />
    );
  }

  function taskInspectorActions(
    nextDraft: TaskDraft,
    mode = taskInspectorModeRef.current
  ): ReactNode {
    if (nextDraft.mode === "edit" && mode === "view") {
      return (
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Button onClick={() => setTaskInspectorMode("edit")} size="sm" variant="primary">
              <Pencil aria-hidden="true" size={14} />
              Edit
            </Button>
            <details className="group relative">
              <summary className="flex h-8 cursor-pointer list-none items-center rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-sm)] font-medium text-text-secondary hover:bg-surface-1 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">More actions</summary>
              <div className="absolute bottom-full right-0 z-20 mb-2 grid min-w-52 gap-1 rounded-hcbMd border border-border bg-bg-secondary p-1 shadow-xl">
                <Button onClick={() => duplicateTaskDraftValue(nextDraft)} size="sm" variant="ghost"><Copy aria-hidden="true" size={14} />Duplicate</Button>
                <Button onClick={() => convertTaskDraft(nextDraft, "event")} size="sm" variant="ghost"><ArrowRightLeft aria-hidden="true" size={14} />Create event from task</Button>
                <Button onClick={() => convertTaskDraft(nextDraft, "note")} size="sm" variant="ghost"><ArrowRightLeft aria-hidden="true" size={14} />Create note from task</Button>
              </div>
            </details>
            <Button
              data-action-id="task.deleteSelected"
              onClick={() => nextDraft.id ? void deleteTask(nextDraft.id) : undefined}
              size="sm"
              variant="danger"
            >
              <Trash2 aria-hidden="true" size={14} />
              Delete task
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
        <TaskInspectorSaveAction
          canSaveState={taskInspectorCanSaveState}
          mode={nextDraft.mode}
          onSave={saveTask}
        />
      </>
    );
  }

  function taskInspectorHidesHeader(nextDraft: TaskDraft, mode = taskInspectorModeRef.current): boolean {
    return false;
  }

  function openTaskInspector(
    nextDraft: TaskDraft,
    mode: "view" | "edit" = nextDraft.mode === "edit" ? "view" : "edit"
  ): void {
    taskInspectorInstanceRef.current += 1;
    taskDraftBaselineRef.current = nextDraft;
    taskDraftRef.current = nextDraft;
    taskInspectorDirtyRef.current = false;
    taskInspectorDirtyState.set(false);
    const canSave = canSaveTaskDraft(nextDraft, source.taskMutationPending);
    setTaskInspectorCanSave(canSave);
    setTaskInspectorMode(mode);
    setDraft(nextDraft);
    openInspector({
      actions: taskInspectorActions(nextDraft, mode),
      body: taskInspectorBody(nextDraft, mode),
      dirty: false,
      dirtyState: taskInspectorDirtyState,
      hideHeader: taskInspectorHidesHeader(nextDraft, mode),
      id: nextDraft.id ?? "new",
      kind: "task",
      onConfirmClose: () => taskInspectorModeRef.current !== "edit" || !taskInspectorDirtyRef.current,
      ownerId: ownerIdRef.current,
      title: taskInspectorScreenTitle(nextDraft, mode)
    });
  }

  function openNewTask(
    seed?: string | Partial<Omit<TaskDraft, "mode">> | TaskDraft,
    cleanup?: ConvertSourceCleanup
  ): void {
    if (!canReplaceTaskInspector()) {
      return;
    }

    const draftSeed = typeof seed === "string" ? { listId: seed } : seed ?? {};

    setSelectedTaskId(null);
    conversionCleanupRef.current = cleanup ?? null;
    openTaskInspector(isTaskDraft(draftSeed) ? draftSeed : newTaskDraft(source, draftSeed), "edit");
  }

  function selectTask(taskId: string): void {
    if (!canReplaceTaskInspector()) {
      return;
    }

    const task = source.getTaskById(taskId);
    setSelectedTaskId(taskId);
    conversionCleanupRef.current = null;
    openTaskInspector(editTaskDraft(task), "view");
  }

  function duplicateTask(taskId: string): void {
    if (!canReplaceTaskInspector()) {
      return;
    }

    const task = source.getTaskById(taskId);
    conversionCleanupRef.current = null;
    openDuplicateTaskDraft(duplicateTaskDraft(task));
  }

  function duplicateTaskDraftValue(sourceDraft: TaskDraft): void {
    openDuplicateTaskDraft({
      ...sourceDraft,
      id: undefined,
      mode: "create",
      title: copiedTitle(sourceDraft.title, "Untitled task")
    });
  }

  function openDuplicateTaskDraft(nextDraft: TaskDraft): void {
    setSelectedTaskId(null);
    conversionCleanupRef.current = null;
    openTaskInspector(newTaskDraft(source, nextDraft), "edit");
  }

  function convertTaskDraft(sourceDraft: TaskDraft, target: "event" | "note"): void {
    if (!sourceDraft.id) {
      return;
    }

    if (target === "event") {
      const cleanup = conversionCleanup("task", sourceDraft.id, target);
      dispatchConvertCommand({
        cleanup,
        target,
        eventDraft: taskEventDraft(sourceDraft)
      });
      return;
    }

    dispatchConvertCommand({
      cleanup: conversionCleanup("task", sourceDraft.id, target),
      target,
      noteDraft: {
        body: sourceDraft.notes,
        listId: sourceDraft.listId,
        title: sourceDraft.title
      }
    });
  }

  async function cleanupConvertedSource(): Promise<string | null> {
    const cleanup = conversionCleanupRef.current;

    if (!cleanup) {
      return null;
    }

    conversionCleanupRef.current = null;

    if (cleanup.kind === "event") {
      const result = await window.hcb?.calendar.delete({ id: cleanup.id });
      return result?.ok ? null : result?.error.message ?? "Original event was not removed.";
    }

    if (cleanup.kind === "note") {
      const result = await window.hcb?.notes.delete({ id: cleanup.id });
      return result?.ok ? null : result?.error.message ?? "Original note was not removed.";
    }

    const result = await window.hcb?.tasks.delete({ id: cleanup.id });
    return result?.ok ? null : result?.error.message ?? "Original task was not removed.";
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
      const cleanupError = await cleanupConvertedSource();
      if (cleanupError) {
        window.alert(`Converted item was saved, but ${cleanupError}`);
      }
      const nextDraft = newTaskDraft(source, { listId: currentDraft.listId });
      taskDraftBaselineRef.current = nextDraft;
      taskDraftRef.current = nextDraft;
      taskInspectorDirtyRef.current = false;
      taskInspectorDirtyState.set(false);
      setTaskInspectorCanSave(false);
      setTaskInspectorMode("edit");
      setSelectedTaskId(null);
      await closeInspector();
      setDraft(nextDraft);
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
      taskInspectorDirtyState.set(false);
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
    taskInspectorDirtyState.set(false);
    conversionCleanupRef.current = null;
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
    duplicateTask,
    openNewTask,
    selectedTaskId,
    selectTask,
    toggleTask
  };
}

function taskEventDraft(sourceDraft: TaskDraft): Partial<CalendarEventDraft> {
  if (sourceDraft.plannedStart) {
    const startMs = Date.parse(sourceDraft.plannedStart);
    const fallbackEnd = Number.isFinite(startMs)
      ? new Date(startMs + 60 * 60 * 1000).toISOString()
      : new Date(Date.now() + 60 * 60 * 1000).toISOString();
    return {
      allDay: false,
      endsAt: sourceDraft.plannedEnd ?? fallbackEnd,
      notes: sourceDraft.notes,
      startsAt: sourceDraft.plannedStart,
      title: sourceDraft.title
    };
  }

  if (sourceDraft.dueDate) {
    const start = new Date(`${sourceDraft.dueDate}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString();

    return {
      allDay: true,
      endsAt: end,
      notes: sourceDraft.notes,
      startsAt: `${sourceDraft.dueDate}T00:00:00.000Z`,
      title: sourceDraft.title
    };
  }

  const start = new Date();
  start.setUTCMinutes(0, 0, 0);
  const startsAt = start.toISOString();
  const endsAt = new Date(start.getTime() + 60 * 60 * 1000).toISOString();

  return {
    allDay: false,
    endsAt,
    notes: sourceDraft.notes,
    startsAt,
    title: sourceDraft.title
  };
}

function taskInspectorScreenTitle(
  draft: TaskDraft,
  mode: "view" | "edit"
): string {
  if (draft.mode === "edit" && mode === "edit") {
    return "Edit task";
  }

  return taskInspectorTitle(draft);
}

function isTaskDraft(candidate: Partial<Omit<TaskDraft, "mode">> | TaskDraft): candidate is TaskDraft {
  return "mode" in candidate && (candidate.mode === "create" || candidate.mode === "edit");
}
