import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCoreViewModelSource } from "../../coreViewModelSource";
import { DuplicateReviewPanel } from "../../DuplicateReviewPanel";
import type { ConvertSourceCleanup } from "../../conversionEvents";
import {
  readLocalStorageNumberRecord,
  readLocalStorageStringArray,
  writeLocalStorageJSON
} from "../../localStorageHelpers";
import {
  CacheStatePanel,
  scheduledBlockByTaskId
} from "../../coreScreenShared";
import type { TaskViewModel } from "../../coreViewModels";
import type { TaskDraft } from "../../inspectors/TaskInspectorBody";
import {
  TaskMutationErrorBanner,
  TaskRefreshPanel
} from "./TaskPanels";
import {
  GoogleTasksBoard,
  type TaskBoardSelection,
  type TaskListSort
} from "./GoogleTasksBoard";
import { useTaskInspector } from "./useTaskInspector";

export interface TaskSurfaceCommand {
  id: "task.create";
  nonce: number;
  paneId?: string;
}

const starredTasksStorageKey = "hcb.starredTaskIds";
const starredTasksAtStorageKey = "hcb.starredTaskAt";

interface TaskBoardActionHandlers {
  addSubtaskForTask: (task: TaskViewModel | null) => void;
  confirmDeleteTaskList: (taskListId: string) => void;
  deleteTask: (taskId: string) => Promise<void>;
  duplicateTask: (taskId: string) => void;
  moveTaskToList: (taskId: string, listId: string) => void;
  moveTaskRequest: (request: Parameters<ReturnType<typeof useCoreViewModelSource>["moveTask"]>[0]) => void;
  openNewTask: (listId?: string) => void;
  promptCreateTaskList: () => void;
  promptRenameTaskList: (taskList: { id: string; title: string }) => void;
  scheduleTask: (task: TaskViewModel) => void;
  selectTask: (taskId: string) => void;
  setListSort: (listId: string, sort: TaskListSort) => void;
  toggleTask: (taskId: string) => Promise<void>;
  toggleTaskStar: (taskId: string) => void;
}

export function TasksView({ command }: { command?: TaskSurfaceCommand | null }): JSX.Element {
  const source = useCoreViewModelSource();
  const {
    addSubtaskForTask,
    deleteTask,
    duplicateTask,
    openNewTask,
    selectedTaskId,
    selectTask,
    toggleTask
  } = useTaskInspector(source);
  const [selectedBoardView, setSelectedBoardView] = useState<TaskBoardSelection>({
    mode: "lists",
    listIds: null
  });
  const [starredTaskIds, setStarredTaskIds] = useState<Set<string>>(
    () => new Set(readLocalStorageStringArray(starredTasksStorageKey))
  );
  const [starredTaskAt, setStarredTaskAt] = useState<Record<string, number>>(
    () => readLocalStorageNumberRecord(starredTasksAtStorageKey)
  );
  const [listSorts, setListSorts] = useState<Record<string, TaskListSort>>({});
  const handledCommandNonce = useRef<number | null>(null);
  const boardActionsRef = useRef<TaskBoardActionHandlers | null>(null);
  const scheduledBlocksByTask = useMemo(
    () => scheduledBlockByTaskId(source.scheduledTaskBlocks),
    [source.scheduledTaskBlocks]
  );
  const starred = useMemo(
    () => ({ ids: starredTaskIds, starredAt: starredTaskAt }),
    [starredTaskAt, starredTaskIds]
  );

  useEffect(() => {
    if (!command || handledCommandNonce.current === command.nonce) {
      return;
    }

    handledCommandNonce.current = command.nonce;
    setSelectedBoardView({ mode: "lists", listIds: null });

    openNewTask();
  }, [command, openNewTask]);

  useEffect(() => {
    function handleTaskCommand(event: Event): void {
      const detail = (event as CustomEvent<{
        action: string;
        cleanup?: ConvertSourceCleanup;
        taskId?: string;
        draft?: Partial<Omit<TaskDraft, "mode">> | TaskDraft;
      }>).detail;

      if (detail?.action === "open-task" && detail.taskId) {
        setSelectedBoardView({ mode: "lists", listIds: null });
        selectTask(detail.taskId);
      }

      if (detail?.action === "new-task") {
        setSelectedBoardView({ mode: "lists", listIds: null });
        openNewTask(detail.draft ?? {});
      }

      if (detail?.action === "convert-to-task") {
        setSelectedBoardView({ mode: "lists", listIds: null });
        openNewTask(detail.draft ?? {}, detail.cleanup);
      }
    }

    window.addEventListener("hcb:task-command", handleTaskCommand);
    return () => window.removeEventListener("hcb:task-command", handleTaskCommand);
  }, [openNewTask, selectTask]);

  useEffect(() => {
    writeLocalStorageJSON(starredTasksStorageKey, [...starredTaskIds]);
  }, [starredTaskIds]);

  useEffect(() => {
    writeLocalStorageJSON(starredTasksAtStorageKey, starredTaskAt);
  }, [starredTaskAt]);

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

    if (!window.confirm(`Delete ${title}? This also deletes tasks in the list.`)) {
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

  function scheduleTask(task: TaskViewModel): void {
    const calendar = source.calendarSources.find((item) => item.selected) ?? source.calendarSources[0];
    if (!calendar || source.taskMutationPending) return;
    const durationMinutes = Math.max(5, Math.min(24 * 60, task.durationMinutes ?? 30));
    const startsAt = new Date(Math.ceil((Date.now() + 60_000) / (30 * 60_000)) * 30 * 60_000).toISOString();
    const existing = scheduledBlocksByTask.get(task.id);
    if (existing) {
      void source.moveScheduledTaskBlock({ id: existing.id, calendarId: calendar.id, startsAt, durationMinutes });
      return;
    }
    void source.scheduleTaskBlock({ taskId: task.id, calendarId: calendar.id, startsAt, durationMinutes });
  }

  boardActionsRef.current = {
    addSubtaskForTask,
    confirmDeleteTaskList,
    deleteTask,
    duplicateTask,
    moveTaskRequest: (request) => { void source.moveTask(request); },
    moveTaskToList,
    openNewTask,
    promptCreateTaskList,
    promptRenameTaskList,
    scheduleTask,
    selectTask,
    setListSort,
    toggleTask,
    toggleTaskStar
  };

  const handleAddSubtask = useCallback((task: TaskViewModel) => {
    boardActionsRef.current?.addSubtaskForTask(task);
  }, []);
  const handleCreateList = useCallback(() => {
    boardActionsRef.current?.promptCreateTaskList();
  }, []);
  const handleCreateTask = useCallback((listId?: string) => {
    boardActionsRef.current?.openNewTask(listId);
  }, []);
  const handleDeleteList = useCallback((taskListId: string) => {
    boardActionsRef.current?.confirmDeleteTaskList(taskListId);
  }, []);
  const handleDeleteTask = useCallback((taskId: string) => {
    void boardActionsRef.current?.deleteTask(taskId);
  }, []);
  const handleDuplicateTask = useCallback((taskId: string) => {
    boardActionsRef.current?.duplicateTask(taskId);
  }, []);
  const handleMoveTask = useCallback((taskId: string, listId: string) => {
    boardActionsRef.current?.moveTaskToList(taskId, listId);
  }, []);
  const handleMoveTaskRequest = useCallback((request: Parameters<ReturnType<typeof useCoreViewModelSource>["moveTask"]>[0]) => {
    boardActionsRef.current?.moveTaskRequest(request);
  }, []);
  const handleOpenTask = useCallback((taskId: string) => {
    boardActionsRef.current?.selectTask(taskId);
  }, []);
  const handleRenameList = useCallback((taskList: { id: string; title: string }) => {
    boardActionsRef.current?.promptRenameTaskList(taskList);
  }, []);
  const handleScheduleTask = useCallback((task: TaskViewModel) => {
    boardActionsRef.current?.scheduleTask(task);
  }, []);
  const handleSetListSort = useCallback((listId: string, sort: TaskListSort) => {
    boardActionsRef.current?.setListSort(listId, sort);
  }, []);
  const handleToggleStar = useCallback((taskId: string) => {
    boardActionsRef.current?.toggleTaskStar(taskId);
  }, []);
  const handleToggleTask = useCallback((taskId: string) => {
    void boardActionsRef.current?.toggleTask(taskId);
  }, []);

  if (
    (source.dataState === "loading" ||
      source.dataState === "offline" ||
      source.dataState === "error") &&
    !source.hasCachedData
  ) {
    return <CacheStatePanel title="Tasks" />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <TaskMutationErrorBanner source={source} />
      <DuplicateReviewPanel onOpenTask={handleOpenTask} source={source} />

      <div className="grid min-h-0 flex-1 gap-3">
        {source.dataState === "stale" ? <TaskRefreshPanel /> : null}
        <GoogleTasksBoard
          listSorts={listSorts}
          onAddSubtask={handleAddSubtask}
          onCreateList={handleCreateList}
          onCreateTask={handleCreateTask}
          onDeleteList={handleDeleteList}
          onDeleteTask={handleDeleteTask}
          onDuplicateTask={handleDuplicateTask}
          onMoveTask={handleMoveTask}
          onMoveTaskRequest={handleMoveTaskRequest}
          onOpenTask={handleOpenTask}
          onRenameList={handleRenameList}
          onScheduleTask={handleScheduleTask}
          onSetListSort={handleSetListSort}
          onToggleStar={handleToggleStar}
          onToggleTask={handleToggleTask}
          scheduledBlocksByTask={scheduledBlocksByTask}
          selectedTaskId={selectedTaskId}
          selectedView={selectedBoardView}
          setSelectedView={setSelectedBoardView}
          source={source}
          starred={starred}
        />
      </div>
    </div>
  );
}
