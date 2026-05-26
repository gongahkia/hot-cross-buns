import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Save, Trash2, X } from "lucide-react";
import { useInspector } from "../../../../components/Inspector";
import { Button } from "../../../../components/primitives";
import { rendererNow, reportRendererTimingSince } from "../../../../hooks/useRenderTiming";
import { useCoreViewModelSource } from "../../coreViewModelSource";
import { playCompletionSound } from "../../completionSounds";
import {
  readLocalStorageNumberRecord,
  readLocalStorageStringArray,
  writeLocalStorageJSON
} from "../../localStorageHelpers";
import {
  TaskInspectorBody,
  taskDraftsEqual,
  type TaskDraft
} from "../../inspectors/TaskInspectorBody";
import {
  CacheStatePanel,
  scheduleRendererFrame,
  scheduledBlockByTaskId
} from "../../coreScreenShared";
import {
  QuickCapturePanel,
  TaskMutationErrorBanner,
  TaskRefreshPanel
} from "./TaskPanels";
import { parseQuickTaskInput } from "./quickTaskParser";
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
import {
  GoogleTasksBoard,
  type TaskBoardSelection,
  type TaskListSort
} from "./GoogleTasksBoard";

export interface TaskSurfaceCommand {
  id: "task.create" | "task.quickCapture";
  nonce: number;
}

const starredTasksStorageKey = "hcb.starredTaskIds";
const starredTasksAtStorageKey = "hcb.starredTaskAt";

export function TasksView({ command }: { command?: TaskSurfaceCommand | null }): JSX.Element {
  const source = useCoreViewModelSource();
  const {
    close: closeInspector,
    current: currentInspector,
    open: openInspector,
    update: updateInspector
  } = useInspector();
  const [selectedBoardView, setSelectedBoardView] = useState<TaskBoardSelection>({ kind: "all" });
  const [starredTaskIds, setStarredTaskIds] = useState<Set<string>>(
    () => new Set(readLocalStorageStringArray(starredTasksStorageKey))
  );
  const [starredTaskAt, setStarredTaskAt] = useState<Record<string, number>>(
    () => readLocalStorageNumberRecord(starredTasksAtStorageKey)
  );
  const [listSorts, setListSorts] = useState<Record<string, TaskListSort>>({});
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [draft, setDraftState] = useState<TaskDraft>(() => newTaskDraft(source));
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [quickCaptureInput, setQuickCaptureInput] = useState("");
  const taskDraftRef = useRef<TaskDraft>(draft);
  const taskDraftBaselineRef = useRef<TaskDraft>(draft);
  const taskInspectorDirtyRef = useRef(false);
  const taskInspectorInstanceRef = useRef(0);
  const handledCommandNonce = useRef<number | null>(null);
  const quickCaptureOpenStartedAt = useRef<number | null>(null);
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
  const scheduledBlocksByTask = useMemo(
    () => scheduledBlockByTaskId(source.scheduledTaskBlocks),
    [source.scheduledTaskBlocks]
  );
  const parsedQuickTask = parseQuickTaskInput(quickCaptureInput, source.taskLists);
  const canSaveTask = canSaveTaskDraft(draft, source.taskMutationPending);
  const canCaptureTask =
    parsedQuickTask.title.length > 0 && parsedQuickTask.listId.length > 0 && !source.taskMutationPending;

  useEffect(() => {
    const listId = defaultTaskListId(source);

    if (!listId) {
      return;
    }

    setDraft((current) => (current.listId ? current : { ...current, listId }));
  }, [source.taskLists]);

  useEffect(() => {
    if (!command || handledCommandNonce.current === command.nonce) {
      return;
    }

    handledCommandNonce.current = command.nonce;
    setSelectedBoardView({ kind: "all" });

    if (command.id === "task.quickCapture") {
      quickCaptureOpenStartedAt.current = rendererNow();
      setQuickCaptureOpen(true);
      return;
    }

    openNewTask();
  }, [command, source]);

  useEffect(() => {
    writeLocalStorageJSON(starredTasksStorageKey, [...starredTaskIds]);
  }, [starredTaskIds]);

  useEffect(() => {
    writeLocalStorageJSON(starredTasksAtStorageKey, starredTaskAt);
  }, [starredTaskAt]);

  useEffect(() => {
    if (!quickCaptureOpen) {
      return;
    }

    scheduleRendererFrame(() => {
      reportRendererTimingSince("quick-capture.open", quickCaptureOpenStartedAt.current);
      quickCaptureOpenStartedAt.current = null;
    });
  }, [quickCaptureOpen]);

  useEffect(() => {
    if (currentInspector?.kind !== "task") {
      return;
    }

    const dirty = !taskDraftsEqual(draft, taskDraftBaselineRef.current);
    taskInspectorDirtyRef.current = dirty;
    updateInspector({
      actions: taskInspectorActions(draft),
      body: taskInspectorBody(draft),
      dirty,
      title: taskInspectorTitle(draft)
    });
  }, [
    canSaveTask,
    currentInspector?.kind,
    draft,
    parentOptions,
    selectedTask?.id,
    source.taskLists,
    source.taskMutationPending,
    updateInspector
  ]);

  if (
    (source.dataState === "loading" ||
      source.dataState === "offline" ||
      source.dataState === "error") &&
    !source.hasCachedData
  ) {
    return <CacheStatePanel title="Tasks" />;
  }

  function canReplaceTaskInspector(): boolean {
    return currentInspector?.kind !== "task" || !taskInspectorDirtyRef.current;
  }

  function taskInspectorBody(nextDraft: TaskDraft): ReactNode {
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

  function taskInspectorActions(nextDraft: TaskDraft): ReactNode {
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

  function openTaskInspector(nextDraft: TaskDraft): void {
    taskInspectorInstanceRef.current += 1;
    taskDraftBaselineRef.current = nextDraft;
    taskDraftRef.current = nextDraft;
    taskInspectorDirtyRef.current = false;
    setDraft(nextDraft);
    openInspector({
      actions: taskInspectorActions(nextDraft),
      body: taskInspectorBody(nextDraft),
      dirty: false,
      id: nextDraft.id ?? "new",
      kind: "task",
      onConfirmClose: () => !taskInspectorDirtyRef.current,
      title: taskInspectorTitle(nextDraft)
    });
  }

  function openNewTask(listId?: string): void {
    if (!canReplaceTaskInspector()) {
      return;
    }

    setSelectedTaskId(null);
    openTaskInspector(newTaskDraft(source, listId ? { listId } : {}));
    setQuickCaptureOpen(false);
  }

  function selectTask(taskId: string): void {
    if (!canReplaceTaskInspector()) {
      return;
    }

    const task = source.getTaskById(taskId);
    setSelectedTaskId(taskId);
    openTaskInspector(editTaskDraft(task));
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
    setSelectedTaskId(null);
    setDraft(nextDraft);
    await closeInspector();
  }

  async function captureQuickTask(): Promise<void> {
    if (!canCaptureTask) {
      return;
    }

    const created = await source.createTask({
      title: parsedQuickTask.title,
      notes: "",
      dueDate: parsedQuickTask.dueDate || null,
      listId: parsedQuickTask.listId,
      parentId: null,
      priority: "none",
      plannedStart: parsedQuickTask.plannedStart,
      plannedEnd: parsedQuickTask.plannedEnd,
      durationMinutes: parsedQuickTask.durationMinutes,
      lockedSchedule: parsedQuickTask.lockedSchedule,
      tags: parsedQuickTask.tags
    });

    if (created) {
      setQuickCaptureInput("");
      setQuickCaptureOpen(false);
    }
  }

  function addSubtaskDraft(): void {
    addSubtaskForTask(selectedTask);
  }

  function addSubtaskForTask(task: typeof selectedTask): void {
    if (!task) {
      return;
    }

    setSelectedTaskId(null);
    openTaskInspector(
      newTaskDraft(source, {
        listId: task.listId,
        parentId: task.id
      })
    );
  }

  function deleteTaskList(taskListId: string): void {
    void source.deleteTaskList(taskListId);
  }

  function promptCreateTaskList(): void {
    const title = window.prompt("Create new list")?.trim();

    if (!title || source.taskMutationPending) {
      return;
    }

    void source.createTaskList({ title });
  }

  function promptRenameTaskList(taskList: { id: string; title: string }): void {
    const title = window.prompt("Rename list", taskList.title)?.trim();

    if (!title || title === taskList.title || source.taskMutationPending) {
      return;
    }

    void source.renameTaskList({ id: taskList.id, title });
  }

  function confirmDeleteTaskList(taskListId: string): void {
    const taskList = source.taskLists.find((list) => list.id === taskListId);
    const title = taskList?.title ?? "this list";

    if (!window.confirm(`Delete ${title}? This also deletes cached tasks in the list.`)) {
      return;
    }

    deleteTaskList(taskListId);
  }

  function toggleTaskStar(taskId: string): void {
    setStarredTaskIds((current) => {
      const next = new Set(current);

      if (next.has(taskId)) {
        next.delete(taskId);
        setStarredTaskAt((timestamps) => {
          const result = { ...timestamps };
          delete result[taskId];
          return result;
        });
      } else {
        next.add(taskId);
        setStarredTaskAt((timestamps) => ({
          ...timestamps,
          [taskId]: Date.now()
        }));
      }

      return next;
    });
  }

  function setListSort(listId: string, sort: TaskListSort): void {
    setListSorts((current) => ({
      ...current,
      [listId]: sort
    }));
  }

  function moveTaskToList(taskId: string, listId: string): void {
    void source.moveTask({ id: taskId, listId, parentId: null });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <TaskMutationErrorBanner source={source} />

      <div className="grid min-h-0 flex-1 gap-3">
        {quickCaptureOpen ? (
          <QuickCapturePanel
            canCaptureTask={canCaptureTask}
            onCaptureTask={() => void captureQuickTask()}
            parsedQuickTask={parsedQuickTask}
            quickCaptureInput={quickCaptureInput}
            setQuickCaptureInput={setQuickCaptureInput}
            source={source}
          />
        ) : null}
        {source.dataState === "stale" ? <TaskRefreshPanel /> : null}
        <GoogleTasksBoard
          listSorts={listSorts}
          onAddSubtask={addSubtaskForTask}
          onCreateList={promptCreateTaskList}
          onCreateTask={openNewTask}
          onDeleteList={confirmDeleteTaskList}
          onDeleteTask={(taskId) => void deleteTask(taskId)}
          onMoveTask={moveTaskToList}
          onOpenTask={selectTask}
          onRenameList={promptRenameTaskList}
          onSetListSort={setListSort}
          onToggleStar={toggleTaskStar}
          onToggleTask={(taskId) => void toggleTask(taskId)}
          scheduledBlocksByTask={scheduledBlocksByTask}
          selectedTaskId={selectedTaskId}
          selectedView={selectedBoardView}
          setSelectedView={setSelectedBoardView}
          source={source}
          starred={{ ids: starredTaskIds, starredAt: starredTaskAt }}
        />
      </div>
    </div>
  );
}
