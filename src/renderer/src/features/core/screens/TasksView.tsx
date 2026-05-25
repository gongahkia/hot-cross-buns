import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { SavedTaskView, TaskCreateRequest, TaskUpdateRequest } from "@shared/ipc/contracts";
import {
  AlertTriangle,
  Bell,
  Brush,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Flag,
  Gift,
  Info,
  Keyboard,
  Languages,
  ListPlus,
  MapPin,
  Pencil,
  Filter,
  Minus,
  PanelLeft,
  PanelRight,
  Plus,
  Power,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  StepBack,
  StepForward,
  Search,
  Settings2,
  Trash2,
  Users,
  X
} from "lucide-react";
import { useInspector } from "../../../components/Inspector";
import { Badge, Button, IconButton, Input, Panel, StatusBanner, cx } from "../../../components/primitives";
import { EmptyState, ErrorState, LoadingState } from "../../../components/states";
import { rendererNow, reportRendererTimingSince } from "../../../hooks/useRenderTiming";
import { useCoreViewModelSource } from "../coreViewModelSource";
import { playCompletionSound } from "../completionSounds";
import type {
  CorePriority,
  TaskFilterId,
  TaskGroupViewModel,
  TaskViewModel
} from "../coreViewModels";
import {
  TaskInspectorBody,
  taskDraftsEqual,
  type TaskDraft
} from "../inspectors/TaskInspectorBody";
import {
  CacheStatePanel,
  SectionChrome,
  TaskGroupPanel,
  actionDescription,
  actionLabel,
  scheduleRendererFrame,
  scheduledBlockByTaskId
} from "../coreScreenShared";

export interface TaskSurfaceCommand {
  id: "task.create" | "task.quickCapture";
  nonce: number;
}

interface QuickTaskParseResult {
  title: string;
  dueDate: string;
  listId: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  durationMinutes: number | null;
  lockedSchedule: boolean;
  tags: string[];
}

function defaultTaskListId(source: ReturnType<typeof useCoreViewModelSource>): string {
  return source.taskLists[0]?.id ?? "";
}

function newTaskDraft(
  source: ReturnType<typeof useCoreViewModelSource>,
  seed: Partial<Omit<TaskDraft, "mode">> = {}
): TaskDraft {
  return {
    mode: "create",
    title: seed.title ?? "",
    notes: seed.notes ?? "",
    dueDate: seed.dueDate ?? "",
    listId: seed.listId ?? defaultTaskListId(source),
    parentId: seed.parentId ?? "",
    priority: seed.priority ?? "none"
  };
}

function editTaskDraft(task: TaskViewModel): TaskDraft {
  return {
    mode: "edit",
    id: task.id,
    title: task.title,
    notes: task.detail === "Task cached locally" ? "" : task.detail,
    dueDate: task.dueDate ?? "",
    listId: task.listId,
    parentId: task.parentId ?? "",
    priority: task.priority
  };
}

function taskCreatePayload(draft: TaskDraft): TaskCreateRequest {
  return {
    title: draft.title.trim(),
    notes: draft.notes.trim(),
    dueDate: draft.dueDate || null,
    listId: draft.listId,
    parentId: draft.parentId || null,
    priority: draft.priority
  };
}

function taskUpdatePayload(draft: TaskDraft): TaskUpdateRequest {
  return {
    id: draft.id ?? "",
    title: draft.title.trim(),
    notes: draft.notes.trim(),
    dueDate: draft.dueDate || null,
    listId: draft.listId,
    parentId: draft.parentId || null,
    priority: draft.priority
  };
}

function taskParentOptions(tasks: TaskViewModel[], draft: TaskDraft): TaskViewModel[] {
  return tasks.filter(
    (task) => task.id !== draft.id && task.parentId === null && task.status !== "deleted"
  );
}

function canSaveTaskDraft(draft: TaskDraft, mutationPending: boolean): boolean {
  return draft.title.trim().length > 0 && draft.listId.length > 0 && !mutationPending;
}

function taskInspectorTitle(draft: TaskDraft): string {
  return draft.mode === "edit" ? draft.title || "Task" : "New task";
}

function dateOnlyFromLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addLocalDays(seed: Date, days: number): Date {
  const date = new Date(seed.getTime());
  date.setDate(date.getDate() + days);
  return date;
}

function endOfCurrentWeek(seed: Date): Date {
  return addLocalDays(seed, (7 - seed.getDay()) % 7);
}

function endOfCurrentMonth(seed: Date): Date {
  return new Date(seed.getFullYear(), seed.getMonth() + 1, 0);
}

function nextSaturday(seed: Date): Date {
  return addLocalDays(seed, (6 - seed.getDay() + 7) % 7);
}

function normalizedListToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizedTagToken(value: string): string {
  return value.trim().replace(/^\+/, "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
}

function parseDurationToken(token: string): number | null {
  const match = /^~(\d{1,3})(m|h)?$/i.exec(token);

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase() ?? "m";
  const minutes = unit === "h" ? amount * 60 : amount;

  return minutes > 0 ? minutes : null;
}

function parsePlannedStartToken(token: string, dueDate: string, now: Date): string | null {
  const match = /^@(\d{1,2})(?::(\d{2}))?(am|pm)?$/i.exec(token);

  if (!match) {
    return null;
  }

  const hourValue = Number(match[1]);
  const minuteValue = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();

  if (hourValue > 23 || minuteValue > 59 || (meridiem && (hourValue < 1 || hourValue > 12))) {
    return null;
  }

  const planned = dueDate ? new Date(`${dueDate}T00:00:00`) : new Date(now.getTime());
  let hour = hourValue;

  if (meridiem === "pm" && hour < 12) {
    hour += 12;
  } else if (meridiem === "am" && hour === 12) {
    hour = 0;
  }

  planned.setHours(hour, minuteValue, 0, 0);
  return planned.toISOString();
}

function parseQuickTaskInput(
  input: string,
  taskLists: readonly { id: string; title: string }[],
  now = new Date()
): QuickTaskParseResult {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  let dueDate = "";
  let listId = taskLists[0]?.id ?? "";
  let plannedToken = "";
  let durationMinutes: number | null = null;
  let lockedSchedule = false;
  const tags: string[] = [];
  const titleTokens: string[] = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (lower.startsWith("#") && lower.length > 1) {
      const listToken = normalizedListToken(lower.slice(1));
      const matchedList = taskLists.find((list) => normalizedListToken(list.title) === listToken);

      if (matchedList) {
        listId = matchedList.id;
        continue;
      }
    }

    if (lower.startsWith("+") && lower.length > 1) {
      const tag = normalizedTagToken(token.slice(1));

      if (tag && !tags.includes(tag)) {
        tags.push(tag);
      }

      continue;
    }

    if (lower === "!locked") {
      lockedSchedule = true;
      continue;
    }

    const parsedDuration = parseDurationToken(lower);

    if (parsedDuration !== null) {
      durationMinutes = parsedDuration;
      continue;
    }

    if (/^@\d{1,2}(?::\d{2})?(am|pm)?$/i.test(token)) {
      plannedToken = token;
      continue;
    }

    if (lower === "today" || lower === "tdy") {
      dueDate = dateOnlyFromLocalDate(now);
      continue;
    }

    if (lower === "tomorrow" || lower === "tmr" || lower === "tom") {
      dueDate = dateOnlyFromLocalDate(addLocalDays(now, 1));
      continue;
    }

    if (lower === "eow") {
      dueDate = dateOnlyFromLocalDate(endOfCurrentWeek(now));
      continue;
    }

    if (lower === "eom") {
      dueDate = dateOnlyFromLocalDate(endOfCurrentMonth(now));
      continue;
    }

    if (lower === "weekend") {
      dueDate = dateOnlyFromLocalDate(nextSaturday(now));
      continue;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) {
      dueDate = lower;
      continue;
    }

    titleTokens.push(token);
  }

  const plannedStart = plannedToken ? parsePlannedStartToken(plannedToken, dueDate, now) : null;
  const plannedEnd = plannedStart && durationMinutes
    ? new Date(Date.parse(plannedStart) + durationMinutes * 60 * 1000).toISOString()
    : null;

  return {
    title: titleTokens.join(" ").trim(),
    dueDate,
    listId,
    plannedStart,
    plannedEnd,
    durationMinutes,
    lockedSchedule,
    tags
  };
}

type TaskPerspectiveId = "inbox" | "forecast" | "review" | "tags" | "projects" | "saved";

interface TaskPerspectiveTab {
  id: TaskPerspectiveId;
  label: string;
}

interface TaskPerspectiveViewModel {
  description: string;
  groups: TaskGroupViewModel[];
  state: "ready" | "empty" | "error";
}

const taskPerspectiveTabs: TaskPerspectiveTab[] = [
  { id: "inbox", label: "Inbox" },
  { id: "forecast", label: "Forecast" },
  { id: "review", label: "Review" },
  { id: "tags", label: "Tags" },
  { id: "projects", label: "Projects" },
  { id: "saved", label: "Saved" }
];

function taskCountLabel(count: number): string {
  return `${count} ${count === 1 ? "task" : "tasks"}`;
}

function taskMatchesFilter(task: TaskViewModel, filterId: TaskFilterId): boolean {
  if (filterId === "open") {
    return task.status === "open";
  }

  if (filterId === "completed" || filterId === "hidden" || filterId === "deleted") {
    return task.status === filterId;
  }

  return false;
}

function taskListTitle(taskLists: readonly { id: string; title: string }[], listId: string): string {
  return taskLists.find((list) => list.id === listId)?.title ?? listId;
}

function taskPriorityRank(priority: CorePriority): number {
  if (priority === "high") {
    return 0;
  }

  if (priority === "medium") {
    return 1;
  }

  if (priority === "low") {
    return 2;
  }

  return 3;
}

function sortPerspectiveTasks(tasks: TaskViewModel[], sortBy: SavedTaskView["sortBy"] = "dueDate"): TaskViewModel[] {
  return [...tasks].sort((left, right) => {
    if (sortBy === "title") {
      return left.title.localeCompare(right.title);
    }

    if (sortBy === "updatedAt") {
      return Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? "");
    }

    if (sortBy === "priority") {
      return taskPriorityRank(left.priority) - taskPriorityRank(right.priority);
    }

    return (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31");
  });
}

function createTaskGroup(id: string, title: string, description: string, tasks: TaskViewModel[]): TaskGroupViewModel {
  return {
    id,
    title,
    description,
    countLabel: taskCountLabel(tasks.length),
    tasks
  };
}

function dateRangeLabel(date: string): string {
  if (!date) {
    return "No due date";
  }

  return date;
}

function buildGroupedTaskPerspective(
  groupBy: SavedTaskView["groupBy"],
  tasks: TaskViewModel[],
  taskLists: readonly { id: string; title: string }[],
  sortBy: SavedTaskView["sortBy"] = "dueDate"
): TaskGroupViewModel[] {
  if (groupBy === "none") {
    return [createTaskGroup("all", "All matching tasks", "Saved perspective matches", sortPerspectiveTasks(tasks, sortBy))];
  }

  const groups = new Map<string, { title: string; tasks: TaskViewModel[] }>();

  for (const task of tasks) {
    if (groupBy === "tag") {
      const tags = task.tags?.length ? task.tags : ["Untagged"];

      for (const tag of tags) {
        const key = tag.toLowerCase();
        const group = groups.get(key) ?? { title: tag, tasks: [] };
        group.tasks.push(task);
        groups.set(key, group);
      }

      continue;
    }

    const key =
      groupBy === "dueDate"
        ? task.dueDate ?? "none"
        : groupBy === "list"
          ? task.listId
          : task.status;
    const title =
      groupBy === "dueDate"
        ? dateRangeLabel(task.dueDate ?? "")
        : groupBy === "list"
          ? taskListTitle(taskLists, task.listId)
          : task.status === "open"
            ? "Active"
            : `${task.status[0]?.toUpperCase() ?? ""}${task.status.slice(1)}`;
    const group = groups.get(key) ?? { title, tasks: [] };
    group.tasks.push(task);
    groups.set(key, group);
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) =>
      createTaskGroup(
        `saved-${groupBy}-${key}`,
        group.title,
        groupBy === "list" ? "Project list" : `Grouped by ${groupBy}`,
        sortPerspectiveTasks(group.tasks, sortBy)
      )
    );
}

function taskDueBucket(task: TaskViewModel, today: string, inFourteenDays: string): SavedTaskView["filters"]["due"] | null {
  if (!task.dueDate) {
    return "none";
  }

  if (task.dueDate < today) {
    return "overdue";
  }

  if (task.dueDate === today) {
    return "today";
  }

  if (task.dueDate <= inFourteenDays) {
    return "next14";
  }

  return null;
}

function taskStatusForSavedView(task: TaskViewModel): "active" | "completed" | "hidden" | "deleted" {
  return task.status === "open" ? "active" : task.status;
}

function taskMatchesSavedView(
  task: TaskViewModel,
  view: SavedTaskView,
  today: string,
  inFourteenDays: string
): boolean {
  const filters = view.filters;

  if (filters.statuses?.length && !filters.statuses.includes(taskStatusForSavedView(task))) {
    return false;
  }

  if (filters.listIds?.length && !filters.listIds.includes(task.listId)) {
    return false;
  }

  if (filters.tags?.length) {
    const taskTags = new Set((task.tags ?? []).map((tag) => tag.toLowerCase()));

    if (!filters.tags.every((tag) => taskTags.has(tag.toLowerCase()))) {
      return false;
    }
  }

  if (filters.due && taskDueBucket(task, today, inFourteenDays) !== filters.due) {
    return false;
  }

  if (filters.planned === "planned" && !task.plannedStart) {
    return false;
  }

  if (filters.planned === "unplanned" && task.plannedStart) {
    return false;
  }

  return true;
}

function savedTaskViewFilterChips(
  view: SavedTaskView,
  taskLists: readonly { id: string; title: string }[]
): string[] {
  const chips: string[] = [];
  const filters = view.filters;

  if (filters.statuses?.length) {
    chips.push(`Status: ${filters.statuses.join(", ")}`);
  }

  if (filters.listIds?.length) {
    chips.push(`Lists: ${filters.listIds.map((id) => taskListTitle(taskLists, id)).join(", ")}`);
  }

  if (filters.tags?.length) {
    chips.push(`Tags: ${filters.tags.join(", ")}`);
  }

  if (filters.due) {
    chips.push(`Due: ${filters.due}`);
  }

  if (filters.planned) {
    chips.push(`Plan: ${filters.planned}`);
  }

  chips.push(`Group: ${view.groupBy}`);
  chips.push(`Sort: ${view.sortBy}`);
  return chips;
}

function buildSavedTaskPerspective(
  view: SavedTaskView,
  tasks: TaskViewModel[],
  taskLists: readonly { id: string; title: string }[],
  now: Date
): TaskPerspectiveViewModel {
  const today = dateOnlyFromLocalDate(now);
  const inFourteenDays = dateOnlyFromLocalDate(addLocalDays(now, 14));
  const matchingTasks = tasks.filter((task) => taskMatchesSavedView(task, view, today, inFourteenDays));
  const groups = buildGroupedTaskPerspective(view.groupBy, matchingTasks, taskLists, view.sortBy);

  return {
    description: `${taskCountLabel(matchingTasks.length)} in ${view.name}`,
    groups,
    state: matchingTasks.length > 0 ? "ready" : "empty"
  };
}

function buildTaskPerspective(
  perspectiveId: TaskPerspectiveId,
  tasks: TaskViewModel[],
  taskLists: readonly { id: string; title: string }[],
  filterId: TaskFilterId,
  savedView: SavedTaskView | null,
  now: Date
): TaskPerspectiveViewModel {
  if (filterId === "error") {
    return { description: "Recoverable renderer error state", groups: [], state: "error" };
  }

  if (filterId === "empty") {
    return { description: "Empty filtered state", groups: [], state: "empty" };
  }

  if (perspectiveId === "saved") {
    return savedView
      ? buildSavedTaskPerspective(savedView, tasks, taskLists, now)
      : { description: "Select a saved perspective", groups: [], state: "empty" };
  }

  const statusFilteredTasks = tasks.filter((task) => taskMatchesFilter(task, filterId));
  const today = dateOnlyFromLocalDate(now);
  const inFourteenDays = dateOnlyFromLocalDate(addLocalDays(now, 14));
  const inboxListId =
    taskLists.find((list) => list.title.trim().toLowerCase() === "inbox")?.id ?? taskLists[0]?.id ?? "";
  let groups: TaskGroupViewModel[] = [];

  if (perspectiveId === "inbox") {
    const inboxTasks = statusFilteredTasks.filter(
      (task) =>
        task.status === "open" &&
        (task.listId === inboxListId || (task.parentId === null && !task.plannedStart))
    );
    groups = [createTaskGroup("perspective-inbox", "Inbox", "Active root tasks without a planned slot", sortPerspectiveTasks(inboxTasks))];
  } else if (perspectiveId === "forecast") {
    const byDate = statusFilteredTasks.filter(
      (task) => task.dueDate !== null && task.dueDate >= today && task.dueDate <= inFourteenDays
    );
    groups = buildGroupedTaskPerspective("dueDate", byDate, taskLists);
  } else if (perspectiveId === "review") {
    const reviewBefore = now.getTime() - 14 * 24 * 60 * 60 * 1000;
    const reviewTasks = statusFilteredTasks.filter(
      (task) => task.status === "open" && Date.parse(task.updatedAt ?? "") < reviewBefore
    );
    groups = [createTaskGroup("perspective-review", "Needs review", "Active tasks untouched for 14 days", sortPerspectiveTasks(reviewTasks, "updatedAt"))];
  } else if (perspectiveId === "tags") {
    const taggedTasks = statusFilteredTasks.filter((task) => (task.tags ?? []).length > 0);
    groups = buildGroupedTaskPerspective("tag", taggedTasks, taskLists, "priority");
  } else {
    groups = buildGroupedTaskPerspective("list", statusFilteredTasks, taskLists, "priority");
  }

  const count = groups.reduce((total, group) => total + group.tasks.length, 0);

  return {
    description: `${taskCountLabel(count)} in ${taskPerspectiveTabs.find((tab) => tab.id === perspectiveId)?.label ?? "Perspective"}`,
    groups: groups.filter((group) => group.tasks.length > 0),
    state: count > 0 ? "ready" : "empty"
  };
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

    if (command.id === "task.quickCapture") {
      quickCaptureOpenStartedAt.current = rendererNow();
      setQuickCaptureOpen(true);
      return;
    }

    openNewTask();
  }, [command, source]);

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

  function openNewTask(): void {
    if (!canReplaceTaskInspector()) {
      return;
    }

    setSelectedTaskId(null);
    openTaskInspector(newTaskDraft(source));
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
    if (!selectedTask) {
      return;
    }

    setSelectedTaskId(null);
    openTaskInspector(
      newTaskDraft(source, {
        listId: selectedTask.listId,
        parentId: selectedTask.id
      })
    );
  }

  function deleteTaskList(taskListId: string): void {
    void source.deleteTaskList(taskListId);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1" role="toolbar" aria-label="Task actions">
          <Button
            data-action-id="task.create"
            onClick={openNewTask}
            title={actionDescription("task.create")}
            variant="primary"
          >
            <Plus aria-hidden="true" size={15} />
            {actionLabel("task.create")}
          </Button>
          <Button
            data-action-id="task.quickCapture"
            onClick={toggleQuickCapture}
            title={actionDescription("task.quickCapture")}
            variant="secondary"
          >
            <ListPlus aria-hidden="true" size={15} />
            {actionLabel("task.quickCapture")}
          </Button>
          <Button
            data-action-id="task.completeSelected"
            disabled={!selectedTask}
            onClick={() => selectedTask ? void toggleTask(selectedTask.id) : undefined}
            title={selectedTask ? actionDescription("task.completeSelected") : "No selected task"}
            variant="ghost"
          >
            {selectedTask?.status === "completed" ? (
              <RotateCcw aria-hidden="true" size={15} />
            ) : (
              <CheckCircle2 aria-hidden="true" size={15} />
            )}
            {selectedTask?.status === "completed" ? "Reopen" : "Complete"}
          </Button>
          <Button
            data-action-id="task.deleteSelected"
            disabled={!selectedTask}
            onClick={() => selectedTask ? void deleteTask(selectedTask.id) : undefined}
            title={selectedTask ? actionDescription("task.deleteSelected") : "No selected task"}
            variant="danger"
          >
            <Trash2 aria-hidden="true" size={15} />
            Delete
          </Button>
        </div>
        <Badge tone={source.syncStatus.pendingMutationCount > 0 ? "warning" : "success"}>
          {source.syncStatus.pendingMutationCount > 0
            ? `${source.syncStatus.pendingMutationCount} pending`
            : "Mutation queue idle"}
        </Badge>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto" role="tablist" aria-label="Task perspectives">
        {taskPerspectiveTabs.map((perspective) => {
          const selected = perspective.id === activePerspectiveId;

          return (
            <Button
              aria-selected={selected}
              key={perspective.id}
              onClick={() => {
                setActivePerspectiveId(perspective.id);

                if (perspective.id === "saved" && !activeSavedTaskViewId) {
                  setActiveSavedTaskViewId(source.settings.savedTaskViews[0]?.id ?? null);
                }
              }}
              role="tab"
              size="sm"
              variant={selected ? "secondary" : "ghost"}
            >
              {perspective.label}
              {perspective.id === "saved" ? (
                <Badge tone="neutral">{source.settings.savedTaskViews.length}</Badge>
              ) : null}
            </Button>
          );
        })}
        <Badge tone={activeTaskPerspective.state === "error" ? "warning" : "neutral"}>
          {activeTaskPerspective.description}
        </Badge>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto" role="toolbar" aria-label="Task filters">
        <Filter aria-hidden="true" className="shrink-0 text-text-muted" size={15} />
        {source.taskFilterViewModels.map((filter) => (
          <Button
            aria-pressed={filter.id === activeFilterId}
            key={filter.id}
            onClick={() => setActiveFilterId(filter.id)}
            size="sm"
            variant={filter.id === activeFilterId ? "secondary" : "ghost"}
          >
            {filter.label}
            <Badge tone={filter.state === "error" ? "warning" : "neutral"}>{filter.countLabel}</Badge>
          </Button>
        ))}
        <Button
          disabled={visibleTaskIds.length === 0}
          onClick={toggleVisibleTaskSelection}
          size="sm"
          variant={allVisibleTasksSelected ? "secondary" : "ghost"}
        >
          {allVisibleTasksSelected ? (
            <X aria-hidden="true" size={14} />
          ) : (
            <CheckCircle2 aria-hidden="true" size={14} />
          )}
          {allVisibleTasksSelected ? "Clear visible" : "Select visible"}
        </Button>
      </div>

      {source.taskMutationError ? (
        <StatusBanner
          action={
            <div className="flex items-center gap-2">
              <Button onClick={source.retryLastTaskMutation} size="sm" variant="secondary">
                <RotateCcw aria-hidden="true" size={14} />
                Retry
              </Button>
              <IconButton
                icon={X}
                label="Dismiss task write error"
                onClick={source.clearTaskMutationError}
                variant="ghost"
              />
            </div>
          }
          description={source.taskMutationError}
          icon={RotateCcw}
          title="Task write not saved"
          tone="warning"
        />
      ) : null}

      {bulkSelectedTaskIdsInWindow.length > 0 ? (
        <StatusBanner
          action={
            <div className="flex items-center gap-2">
              <select
                aria-label="Bulk move list"
                className="h-7 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-sm)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onChange={(event) => setBulkMoveListId(event.target.value)}
                value={bulkMoveTargetListId}
              >
                {source.taskLists.map((taskList) => (
                  <option key={taskList.id} value={taskList.id}>
                    {taskList.title}
                  </option>
                ))}
              </select>
              <Button
                disabled={!bulkMoveTargetListId || source.taskMutationPending}
                onClick={() => void moveBulkSelectedTasks()}
                size="sm"
                variant="secondary"
              >
                <ListPlus aria-hidden="true" size={14} />
                Move selected
              </Button>
              <Button
                disabled={source.taskMutationPending}
                onClick={() => void completeBulkSelectedTasks()}
                size="sm"
                variant="secondary"
              >
                <CheckCircle2 aria-hidden="true" size={14} />
                {bulkCompletionLabel}
              </Button>
              <Button
                disabled={source.taskMutationPending}
                onClick={() => void deleteBulkSelectedTasks()}
                size="sm"
                variant="danger"
              >
                <Trash2 aria-hidden="true" size={14} />
                Delete selected
              </Button>
              <IconButton
                icon={X}
                label="Clear task selection"
                onClick={() => setBulkSelectedTaskIds([])}
                variant="ghost"
              />
            </div>
          }
          description={`${bulkSelectedTasks.map((task) => task.title).slice(0, 3).join(", ")}`}
          icon={CheckCircle2}
          title={`${bulkSelectedTaskIdsInWindow.length} ${
            bulkSelectedTaskIdsInWindow.length === 1 ? "task" : "tasks"
          } selected`}
          tone="info"
        />
      ) : null}

      <SectionChrome
        title="Tasks"
        sidebar={
          <Panel
            title="Task lists"
            description={source.taskLists.length === 0 ? "Task lists unavailable" : "Lists"}
          >
            <div className="grid gap-2 p-3">
              <div className="flex items-center gap-2">
                <Input
                  aria-label="New task list title"
                  onChange={(event) => setNewListTitle(event.target.value)}
                  placeholder="New list"
                  value={newListTitle}
                />
                <IconButton
                  disabled={!newListTitle.trim() || source.taskMutationPending}
                  icon={Plus}
                  label="Create task list"
                  onClick={() => void createTaskList()}
                  variant="primary"
                />
              </div>
              {source.taskLists.map((taskList) => {
                const draftTitle = listTitleDrafts[taskList.id] ?? taskList.title;

                return (
                  <div className="grid grid-cols-[minmax(0,1fr)_32px_32px] gap-2" key={taskList.id}>
                    <Input
                      aria-label={`Rename ${taskList.title}`}
                      onChange={(event) =>
                        setListTitleDrafts((current) => ({
                          ...current,
                          [taskList.id]: event.target.value
                        }))
                      }
                      value={draftTitle}
                    />
                    <IconButton
                      disabled={
                        !draftTitle.trim() ||
                        draftTitle.trim() === taskList.title ||
                        source.taskMutationPending
                      }
                      icon={Save}
                      label={`Save ${taskList.title}`}
                      onClick={() => void renameTaskList(taskList.id, taskList.title)}
                      variant="ghost"
                    />
                    <IconButton
                      disabled={source.taskMutationPending}
                      icon={Trash2}
                      label={`Delete ${taskList.title}`}
                      onClick={() => deleteTaskList(taskList.id)}
                      variant="danger"
                    />
                  </div>
                );
              })}
            </div>
          </Panel>
        }
      >
        <div className="grid gap-3">
          {quickCaptureOpen ? (
            <Panel
              action={
                <Button disabled={!canCaptureTask} onClick={() => void captureQuickTask()} size="sm" variant="primary">
                  Capture
                </Button>
              }
              title="Quick capture"
              description={
                parsedQuickTask.dueDate
                  ? `${parsedQuickTask.dueDate} - ${source.taskLists.find((list) => list.id === parsedQuickTask.listId)?.title ?? "Inbox"}`
                  : source.taskLists.find((list) => list.id === parsedQuickTask.listId)?.title ?? "No list"
              }
            >
              <div className="grid gap-2 p-3">
                <Input
                  aria-label="Quick capture task"
                  onChange={(event) => setQuickCaptureInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void captureQuickTask();
                    }
                  }}
                  placeholder="Follow up tomorrow #Inbox"
                  value={quickCaptureInput}
                />
              </div>
            </Panel>
          ) : null}
          {source.dataState === "stale" ? (
            <Panel title="Refresh state" description="Cached rows remain visible">
              <LoadingState description="Refreshing local cache." title="Refreshing" />
            </Panel>
          ) : null}
          {activePerspectiveId === "saved" ? (
            <Panel
              title="Saved perspectives"
              description={`${source.settings.savedTaskViews.length} local views`}
            >
              <div className="grid gap-2 p-3" role="list" aria-label="Saved task perspectives">
                {source.settings.savedTaskViews.length > 0 ? (
                  source.settings.savedTaskViews.map((view) => {
                    const selected = view.id === activeSavedTaskView?.id;

                    return (
                      <div
                        className="grid grid-cols-[minmax(0,1fr)_32px] gap-2"
                        key={view.id}
                        role="listitem"
                      >
                        <button
                          aria-current={selected ? "true" : undefined}
                          aria-pressed={selected}
                          className={cx(
                            "min-w-0 rounded-hcbMd border px-3 py-2 text-left transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                            selected
                              ? "border-accent bg-surface-0"
                              : "border-border bg-bg-tertiary hover:bg-surface-0"
                          )}
                          onClick={() => setActiveSavedTaskViewId(view.id)}
                          type="button"
                        >
                          <span className="block truncate text-[var(--text-sm)] font-medium text-text-primary">
                            {view.name}
                          </span>
                          <span className="mt-1 flex flex-wrap gap-1">
                            {savedTaskViewFilterChips(view, source.taskLists).map((chip) => (
                              <Badge key={chip} tone="accent">
                                {chip}
                              </Badge>
                            ))}
                          </span>
                        </button>
                        <IconButton
                          disabled={source.settingsMutationPending}
                          icon={Trash2}
                          label={`Delete saved task perspective ${view.name}`}
                          onClick={() => deleteSavedTaskView(view.id)}
                          variant="danger"
                        />
                      </div>
                    );
                  })
                ) : (
                  <EmptyState
                    description="Saved task perspectives will appear here once settings contain task views."
                    title="No saved perspectives"
                  />
                )}
              </div>
            </Panel>
          ) : null}
          {!shouldRenderPerspectiveGroups ? null : activeTaskPerspective.state === "empty" ? (
            <Panel title="Task list" description="Empty filtered state">
              <EmptyState
                description={
                  activeFilterId === "empty"
                    ? "No cached tasks match this filter."
                    : "No cached tasks match this perspective."
                }
                title={activeFilterId === "empty" ? "No tasks in this filter" : "No tasks in this perspective"}
              />
            </Panel>
          ) : activeTaskPerspective.state === "error" ? (
            <Panel title="Task list" description="Recoverable renderer error state">
              <ErrorState />
            </Panel>
          ) : (
            <>
              {activeTaskPerspective.groups.map((group) => (
                <TaskGroupPanel
                  bulkSelectedTaskIds={bulkSelectedTaskIdsInWindow}
                  group={group}
                  onBulkSelectTask={setTaskBulkSelected}
                  key={group.id}
                  onDeleteTask={(taskId) => void deleteTask(taskId)}
                  onSelectTask={selectTask}
                  onToggleTask={(taskId) => void toggleTask(taskId)}
                  scheduledBlocksByTaskId={scheduledBlocksByTask}
                  selectedTaskId={selectedTaskId}
                />
              ))}
            </>
          )}
        </div>
      </SectionChrome>
    </div>
  );
}
