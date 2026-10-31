import { InspectorItemToolbar, copyInspectorText, type InspectorEntryKind } from "../../../../components/Inspector/InspectorItemToolbar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useInspector, type InspectorDirtyState } from "../../../../components/Inspector";
import { rendererNow, reportRendererTimingSince } from "../../../../hooks/useRenderTiming";
import type { useCoreViewModelSource } from "../../coreViewModelSource";
import { playCompletionSound } from "../../completionSounds";
import {
  conversionCleanup,
  dispatchConvertCommand,
  type ConvertSourceCleanup
} from "../../conversionEvents";
import { copiedTitle } from "../../copyLabels";
import { stableTaskViewModel } from "../../viewModelSource/taskViewModels";
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

export interface TaskInspectorController {
  taskReadError?: string;
  addSubtaskForTask: (task: TaskViewModel | null) => void;
  deleteTask: (taskId: string) => Promise<void>;
  duplicateTask: (taskId: string) => void;
  openNewTask: (
    seed?: string | Partial<Omit<TaskDraft, "mode">> | TaskDraft,
    cleanup?: ConvertSourceCleanup
  ) => void;
  selectedTaskId: string | null;
  selectTask: (taskId: string, shouldOpen?: () => boolean) => Promise<boolean>;
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
  const [loadedTask, setLoadedTask] = useState<TaskViewModel | null>(null);
  const [taskReadError, setTaskReadError] = useState<string>();
  const readGeneration = useRef(0);
  const [draft, setDraftState] = useState<TaskDraft>(() => newTaskDraft(source));
  const [taskInspectorMode, setTaskInspectorModeState] = useState<"view" | "edit">("edit");
  const ownerIdRef = useRef(`task-inspector-${Math.random().toString(36).slice(2)}`);
  const taskDraftRef = useRef<TaskDraft>(draft);
  const taskDraftBaselineRef = useRef<TaskDraft>(draft);
  const taskInspectorDirtyRef = useRef(false);
  const taskInspectorInstanceRef = useRef(0);
  const taskInspectorModeRef = useRef<"view" | "edit">("edit");
  const taskSaveInFlightRef = useRef(false);
  const taskSavePromiseRef = useRef<Promise<boolean> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
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
      // The editor keeps live keystrokes in this ref without rerendering its
      // parent. A resource refresh can call a no-op state updater; copying its
      // older baseline back into the ref would silently discard those edits.
      if (resolved !== current) taskDraftRef.current = resolved;
      return resolved;
    });
  }, []);
  const updateTaskDraftRef = useCallback((nextDraft: TaskDraft) => {
    // A field event may arrive before the editor renders the creation receipt.
    // Identity belongs to the controller: stale create-mode props must never
    // turn the acknowledged task back into a second creation.
    const current = taskDraftRef.current;
    const next = { ...nextDraft, mode: current.mode, id: current.id };
    taskDraftRef.current = next;
    const dirty = !taskDraftsEqual(next, taskDraftBaselineRef.current);
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
  const cachedTask = selectedTaskId ? source.getTaskById(selectedTaskId) : null;
  const selectedTask = loadedTask?.id === selectedTaskId ? { ...loadedTask, ...(cachedTask?.listId !== "unknown" ? cachedTask : {}), detail: loadedTask.detail, parentTitle: cachedTask?.parentTitle ?? loadedTask.parentTitle } : cachedTask;
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
      actions: null,
      toolbar: taskInspectorToolbar(draft),
      onSave: saveTask,
      saving,
      saveError,
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
    saving, saveError,
    updateInspector
  ]);

  async function canReplaceTaskInspector(): Promise<boolean> {
    if (currentInspector?.kind !== "task" || currentInspector.ownerId !== ownerIdRef.current) return true;
    return saveTask();
  }

  function taskInspectorToolbar(nextDraft: TaskDraft): ReactNode {
    return <InspectorItemToolbar kind="task" persisted={nextDraft.mode === "edit"} busy={saving}
      onKindChange={async (kind: InspectorEntryKind) => {
        if (!await saveTask()) return;
        if (kind === "event" || kind === "birthday") convertTaskDraft(taskDraftRef.current, kind);
        else if (kind === "note") convertTaskDraft(taskDraftRef.current, "note");
      }}
      onCopy={() => copyInspectorText(taskDraftRef.current.title, taskDraftRef.current.notes)}
      onDuplicate={async () => { if (await saveTask()) { duplicateTaskDraftValue(taskDraftRef.current); await saveTask(); } }}
      onDelete={async () => { if (taskDraftRef.current.id) await deleteTask(taskDraftRef.current.id); else await cancelTaskInspector(); }} />;
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
        onSave={async () => { await saveTask(); }}
        parentOptions={parentOptions}
        mutationPending={source.taskMutationPending}
        source={source}
      />
    );
  }

  function taskInspectorHidesHeader(nextDraft: TaskDraft, mode = taskInspectorModeRef.current): boolean {
    return false;
  }

  function openTaskInspector(
    nextDraft: TaskDraft,
    mode: "view" | "edit" = "edit"
  ): void {
    taskSaveInFlightRef.current = false;
    taskInspectorInstanceRef.current += 1;
    const instance = taskInspectorInstanceRef.current;
    setSaveError(undefined);
    taskDraftBaselineRef.current = nextDraft;
    taskDraftRef.current = nextDraft;
    taskInspectorDirtyRef.current = false;
    taskInspectorDirtyState.set(false);
    const canSave = canSaveTaskDraft(nextDraft, source.taskMutationPending);
    setTaskInspectorCanSave(canSave);
    setTaskInspectorMode(mode);
    setDraft(nextDraft);
    openInspector({
      actions: null,
      toolbar: taskInspectorToolbar(nextDraft),
      onSave: saveTask,
      onDiscard: cancelTaskInspector,
      saving: false,
      saveError: undefined,
      body: taskInspectorBody(nextDraft, mode),
      dirty: false,
      dirtyState: taskInspectorDirtyState,
      hideHeader: taskInspectorHidesHeader(nextDraft, mode),
      id: nextDraft.id ?? "new",
      kind: "task",
      onConfirmClose: () => instance !== taskInspectorInstanceRef.current ? true : saveTask(),
      ownerId: ownerIdRef.current,
      title: taskInspectorScreenTitle(nextDraft, mode)
    });
  }

  async function openNewTask(
    seed?: string | Partial<Omit<TaskDraft, "mode">> | TaskDraft,
    cleanup?: ConvertSourceCleanup
  ): Promise<void> {
    if (!await canReplaceTaskInspector()) {
      return;
    }
    readGeneration.current += 1;

    const draftSeed = typeof seed === "string" ? { listId: seed } : seed ?? {};

    setSelectedTaskId(null);
    conversionCleanupRef.current = cleanup ?? null;
    openTaskInspector(isTaskDraft(draftSeed) ? draftSeed : newTaskDraft(source, draftSeed), "edit");
    if (cleanup) await saveTask();
  }

  async function readTask(taskId: string): Promise<TaskViewModel | null> {
    setTaskReadError(undefined);
    try {
      const result = await window.hcb?.tasks.get({ id: taskId });
      if (!result?.ok) throw new Error(result?.error.message ?? "The task could not be opened.");
      return stableTaskViewModel(result.data, source.taskLists.find((list) => list.id === result.data.listId)?.title, [], new Map());
    } catch (error) {
      setTaskReadError(error instanceof Error ? error.message : "The task could not be opened.");
      return null;
    }
  }

  async function selectTask(taskId: string, shouldOpen: () => boolean = () => true): Promise<boolean> {
    if (!await canReplaceTaskInspector()) {
      return false;
    }

    const generation = ++readGeneration.current;
    const task = await readTask(taskId);
    if (!task || generation !== readGeneration.current || !shouldOpen() || !await canReplaceTaskInspector()) return false;
    setLoadedTask(task);
    setSelectedTaskId(taskId);
    conversionCleanupRef.current = null;
    openTaskInspector(editTaskDraft(task), "edit");
    return true;
  }

  async function duplicateTask(taskId: string): Promise<void> {
    if (!await canReplaceTaskInspector()) {
      return;
    }

    const generation = ++readGeneration.current;
    const task = await readTask(taskId);
    if (!task || generation !== readGeneration.current || !await canReplaceTaskInspector()) return;
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

  async function convertTaskDraft(sourceDraft: TaskDraft, target: "event" | "birthday" | "note"): Promise<void> {
    if (target === "event" || target === "birthday") {
      const cleanup = sourceDraft.id ? await conversionCleanup("task", sourceDraft.id, target) : undefined;
      if (cleanup === null) return;
      dispatchConvertCommand({
        cleanup,
        target: "event",
        eventDraft: { ...taskEventDraft(sourceDraft), tags: sourceDraft.tags, ...(target === "birthday" ? { hcbKind: "birthday" as const } : {}) }
      });
      return;
    }

    const cleanup = sourceDraft.id ? await conversionCleanup("task", sourceDraft.id, "note") : undefined;
    if (cleanup === null) return;
    dispatchConvertCommand({
      cleanup,
      target,
      noteDraft: {
        body: sourceDraft.notes,
        tags: sourceDraft.tags,
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

  async function saveTask(): Promise<boolean> {
    while (taskSavePromiseRef.current) {
      if (!await taskSavePromiseRef.current) return false;
    }
    const snapshot = taskDraftRef.current;
    if (taskDraftsEqual(snapshot, taskDraftBaselineRef.current) && !(snapshot.mode === "create" && snapshot.title.trim())) return true;
    if (!canSaveTaskDraft(snapshot, false)) {
      setSaveError("Add a title and choose a task list before leaving this task.");
      return false;
    }
    taskSaveInFlightRef.current = true;
    setSaving(true);
    setSaveError(undefined);
    const pending = (async () => {
      let id = snapshot.id;
      try {
        const saved = snapshot.mode === "edit"
          ? await source.updateTask(taskUpdatePayload(snapshot))
          : await source.createTask(taskCreatePayload(snapshot), (createdId) => { id = createdId; });
        if (!saved || !id) { setSaveError("Could not save this task. Your edits are still here; try again."); return false; }
        const baseline: TaskDraft = { ...snapshot, mode: "edit", id };
        const live: TaskDraft = { ...taskDraftRef.current, mode: "edit", id };
        taskDraftBaselineRef.current = baseline;
        taskDraftRef.current = live;
        updateTaskInspectorDirty(!taskDraftsEqual(live, baseline));
        setSelectedTaskId(id);
        setDraft(live);
        updateInspector({ id });
        const cleanupError = await cleanupConvertedSource();
        if (cleanupError) setSaveError(`The new task was saved, but ${cleanupError}`);
        return true;
      } catch {
        setSaveError("Could not save this task. Your edits are still here; try again.");
        return false;
      } finally { taskSaveInFlightRef.current = false; setSaving(false); }
    })();
    taskSavePromiseRef.current = pending;
    let saved: boolean;
    try { saved = await pending; } finally { if (taskSavePromiseRef.current === pending) taskSavePromiseRef.current = null; }
    if (saved && !taskDraftsEqual(taskDraftRef.current, taskDraftBaselineRef.current)) return saveTask();
    return saved;
  }

  async function toggleTask(taskId: string): Promise<void> {
    const task = await readTask(taskId);
    if (!task) return;
    const startedAt = rendererNow();
    const action = task.status === "completed" ? "reopen" : "complete";
    let saved = false;

    if (task.status === "completed") {
      saved = await source.reopenTask(taskId);
      if (saved) setLoadedTask((current) => current?.id === taskId ? { ...current, status: "open" } : current);
      reportRendererTimingSince("tasks.completion", startedAt, {
        action,
        saved
      });
      return;
    }

    saved = await source.completeTask(taskId);
    if (saved) setLoadedTask((current) => current?.id === taskId ? { ...current, status: "completed" } : current);
    if (saved && source.settings.taskCompletionSoundEnabled) {
      playCompletionSound(source.settings.taskCompletionSoundId);
    }
    reportRendererTimingSince("tasks.completion", startedAt, {
      action,
      saved
    });
  }

  async function deleteTask(taskId: string): Promise<void> {
    await taskSavePromiseRef.current;
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
    await taskSavePromiseRef.current;
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

  async function addSubtaskForTask(task: TaskViewModel | null): Promise<void> {
    if (!await canReplaceTaskInspector()) return;
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
    taskReadError,
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
