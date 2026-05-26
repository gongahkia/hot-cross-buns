import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Save, Trash2, X } from "lucide-react";
import { useInspector } from "../../../../components/Inspector";
import { Button } from "../../../../components/primitives";
import { rendererNow, reportRendererTimingSince } from "../../../../hooks/useRenderTiming";
import { useCoreViewModelSource } from "../../coreViewModelSource";
import { playCompletionSound } from "../../completionSounds";
import type { TaskFilterId } from "../../coreViewModels";
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
  BulkTaskSelectionBanner,
  QuickCapturePanel,
  SavedTaskPerspectivesPanel,
  TaskFilterToolbar,
  TaskHeader,
  TaskListsSidebarPanel,
  TaskMutationErrorBanner,
  TaskPerspectiveContent,
  TaskPerspectiveTabs,
  TaskRefreshPanel,
  TasksSectionChrome
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
  buildTaskPerspective,
  type TaskPerspectiveId
} from "./taskPerspectives";
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

function readStoredStringArray(key: string): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function readStoredNumberRecord(key: string): Record<string, number> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}");

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] =>
        typeof entry[0] === "string" && typeof entry[1] === "number"
      )
    );
  } catch {
    return {};
  }
}

export function TasksView({ command }: { command?: TaskSurfaceCommand | null }): JSX.Element {
  const source = useCoreViewModelSource();
  const {
    close: closeInspector,
    current: currentInspector,
    open: openInspector,
    update: updateInspector
  } = useInspector();
  const [activeFilterId, setActiveFilterId] = useState<TaskFilterId>("open");
  const [activePerspectiveId, setActivePerspectiveId] = useState<TaskPerspectiveId>("projects");
  const [activeSavedTaskViewId, setActiveSavedTaskViewId] = useState<string | null>(null);
  const [selectedBoardView, setSelectedBoardView] = useState<TaskBoardSelection>({ kind: "all" });
  const [starredTaskIds, setStarredTaskIds] = useState<Set<string>>(
    () => new Set(readStoredStringArray(starredTasksStorageKey))
  );
  const [starredTaskAt, setStarredTaskAt] = useState<Record<string, number>>(
    () => readStoredNumberRecord(starredTasksAtStorageKey)
  );
  const [listSorts, setListSorts] = useState<Record<string, TaskListSort>>({});
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [draft, setDraftState] = useState<TaskDraft>(() => newTaskDraft(source));
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [quickCaptureInput, setQuickCaptureInput] = useState("");
  const [newListTitle, setNewListTitle] = useState("");
  const [listTitleDrafts, setListTitleDrafts] = useState<Record<string, string>>({});
  const [bulkSelectedTaskIds, setBulkSelectedTaskIds] = useState<string[]>([]);
  const [bulkMoveListId, setBulkMoveListId] = useState("");
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
  const activeSavedTaskView =
    source.settings.savedTaskViews.find((view) => view.id === activeSavedTaskViewId) ??
    source.settings.savedTaskViews[0] ??
    null;
  const activeTaskPerspective = useMemo(
    () =>
      buildTaskPerspective(
        activePerspectiveId,
        source.largeTaskWindow,
        source.taskLists,
        activeFilterId,
        activeSavedTaskView,
        new Date()
      ),
    [
      activeFilterId,
      activePerspectiveId,
      activeSavedTaskView,
      source.largeTaskWindow,
      source.taskLists
    ]
  );
  const selectedTask = selectedTaskId ? source.getTaskById(selectedTaskId) : null;
  const taskIdsInWindow = new Set(source.largeTaskWindow.map((task) => task.id));
  const visibleTaskIds = Array.from(
    new Set(activeTaskPerspective.groups.flatMap((group) => group.tasks.map((task) => task.id)))
  );
  const shouldRenderPerspectiveGroups = activePerspectiveId !== "saved" || activeSavedTaskView !== null;
  const bulkSelectedTaskIdsInWindow = bulkSelectedTaskIds.filter((taskId) => taskIdsInWindow.has(taskId));
  const bulkSelectedTasks = bulkSelectedTaskIdsInWindow.map((taskId) => source.getTaskById(taskId));
  const allVisibleTasksSelected =
    visibleTaskIds.length > 0 && visibleTaskIds.every((taskId) => bulkSelectedTaskIdsInWindow.includes(taskId));
  const bulkCompletionLabel =
    bulkSelectedTasks.length > 0 && bulkSelectedTasks.every((task) => task.status === "completed")
      ? "Reopen selected"
      : "Complete selected";
  const bulkMoveTargetListId = bulkMoveListId || defaultTaskListId(source);
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
    const listId = defaultTaskListId(source);

    if (!listId || bulkMoveListId) {
      return;
    }

    setBulkMoveListId(listId);
  }, [bulkMoveListId, source.taskLists]);

  useEffect(() => {
    setBulkSelectedTaskIds((current) => {
      const next = current.filter((taskId) => taskIdsInWindow.has(taskId));

      return next.length === current.length ? current : next;
    });
  }, [source.largeTaskWindow]);

  useEffect(() => {
    if (!command || handledCommandNonce.current === command.nonce) {
      return;
    }

    handledCommandNonce.current = command.nonce;
    setActiveFilterId("open");
    setSelectedBoardView({ kind: "all" });

    if (command.id === "task.quickCapture") {
      quickCaptureOpenStartedAt.current = rendererNow();
      setQuickCaptureOpen(true);
      return;
    }

    openNewTask();
  }, [command, source]);

  useEffect(() => {
    window.localStorage.setItem(starredTasksStorageKey, JSON.stringify([...starredTaskIds]));
  }, [starredTaskIds]);

  useEffect(() => {
    window.localStorage.setItem(starredTasksAtStorageKey, JSON.stringify(starredTaskAt));
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
    setActiveFilterId("open");
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

  function toggleQuickCapture(): void {
    setQuickCaptureOpen((open) => {
      if (!open) {
        quickCaptureOpenStartedAt.current = rendererNow();
      }

      return !open;
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

  function setTaskBulkSelected(taskId: string, selected: boolean): void {
    setBulkSelectedTaskIds((current) => {
      if (selected) {
        return current.includes(taskId) ? current : [...current, taskId];
      }

      return current.filter((id) => id !== taskId);
    });
  }

  function toggleVisibleTaskSelection(): void {
    setBulkSelectedTaskIds((current) => {
      if (allVisibleTasksSelected) {
        const visible = new Set(visibleTaskIds);
        return current.filter((taskId) => !visible.has(taskId));
      }

      return Array.from(new Set([...current, ...visibleTaskIds]));
    });
  }

  async function completeBulkSelectedTasks(): Promise<void> {
    const changedTaskIds: string[] = [];

    for (const task of bulkSelectedTasks) {
      const saved =
        task.status === "completed"
          ? await source.reopenTask(task.id)
          : await source.completeTask(task.id);

      if (saved) {
        if (task.status !== "completed" && source.settings.taskCompletionSoundEnabled) {
          playCompletionSound(source.settings.taskCompletionSoundId);
        }
        changedTaskIds.push(task.id);
      }
    }

    if (changedTaskIds.length > 0) {
      setBulkSelectedTaskIds((current) => current.filter((taskId) => !changedTaskIds.includes(taskId)));
    }
  }

  async function moveBulkSelectedTasks(): Promise<void> {
    if (!bulkMoveTargetListId) {
      return;
    }

    const movedTaskIds: string[] = [];

    for (const task of bulkSelectedTasks) {
      const moved = await source.moveTask({
        id: task.id,
        listId: bulkMoveTargetListId,
        parentId: null
      });

      if (moved) {
        movedTaskIds.push(task.id);
      }
    }

    if (movedTaskIds.length > 0) {
      setBulkSelectedTaskIds((current) => current.filter((taskId) => !movedTaskIds.includes(taskId)));
    }
  }

  async function deleteBulkSelectedTasks(): Promise<void> {
    const deletedTaskIds: string[] = [];

    for (const taskId of bulkSelectedTaskIdsInWindow) {
      const deleted = await source.deleteTask(taskId);

      if (deleted) {
        deletedTaskIds.push(taskId);
      }
    }

    if (deletedTaskIds.length === 0) {
      return;
    }

    setBulkSelectedTaskIds((current) => current.filter((taskId) => !deletedTaskIds.includes(taskId)));

    if (selectedTaskId && deletedTaskIds.includes(selectedTaskId)) {
      const nextDraft = newTaskDraft(source);
      taskDraftBaselineRef.current = nextDraft;
      taskDraftRef.current = nextDraft;
      taskInspectorDirtyRef.current = false;
      setSelectedTaskId(null);
      setDraft(nextDraft);
      await closeInspector();
    }
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

  async function createTaskList(): Promise<void> {
    const title = newListTitle.trim();

    if (!title || source.taskMutationPending) {
      return;
    }

    const created = await source.createTaskList({ title });

    if (created) {
      setNewListTitle("");
    }
  }

  async function renameTaskList(taskListId: string, currentTitle: string): Promise<void> {
    const title = (listTitleDrafts[taskListId] ?? currentTitle).trim();

    if (!title || title === currentTitle || source.taskMutationPending) {
      return;
    }

    const renamed = await source.renameTaskList({ id: taskListId, title });

    if (renamed) {
      setListTitleDrafts((current) => {
        const next = { ...current };
        delete next[taskListId];
        return next;
      });
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

  function deleteSavedTaskView(viewId: string): void {
    void source.updateSettings({
      savedTaskViews: source.settings.savedTaskViews.filter((view) => view.id !== viewId)
    });

    if (activeSavedTaskViewId === viewId) {
      setActiveSavedTaskViewId(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <TaskHeader
        onCreateTask={openNewTask}
        onDeleteSelectedTask={() => selectedTask ? void deleteTask(selectedTask.id) : undefined}
        onToggleQuickCapture={toggleQuickCapture}
        onToggleSelectedTask={() => selectedTask ? void toggleTask(selectedTask.id) : undefined}
        selectedTask={selectedTask}
        source={source}
      />

      <TaskPerspectiveTabs
        activePerspective={activeTaskPerspective}
        activePerspectiveId={activePerspectiveId}
        activeSavedTaskViewId={activeSavedTaskViewId}
        onSelectPerspective={setActivePerspectiveId}
        onSelectSavedTaskView={setActiveSavedTaskViewId}
        savedTaskViews={source.settings.savedTaskViews}
      />

      <TaskFilterToolbar
        activeFilterId={activeFilterId}
        allVisibleTasksSelected={allVisibleTasksSelected}
        onSelectFilter={setActiveFilterId}
        onToggleVisibleTaskSelection={toggleVisibleTaskSelection}
        source={source}
        visibleTaskCount={visibleTaskIds.length}
      />

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
