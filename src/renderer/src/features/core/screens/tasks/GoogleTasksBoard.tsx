import { Select, SelectItem } from "@renderer/components/Select";
import { DateTimeField } from "@renderer/components/DateTimeField";
import { cachedDateTimeFormat } from "@shared/zonedTime";
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import {
  CalendarClock,
  Clock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownRight,
  ListTodo,
  ListPlus,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  Star,
  Target,
  Trash2,
  X
} from "lucide-react";
import type { TaskListSummary, TaskMoveRequest } from "@shared/ipc/contracts";
import { FloatingMenu } from "../../../../components/FloatingMenu";
import { Badge, Button, IconButton, Input, cx } from "../../../../components/primitives";
import { EmptyState } from "../../../../components/states";
import { PagedVirtualList } from "../../../../components/PagedVirtualList";
import { useTaskParentCandidates } from "../../../../hooks/useTaskParentCandidates";
import { usePagedCollection } from "../../../../hooks/usePagedCollection";
import type { TaskBoardPage, TaskBoardRow as StoredBoardRow } from "@shared/collectionPages";
import { stableTaskViewModel } from "../../viewModelSource/taskViewModels";
import type { CoreViewModelSource } from "../../coreViewModelSource";
import type { ScheduledTaskBlockViewModel, TaskViewModel } from "../../coreViewModels";
import { MarkdownPreview, hasRenderableMixedMarkup } from "../../MarkdownPreview";
import { plannerLinkTargets } from "../../plannerLinkTargets";
import {
  TaskCompletionButton,
  taskScheduleLabel,
  taskScheduleTone
} from "../../coreScreenShared";
import { useAutoCollapsedSidebar } from "../useAutoCollapsedSidebar";
import { usePanePreference } from "../../../shell/panePreferences";
import { SectionSidebar, useWorkspaceSidebar } from "../../../shell/WorkspaceSidebar";

export interface TaskBoardSelection {
  mode: "lists";
  listIds: string[] | null;
}

export type TaskListSort = "myOrder" | "date" | "deadline" | "starred" | "title";

interface StarredState {
  ids: Set<string>;
  starredAt: Record<string, number>;
}

interface GoogleTasksBoardProps {
  listSorts: Record<string, TaskListSort>;
  onCreateList: () => void;
  onCreateTask: (listId?: string) => void;
  onDeleteList: (listId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onDuplicateTask: (taskId: string) => void;
  onMoveTask: (taskId: string, listId: string) => void;
  onMoveTaskRequest: (request: TaskMoveRequest) => void;
  onOpenTask: (taskId: string) => void;
  onRenameList: (list: TaskListSummary) => void;
  onScheduleTask: (task: TaskViewModel) => void;
  onSetListSort: (listId: string, sort: TaskListSort) => void;
  onToggleStar: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  onAddSubtask: (task: TaskViewModel) => void;
  scheduledBlocksByTask: Map<string, ScheduledTaskBlockViewModel>;
  selectedTaskId: string | null;
  selectedView: TaskBoardSelection;
  setSelectedView: (selection: TaskBoardSelection) => void;
  source: CoreViewModelSource;
  starred: StarredState;
}

const sortLabels: Record<TaskListSort, string> = {
  myOrder: "My order",
  date: "Recently updated",
  deadline: "Due date",
  starred: "Starred recently",
  title: "Title"
};
const taskDragType = "application/x-hcb-task-id";

function taskPreview(task: TaskViewModel): string {
  const text = task.detail.trim();

  if (!text) {
    return "";
  }

  return text;
}

function isFutureSnoozed(task: TaskViewModel): boolean {
  return Boolean(task.snoozeUntil && Date.parse(task.snoozeUntil) > Date.now());
}

function snoozeBadgeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Snoozed" : `Snoozed ${cachedDateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date)}`;
}

export function GoogleTasksBoard({
  listSorts,
  onCreateList,
  onCreateTask,
  onDeleteList,
  onDeleteTask,
  onDuplicateTask,
  onMoveTask,
  onMoveTaskRequest,
  onOpenTask,
  onRenameList,
  onScheduleTask,
  onSetListSort,
  onToggleStar,
  onToggleTask,
  onAddSubtask,
  scheduledBlocksByTask,
  selectedTaskId,
  selectedView,
  setSelectedView,
  source,
  starred
}: GoogleTasksBoardProps): JSX.Element {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [presentation, setPresentation] = usePanePreference<"list" | "board">("tasks.presentation", "list");
  const [allSort, setAllSort] = usePanePreference<TaskListSort>("tasks.sort", "deadline");
  const [bulkModeActive, setBulkModeActive] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkCustomDueDate, setBulkCustomDueDate] = useState("");
  const { autoCollapsed, containerRef } = useAutoCollapsedSidebar();
  const sharedSidebar = useWorkspaceSidebar();
  const effectiveSidebarCollapsed = sharedSidebar ? false : sidebarCollapsed || autoCollapsed;
  const visibleListIds = useMemo(() => selectedView.listIds ?? source.taskLists.map((list) => list.id), [selectedView.listIds, source.taskLists]);
  const columns = useMemo(() => {
    if (presentation === "list" && selectedView.listIds === null) return [{ id: "all", list: null, title: "All tasks" }];
    const visibleIds = new Set(visibleListIds);
    return source.taskLists.filter((list) => visibleIds.has(list.id)).map((list) => ({ id: list.id, list, title: list.title }));
  }, [selectedView.mode, selectedView.listIds, source.taskLists, visibleListIds, presentation]);
  useEffect(() => {
    if (!selectedTaskId || !window.hcb?.tasks.context) return;
    let active = true;
    void window.hcb.tasks.context({ id: selectedTaskId }).then((result) => {
      if (!active || !result.ok || !result.data.listId) return;
      const column = containerRef.current?.querySelector<HTMLElement>(`[data-task-list-id="${CSS.escape(result.data.listId)}"]`);
      column?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [selectedTaskId]);
  const [bulkTitles, setBulkTitles] = useState<Record<string, string>>({});
  const bulkSelectedTaskIds = [...bulkSelectedIds];
  const showBulkSelection = bulkModeActive || bulkSelectedTaskIds.length > 0;

  const toggleBulkTask = useCallback((taskId: string, selected: boolean, title?: string): void => {
    if (selected && bulkSelectedIds.size >= 500 && !bulkSelectedIds.has(taskId)) return;
    setBulkTitles((current) => {
      const next = { ...current };
      if (selected) next[taskId] = title ?? current[taskId] ?? "Selected task";
      else delete next[taskId];
      return next;
    });
    setBulkSelectedIds((current) => {
      const next = new Set(current);

      if (selected) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }

      return next;
    });
  }, [bulkSelectedIds]);

  async function bulkReschedule(dueDate: string | null): Promise<void> {
    if (bulkSelectedTaskIds.length === 0 || source.taskMutationPending) {
      return;
    }

    const saved = await source.bulkRescheduleTasks({
      taskIds: bulkSelectedTaskIds,
      dueDate
    });

    if (saved) {
      setBulkSelectedIds(new Set()); setBulkTitles({});
      setBulkModeActive(false);
    }
  }

  return (
    <div
      data-testid="tasks-board"
      data-presentation={presentation}
      data-task-count={source.resourceCounts.tasks ?? source.largeTaskWindow.length}
      data-cached-task-count={source.largeTaskWindow.length}
      data-hydration-state={source.hydrationState}
      className={cx(
        "grid min-h-0 flex-1 gap-3",
        sharedSidebar ? "grid-cols-1" : effectiveSidebarCollapsed ? "grid-cols-[56px_minmax(0,1fr)]" : "grid-cols-[220px_minmax(0,1fr)]"
      )}
      ref={containerRef}
    >
      <SectionSidebar><TaskBoardSidebar
        collapsed={effectiveSidebarCollapsed}
        onCreateList={onCreateList}
        onCreateTask={() => onCreateTask(selectedView.mode === "lists" && selectedView.listIds?.length === 1 ? selectedView.listIds[0] : undefined)}
        onToggleCollapsed={sharedSidebar ? undefined : () => setSidebarCollapsed((collapsed) => !collapsed)}
        selectedView={selectedView}
        setSelectedView={setSelectedView}
        source={source}
      /></SectionSidebar>
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-bg-primary">
        <header className="task-toolbar flex shrink-0 items-center gap-2 border-b border-border pb-3">
          <h1 className="mr-auto text-lg font-semibold">Tasks</h1>
          <div className="flex items-center gap-1" aria-label="Task presentation" role="group">
            <Button aria-pressed={presentation === "list"} onClick={() => setPresentation("list")} size="sm" variant={presentation === "list" ? "secondary" : "ghost"}>List</Button>
            <Button aria-pressed={presentation === "board"} onClick={() => setPresentation("board")} size="sm" variant={presentation === "board" ? "secondary" : "ghost"}>Board</Button>
          </div>
          {presentation === "list" && selectedView.listIds === null ? <Select aria-label="Sort tasks" className="max-w-28 rounded-md border border-border bg-bg-primary px-2 text-xs" value={allSort} onValueChange={(value) => setAllSort(value as TaskListSort)}>{Object.entries(sortLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</Select> : null}
          <Button aria-pressed={showBulkSelection} onClick={() => setBulkModeActive((active) => !active)} size="sm" variant="ghost">Select tasks</Button>
          {effectiveSidebarCollapsed ? <Button onClick={onCreateList} size="sm" variant="ghost">New list</Button> : null}
          <Button onClick={() => onCreateTask(selectedView.listIds?.length === 1 ? selectedView.listIds[0] : undefined)} size="sm" variant="primary">New task</Button>
        </header>
        {bulkSelectedTaskIds.length > 0 ? (
          <BoardBulkRescheduleBanner
            customDueDate={bulkCustomDueDate}
            onApplyCustom={() => void bulkReschedule(bulkCustomDueDate || null)}
            onClearSelection={() => {
              setBulkSelectedIds(new Set()); setBulkTitles({});
              setBulkModeActive(false);
            }}
            onCustomDueDateChange={setBulkCustomDueDate}
            onReschedule={(dueDate) => void bulkReschedule(dueDate)}
            pending={source.taskMutationPending}
            selectedCount={bulkSelectedTaskIds.length}
            selectedTitles={bulkSelectedTaskIds.map((id) => bulkTitles[id] ?? "Selected task")}
          />
        ) : null}
        <div
          className={cx(
            "flex min-h-0 min-w-0 flex-1 gap-3",
            presentation === "list" ? "overflow-auto" : "overflow-x-auto pt-3"
          )}
          role="list"
          aria-label="Task lists"
        >
          {columns.length > 0 ? (
            columns.map((column) => (
              <TaskListColumn
                key={`${presentation}:${column.id}`}
                compact={presentation === "list"}
                allTasks={column.id === "all"}
                list={column.list}
                listSort={column.list ? listSorts[column.list.id] ?? "myOrder" : column.id === "all" ? allSort : "starred"}
                onCreateList={onCreateList}
                onCreateTask={onCreateTask}
                onDeleteList={onDeleteList}
                onDeleteTask={onDeleteTask}
                onDuplicateTask={onDuplicateTask}
                onMoveTask={onMoveTask}
                onMoveTaskRequest={onMoveTaskRequest}
                onOpenTask={onOpenTask}
                onRenameList={onRenameList}
                onScheduleTask={onScheduleTask}
                onSetListSort={onSetListSort}
                onStartBulkSelect={() => setBulkModeActive(true)}
                onToggleStar={onToggleStar}
                onToggleTask={onToggleTask}
                onAddSubtask={onAddSubtask}
                bulkSelectedIds={bulkSelectedIds}
                onBulkSelectTask={toggleBulkTask}
                showBulkSelection={showBulkSelection}
                scheduledBlocksByTask={scheduledBlocksByTask}
                selectedTaskId={selectedTaskId}
                source={source}
                starred={starred}
                singleColumn={columns.length === 1}
                title={column.title}
              />
            ))
          ) : (
            <div className="grid min-h-[360px] min-w-80 flex-1 place-items-center rounded-hcbLg border border-border bg-bg-primary">
              <EmptyState
                description={
                  source.taskLists.length > 0
                    ? "Select at least one list from the sidebar to show it here."
                    : "Create a Google Tasks list to start collecting tasks."
                }
                title={source.taskLists.length > 0 ? "No visible task lists" : "No task lists"}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskBoardSidebar({
  collapsed,
  onCreateList,
  onCreateTask,
  onToggleCollapsed,
  selectedView,
  setSelectedView,
  source
}: {
  collapsed: boolean;
  onCreateList: () => void;
  onCreateTask: () => void;
  onToggleCollapsed?: () => void;
  selectedView: TaskBoardSelection;
  setSelectedView: (selection: TaskBoardSelection) => void;
  source: CoreViewModelSource;
}): JSX.Element {
  const [listsOpen, setListsOpen] = usePanePreference("tasks.listsOpen", true);
  const listsId = useId();
  const listCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const list of source.taskLists) {
      const count = list.activeRootTaskCount ?? list.activeTaskCount ?? 0;
      counts.set(list.id, count);
      total += count;
    }
    return { counts, total };
  }, [source.taskLists]);

  function selectAllLists(): void {
    setSelectedView({ mode: "lists", listIds: null });
  }

  function selectList(listId: string): void {
    setSelectedView({ mode: "lists", listIds: [listId] });
  }

  if (collapsed) {
    return (
      <aside className="min-h-0 rounded-hcbLg bg-bg-secondary p-2" aria-label="Task board navigation">
        <IconButton
          className="size-9 rounded-hcbMd"
          icon={PanelLeftOpen}
          label="Expand task sidebar"
          onClick={onToggleCollapsed}
          variant="ghost"
        />
      </aside>
    );
  }

  return (
    <aside className="min-h-0 rounded-hcbLg bg-bg-secondary p-3" aria-label="Task board navigation">
      <div className="flex items-center gap-2">

        {onToggleCollapsed ? <IconButton
          className="size-10 rounded-hcbMd"
          icon={PanelLeftClose}
          label="Collapse task sidebar"
          onClick={onToggleCollapsed}
          variant="ghost"
        /> : null}
      </div>
      <div className="mt-5 grid gap-1">
        <TaskSidebarButton
          count={listCounts.total}
          label="All tasks"
          onClick={selectAllLists}
          selected={selectedView.mode === "lists" && selectedView.listIds === null}
        />

      </div>
      <div className="mt-6">
        <button
          aria-controls={listsId}
          aria-expanded={listsOpen}
          className="flex min-h-8 w-full items-center justify-between rounded-hcbMd px-2 text-[var(--text-sm)] font-semibold text-text-primary hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => setListsOpen((open) => !open)}
          type="button"
        >
          Lists
          <ChevronDown aria-hidden="true" size={14} className={cx("transition-transform duration-200 ease-hcb", !listsOpen && "-rotate-90")} />
        </button>
        <div className="task-lists-disclosure" data-open={listsOpen} id={listsId} inert={!listsOpen} aria-hidden={!listsOpen}>
        <div className="min-h-0 overflow-hidden">
        <div className="grid gap-1 pt-2">
          {source.taskLists.map((list) => (
            <TaskListButton
              count={listCounts.counts.get(list.id) ?? 0}
              key={list.id}
              label={list.title}
              onClick={() => selectList(list.id)}
              selected={selectedView.mode === "lists" && selectedView.listIds?.includes(list.id) === true}
            />
          ))}
        </div>
        </div>
        </div>
      </div>
      <Button className="mt-5 justify-start" onClick={onCreateList} variant="ghost">
        <Plus aria-hidden="true" size={16} />
        New list
      </Button>
    </aside>
  );
}

function TaskSidebarButton({
  count,
  label,
  onClick,
  selected
}: {
  count: number;
  label: string;
  onClick: () => void;
  selected: boolean;
}): JSX.Element {
  return (
    <button
      aria-current={selected ? "page" : undefined}
      className={cx(
        "grid h-9 grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-hcbLg px-2 text-left transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        selected ? "bg-accent/20 text-text-primary" : "text-text-secondary hover:bg-surface-0 hover:text-text-primary"
      )}
      onClick={onClick}
      type="button"
    >
      <CheckCircle2 aria-hidden="true" size={17} />
      <span className="truncate text-[var(--text-base)] font-medium">{label}</span>
      <span className="text-[var(--text-xs)] text-text-muted">{count}</span>
    </button>
  );
}

function TaskListButton({
  count,
  label,
  onClick,
  selected
}: {
  count: number;
  label: string;
  onClick: () => void;
  selected: boolean;
}): JSX.Element {
  return (
    <button
      aria-current={selected ? "page" : undefined}
      aria-label={label}
      className={cx(
        "grid h-9 grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-hcbLg px-2 text-left transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        selected ? "bg-accent/20 text-text-primary" : "text-text-secondary hover:bg-surface-0 hover:text-text-primary"
      )}
      onClick={onClick}
      type="button"
    >
      <ListTodo aria-hidden="true" size={16} />
      <span className="truncate text-[var(--text-base)] font-medium">{label}</span>
      <span className="text-[var(--text-xs)] text-text-muted">{count}</span>
    </button>
  );
}

function googleAccountLabel(source: CoreViewModelSource, accountId?: string): string {
  const account = source.googleStatus.accounts.find((candidate) => candidate.accountId === accountId);
  return account?.displayName || account?.email || "Local";
}

function showAccountBadges(source: CoreViewModelSource): boolean {
  return source.googleStatus.accounts.length > 1;
}

function dateOnlyFromLocalOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function BoardBulkRescheduleBanner({
  customDueDate,
  onApplyCustom,
  onClearSelection,
  onCustomDueDateChange,
  onReschedule,
  pending,
  selectedCount,
  selectedTitles
}: {
  customDueDate: string;
  onApplyCustom: () => void;
  onClearSelection: () => void;
  onCustomDueDateChange: (value: string) => void;
  onReschedule: (dueDate: string | null) => void;
  pending: boolean;
  selectedCount: number;
  selectedTitles: string[];
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-primary px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[var(--text-sm)] font-semibold text-text-primary">
          {selectedCount} {selectedCount === 1 ? "task" : "tasks"} selected · maximum 500
        </div>
        <div className="truncate text-[var(--text-xs)] text-text-muted">
          {selectedTitles.slice(0, 3).join(", ")}
        </div>
      </div>
      <Button disabled={pending} onClick={() => onReschedule(dateOnlyFromLocalOffset(0))} size="sm" variant="secondary">
        Today
      </Button>
      <Button disabled={pending} onClick={() => onReschedule(dateOnlyFromLocalOffset(1))} size="sm" variant="secondary">
        Tomorrow
      </Button>
      <Button disabled={pending} onClick={() => onReschedule(dateOnlyFromLocalOffset(7))} size="sm" variant="secondary">
        Next week
      </Button>
      <DateTimeField
        aria-label="Bulk due date"
        className="h-8 w-36"
        onValueChange={(value) => onCustomDueDateChange(value)}
        type="date"
        value={customDueDate}
      />
      <Button disabled={pending || !customDueDate} onClick={onApplyCustom} size="sm" variant="secondary">
        Apply date
      </Button>
      <Button disabled={pending} onClick={() => onReschedule(null)} size="sm" variant="secondary">
        Clear due
      </Button>
      <IconButton icon={X} label="Clear task selection" onClick={onClearSelection} variant="ghost" />
    </div>
  );
}

function TaskListColumn({
  compact, allTasks,
  list,
  listSort,
  onCreateList,
  onCreateTask,
  onDeleteList,
  onDeleteTask,
  onDuplicateTask,
  onMoveTask,
  onMoveTaskRequest,
  onOpenTask,
  onRenameList,
  onScheduleTask,
  onSetListSort,
  onStartBulkSelect,
  onToggleStar,
  onToggleTask,
  onAddSubtask,
  bulkSelectedIds,
  onBulkSelectTask,
  showBulkSelection,
  scheduledBlocksByTask,
  selectedTaskId,
  source,
  starred,
  singleColumn,
  title
}: {
  compact: boolean;
  allTasks: boolean;
  list: TaskListSummary | null;
  listSort: TaskListSort;
  onCreateList: () => void;
  onCreateTask: (listId?: string) => void;
  onDeleteList: (listId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onDuplicateTask: (taskId: string) => void;
  onMoveTask: (taskId: string, listId: string) => void;
  onMoveTaskRequest: (request: TaskMoveRequest) => void;
  onOpenTask: (taskId: string) => void;
  onRenameList: (list: TaskListSummary) => void;
  onScheduleTask: (task: TaskViewModel) => void;
  onSetListSort: (listId: string, sort: TaskListSort) => void;
  onStartBulkSelect: () => void;
  onToggleStar: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  onAddSubtask: (task: TaskViewModel) => void;
  bulkSelectedIds: ReadonlySet<string>;
  onBulkSelectTask: (taskId: string, selected: boolean, title?: string) => void;
  showBulkSelection: boolean;
  scheduledBlocksByTask: Map<string, ScheduledTaskBlockViewModel>;
  selectedTaskId: string | null;
  source: CoreViewModelSource;
  starred: StarredState;
  singleColumn: boolean;
  title: string;
}): JSX.Element {
  const columnRef = useRef<HTMLElement>(null);
  const lastScrollTop = useRef(0);
  const [visible, setVisible] = useState(singleColumn || typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = columnRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root: element.parentElement, rootMargin: "0px 440px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(() => new Set());
  const toggleChildren = useCallback((id: string, open?: boolean) => {
    setCollapsedTaskIds((current) => {
      const next = new Set(current);
      if (open ?? current.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const viewModels = useMemo(() => new WeakMap<object, TaskViewModel>(), [title]);
  const queryKey = JSON.stringify([list?.id, allTasks, listSort, completedOpen, [...collapsedTaskIds], source.taskDataRevision, [...starred.ids], starred.starredAt]);
  const collection = usePagedCollection<StoredBoardRow, TaskBoardPage>(queryKey, async (offset, limit) => {
    const result = await window.hcb!.tasks.board({ ...(list ? { listId: list.id } : allTasks ? {} : { starred: true }), sort: listSort, completedOpen, collapsedTaskIds: [...collapsedTaskIds], cursor: String(offset), limit });
    if (!result.ok) throw new Error(result.error.message);
    return result.data as TaskBoardPage;
  }, 100, visible);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const locateOptions = useRef({ listSort, collapsedTaskIds, completedOpen });
  locateOptions.current = { listSort, collapsedTaskIds, completedOpen };
  useEffect(() => {
    if (!selectedTaskId || !visible) return;
    let active = true;
    const options = locateOptions.current;
    void window.hcb!.tasks.board({ ...(list ? { listId: list.id } : allTasks ? {} : { starred: true }), sort: options.listSort,
      locateTaskId: selectedTaskId, collapsedTaskIds: [...options.collapsedTaskIds], completedOpen: options.completedOpen, limit: 1 }).then((result) => {
      if (!active || !result.ok || result.data.locatedIndex == null) return;
      if (result.data.revealParentId) toggleChildren(result.data.revealParentId, true);
      if (result.data.revealCompleted) setCompletedOpen(true);
      setSelectedIndex(result.data.locatedIndex);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [selectedTaskId, visible, list?.id]);
  const showAccounts = showAccountBadges(source);

  function handleDragOver(event: DragEvent<HTMLElement>): void {
    if (!list || !event.dataTransfer.types.includes(taskDragType)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropActive(true);
  }

  function handleDrop(event: DragEvent<HTMLElement>): void {
    if (!list) {
      return;
    }

    const taskId = event.dataTransfer.getData(taskDragType);

    if (!taskId) {
      return;
    }

    event.preventDefault();
    setDropActive(false);
    onMoveTask(taskId, list.id);
  }

  return (
    <section
      ref={columnRef}
      data-column-loaded={visible}
      data-task-list-id={list?.id}
      className={cx(
        "flex max-h-full min-h-0 flex-col overflow-hidden bg-bg-primary",
        !compact && "rounded-hcbLg border border-border",
        singleColumn ? "w-full" : "w-[min(420px,calc(100vw-2rem))] shrink-0",
        dropActive && "ring-2 ring-info"
      )}
      onDragLeave={() => setDropActive(false)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role="listitem"
    >
      <div className="relative flex shrink-0 items-center gap-2 px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-[var(--text-md)] font-semibold text-text-primary">{title}</h2>
        {showAccounts && list?.accountId ? <Badge tone="neutral">{googleAccountLabel(source, list.accountId)}</Badge> : null}
        {list ? (
          <IconButton
            aria-expanded={menuOpen}
            className="rounded-full"
            icon={MoreVertical}
            label={`Open ${list.title} list menu`}
            onClick={() => setMenuOpen((open) => !open)}
            variant="ghost"
          />
        ) : null}
        {menuOpen && list ? (
          <ListActionMenu
            list={list}
            onClose={() => setMenuOpen(false)}
            onDeleteList={onDeleteList}
            onRenameList={onRenameList}
            onSetListSort={onSetListSort}
            onStartBulkSelect={onStartBulkSelect}
            selectedSort={listSort}
          />
        ) : null}
      </div>
      <button
        className="flex h-9 items-center gap-3 px-4 text-left text-[var(--text-base)] font-medium text-accent transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={() => onCreateTask(list?.id)}
        type="button"
      >
        <CheckCircle2 aria-hidden="true" size={18} />
        {list || allTasks ? "Add a task" : "Add a starred task"}
      </button>
        {visible ? <PagedVirtualList
          estimateRowHeight={compact ? 48 : 88}
          scrollToIndex={selectedIndex}
          initialScrollTop={lastScrollTop.current}
          onScrollPositionChange={(top) => { lastScrollTop.current = top; }}
          ariaLabel={allTasks ? "All tasks" : `${title} tasks`}
          collection={collection}
          getKey={(row) => row.kind === "completed" ? "completed-header" : row.task.id}
          emptyState={<div className="grid min-h-[240px] place-items-center px-6"><EmptyState description={list || allTasks ? "Add a task to keep this list moving." : "Stars are saved on this device. Star a task from any list to collect it here."} title={list || allTasks ? `${title} is empty` : "No starred tasks"} /></div>}
          renderRow={(row) => {
            if (row.kind === "completed") return (
              <button aria-expanded={completedOpen} className="flex h-11 w-full items-center gap-2 border-t border-border px-4 text-left text-text-secondary hover:bg-surface-0" onClick={() => setCompletedOpen((open) => !open)} type="button">
                {completedOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
                Completed ({row.count})
              </button>
            );
            let task = viewModels.get(row.task);
            if (!task) {
              task = stableTaskViewModel(row.task, source.taskLists.find((item) => item.id === row.task.listId)?.title ?? title, [], new Map());
              viewModels.set(row.task, task);
            }
            if (row.kind === "child") return (
              <TaskChildRow
                onAddSubtask={onAddSubtask} onCreateList={onCreateList} onDeleteTask={onDeleteTask}
                onDuplicateTask={onDuplicateTask} onMoveTask={onMoveTask} onMoveTaskRequest={onMoveTaskRequest}
                onOpenTask={onOpenTask} onToggleTask={onToggleTask} onBulkSelectTask={onBulkSelectTask}
                selected={selectedTaskId === task.id} task={task} selectedForBulk={bulkSelectedIds.has(task.id)}
                showBulkSelection={showBulkSelection} showAccountBadge={showAccounts} source={source}
              />
            );
            return (
              <GoogleTaskRow
                compact={compact}
                onCreateList={onCreateList} onDeleteTask={onDeleteTask} onDuplicateTask={onDuplicateTask}
                onMoveTask={onMoveTask} onMoveTaskRequest={onMoveTaskRequest} onOpenTask={onOpenTask}
                onScheduleTask={onScheduleTask} onToggleStar={onToggleStar} onToggleTask={onToggleTask}
                onAddSubtask={onAddSubtask} bulkSelected={bulkSelectedIds.has(task.id)} bulkSelectedIds={bulkSelectedIds}
                onBulkSelectTask={onBulkSelectTask} showBulkSelection={showBulkSelection}
                scheduledBlock={scheduledBlocksByTask.get(task.id)} selected={selectedTaskId === task.id}
                selectedTaskId={selectedTaskId} source={source} starred={starred.ids.has(task.id)}
                task={task} showAccountBadge={showAccounts} childrenOpen={!collapsedTaskIds.has(task.id)}
                onToggleChildren={toggleChildren}
              />
            );
          }}
        /> : <p className="p-4 text-sm text-text-muted">Scroll here to load this list.</p>}
    </section>
  );
}

function ListActionMenu({
  list,
  onClose,
  onDeleteList,
  onRenameList,
  onSetListSort,
  onStartBulkSelect,
  selectedSort
}: {
  list: TaskListSummary;
  onClose: () => void;
  onDeleteList: (listId: string) => void;
  onRenameList: (list: TaskListSummary) => void;
  onSetListSort: (listId: string, sort: TaskListSort) => void;
  onStartBulkSelect: () => void;
  selectedSort: TaskListSort;
}): JSX.Element {
  function chooseSort(sort: TaskListSort): void {
    onSetListSort(list.id, sort);
    onClose();
  }

  return (
    <div className="absolute right-3 top-12 z-30 w-72 overflow-hidden rounded-hcbLg border border-border bg-bg-primary py-2 shadow-xl">
      <div className="px-4 py-2 text-[var(--text-sm)] font-medium text-text-secondary">Sort by</div>
      {(Object.keys(sortLabels) as TaskListSort[]).map((sort) => (
        <MenuButton key={sort} onClick={() => chooseSort(sort)}>
          <span className="w-5">{selectedSort === sort ? <Check aria-hidden="true" size={16} /> : null}</span>
          {sortLabels[sort]}
        </MenuButton>
      ))}
      <MenuSeparator />
      <MenuButton onClick={() => { onRenameList(list); onClose(); }}>Rename list</MenuButton>
      <MenuButton onClick={() => { onDeleteList(list.id); onClose(); }}>Delete list</MenuButton>
      <MenuButton onClick={() => { onStartBulkSelect(); onClose(); }}>Select tasks</MenuButton>
      <MenuSeparator />
    </div>
  );
}

interface GoogleTaskRowProps {
  compact: boolean;
  bulkSelected: boolean;
  bulkSelectedIds: ReadonlySet<string>;
  onCreateList: () => void;
  onDeleteTask: (taskId: string) => void;
  onDuplicateTask: (taskId: string) => void;
  onMoveTask: (taskId: string, listId: string) => void;
  onMoveTaskRequest: (request: TaskMoveRequest) => void;
  onOpenTask: (taskId: string) => void;
  onScheduleTask: (task: TaskViewModel) => void;
  onToggleStar: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  onAddSubtask: (task: TaskViewModel) => void;
  onBulkSelectTask: (taskId: string, selected: boolean, title?: string) => void;
  showBulkSelection: boolean;
  scheduledBlock?: ScheduledTaskBlockViewModel;
  selected: boolean;
  selectedTaskId: string | null;
  source: CoreViewModelSource;
  starred: boolean;
  task: TaskViewModel;
  showAccountBadge: boolean;
  childrenOpen: boolean;
  onToggleChildren: (id: string, open?: boolean) => void;
}

const GoogleTaskRow = memo(function GoogleTaskRow({
  compact,
  bulkSelected,
  bulkSelectedIds,
  onCreateList,
  onDeleteTask,
  onDuplicateTask,
  onMoveTask,
  onMoveTaskRequest,
  onOpenTask,
  onScheduleTask,
  onToggleStar,
  onToggleTask,
  onAddSubtask,
  onBulkSelectTask,
  showBulkSelection,
  scheduledBlock,
  selected,
  selectedTaskId,
  source,
  starred,
  task,
  showAccountBadge,
  childrenOpen,
  onToggleChildren
}: GoogleTaskRowProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null);
  const scheduleLabel = taskScheduleLabel(task, scheduledBlock, source.settings.defaultTimeZone);
  const preview = taskPreview(task);
  const completed = task.status === "completed";
  const futureSnoozed = isFutureSnoozed(task);
  const childCount = task.subtaskCount ?? task.subtasks.length;
  const completedChildCount = task.completedSubtaskCount ?? task.subtasks.filter((child) => child.completed).length;
  const childrenId = `task-children-${task.id}`;

  function openContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    setMenuPoint({ x: event.clientX, y: event.clientY });
    setMenuOpen(true);
  }

  return (
    <div onContextMenu={openContextMenu} role="listitem" data-task-row={task.id} data-compact={compact}>
      <div
        className={cx(
          "group relative grid items-center gap-2 border-b border-border/50 px-3 py-2 transition-colors duration-fast ease-hcb",
          showBulkSelection ? "grid-cols-[24px_32px_minmax(0,1fr)_auto]" : "grid-cols-[32px_minmax(0,1fr)_auto]",
          selected ? "bg-surface-0" : "hover:bg-surface-0",
          futureSnoozed && "opacity-65"
        )}
        draggable
        onContextMenu={openContextMenu}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(taskDragType, task.id);
        }}
      >
        {showBulkSelection ? (
          <input
            aria-label={`Select ${task.title}`}
            checked={bulkSelected}
            className="mt-2 size-4 accent-[var(--color-accent)]"
            onChange={(event) => onBulkSelectTask(task.id, event.target.checked, task.title)}
            type="checkbox"
          />
        ) : null}
        <TaskCompletionButton completed={completed} onToggle={onToggleTask} task={task} />
        <div className="flex min-w-0 items-start gap-1">
          {childCount > 0 ? (
            <button
              aria-controls={childrenId}
              aria-expanded={childrenOpen}
              aria-label={`${childrenOpen ? "Collapse" : "Expand"} subtasks for ${task.title}`}
              className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-text-muted hover:bg-surface-1 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              onClick={() => onToggleChildren(task.id)}
              type="button"
            >
              {childrenOpen ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronRight aria-hidden="true" size={15} />}
            </button>
          ) : null}
        <div className={cx("min-w-0 flex-1", compact && "flex items-center gap-3")} >
          <button
            data-virtual-focus
            className="min-w-0 w-full flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={() => onOpenTask(task.id)}
            onKeyDown={(event) => {
              if (childCount === 0) return;
              if (event.key === "ArrowRight") {
                event.preventDefault();
                onToggleChildren(task.id, true);
              }
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                onToggleChildren(task.id, false);
              }
            }}
            type="button"
          >
            <div className="flex min-w-0 items-start gap-1">
              <span className={cx(
                compact ? "truncate min-w-0 text-[var(--text-base)] font-medium" : "line-clamp-2 min-w-0 text-[var(--text-md)] font-medium",
                completed ? "text-text-muted line-through" : "text-text-primary"
              )}>{task.title}</span>
              {childCount > 0 ? (
                <span className="ml-auto shrink-0 text-[var(--text-xs)] tabular-nums text-text-muted">
                  {completedChildCount}/{childCount}
                </span>
              ) : null}
            </div>
          </button>
          {!compact && preview && hasRenderableMixedMarkup(preview) ? (
            <div
              className={cx("mt-0.5 min-w-0", completed && "text-text-muted line-through")}
              onClick={(clickEvent) => clickEvent.stopPropagation()}
              onKeyDown={(keyEvent) => keyEvent.stopPropagation()}
            >
              <MarkdownPreview
                ariaLabel={`Description for ${task.title}`}
                body={preview}
                plannerLinkTargets={/\[\[|hcb:|hotcrossbuns:/.test(task.detail) ? plannerLinkTargets(source) : undefined}
                variant="summary"
              />
            </div>
          ) : null}
          {!compact && (scheduleLabel || task.dueDate || task.snoozeUntil || (showAccountBadge && task.accountId)) ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {showAccountBadge && task.accountId ? (
                <Badge tone="neutral">{googleAccountLabel(source, task.accountId)}</Badge>
              ) : null}
              {task.dueDate ? (
                <Badge className="gap-1">
                  <CalendarClock aria-hidden="true" size={12} />
                  {task.dueLabel}
                </Badge>
              ) : null}
              {scheduleLabel ? (
                <Badge className="gap-1" tone={taskScheduleTone(scheduledBlock)}>
                  <Target aria-hidden="true" size={12} />
                  {scheduleLabel}
                </Badge>
              ) : null}
              {task.snoozeUntil ? (
                <Badge className="gap-1" tone={futureSnoozed ? "warning" : "neutral"}>
                  <Clock aria-hidden="true" size={12} />
                  {snoozeBadgeLabel(task.snoozeUntil)}
                </Badge>
              ) : null}
            </div>
          ) : null}
          {compact ? <div className="task-row-metadata flex shrink-0 items-center gap-3 text-xs tabular-nums text-text-muted">
            <span className="w-24 truncate" title={task.dueDate ?? "No due date"}>{task.dueDate ? task.dueLabel : "—"}</span>
            <span className="task-row-duration w-12 text-right">{task.durationMinutes ? `${task.durationMinutes}m` : "—"}</span>
          </div> : null}
        </div>
        </div>
        <div
          className="task-row-actions relative flex items-start gap-1 opacity-0 transition-opacity duration-fast ease-hcb group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <IconButton
            className={cx("size-9 rounded-full [&_svg]:size-5", starred ? "text-accent [&_svg]:fill-current" : undefined)}
            icon={Star}
            label={starred ? `Unstar ${task.title}` : `Star ${task.title}`}
            onClick={() => onToggleStar(task.id)}
            variant="ghost"
          />
          <IconButton
            className="size-9 rounded-full"
            icon={CalendarClock}
            label={scheduledBlock ? `Reschedule ${task.title}` : `Schedule ${task.title}`}
            onClick={() => onScheduleTask(task)}
            variant="ghost"
          />
          <IconButton className="size-9" icon={MoreVertical} label={`More actions for ${task.title}`} variant="ghost" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMenuPoint({ x: rect.right, y: rect.bottom }); setMenuOpen(true); }} />
          {menuOpen ? (
            <TaskActionMenu
              anchorPoint={menuPoint ?? undefined}
              onClose={() => setMenuOpen(false)}
              onAddSubtask={() => { onAddSubtask(task); setMenuOpen(false); }}
              onCreateList={() => { onCreateList(); setMenuOpen(false); }}
              onDelete={() => { onDeleteTask(task.id); setMenuOpen(false); }}
              onDuplicate={() => { onDuplicateTask(task.id); setMenuOpen(false); }}
              onMoveTask={(listId) => { onMoveTask(task.id, listId); setMenuOpen(false); }}
              onMoveTaskRequest={(request) => { onMoveTaskRequest(request); setMenuOpen(false); }}
              onOpen={() => { onOpenTask(task.id); setMenuOpen(false); }}
              onSchedule={() => { onScheduleTask(task); setMenuOpen(false); }}
              onToggleStar={() => { onToggleStar(task.id); setMenuOpen(false); }}
              starred={starred}
              source={source}
              task={task}
            />
          ) : null}
        </div>
      </div>

    </div>
  );
}, areGoogleTaskRowPropsEqual);

function areGoogleTaskRowPropsEqual(previous: GoogleTaskRowProps, next: GoogleTaskRowProps): boolean {
  return (
    previous.compact === next.compact &&
    previous.childrenOpen === next.childrenOpen &&
    previous.onToggleChildren === next.onToggleChildren &&
    previous.bulkSelected === next.bulkSelected &&
    previous.bulkSelectedIds === next.bulkSelectedIds &&
    previous.onAddSubtask === next.onAddSubtask &&
    previous.onBulkSelectTask === next.onBulkSelectTask &&
    previous.onCreateList === next.onCreateList &&
    previous.onDeleteTask === next.onDeleteTask &&
    previous.onDuplicateTask === next.onDuplicateTask &&
    previous.onMoveTask === next.onMoveTask &&
    previous.onMoveTaskRequest === next.onMoveTaskRequest &&
    previous.onOpenTask === next.onOpenTask &&
    previous.onScheduleTask === next.onScheduleTask &&
    previous.onToggleStar === next.onToggleStar &&
    previous.onToggleTask === next.onToggleTask &&
    previous.scheduledBlock === next.scheduledBlock &&
    previous.selected === next.selected &&
    previous.selectedTaskId === next.selectedTaskId &&
    previous.showAccountBadge === next.showAccountBadge &&
    previous.showBulkSelection === next.showBulkSelection &&
    previous.source.calendarAgendaEvents === next.source.calendarAgendaEvents &&
    previous.source.googleStatus === next.source.googleStatus &&
    previous.source.initialNotes === next.source.initialNotes &&
    previous.starred === next.starred &&
    previous.task === next.task
  );
}

function TaskChildRow({
  onAddSubtask,
  onCreateList,
  onDeleteTask,
  onDuplicateTask,
  onBulkSelectTask,
  onMoveTask,
  onMoveTaskRequest,
  onOpenTask,
  onToggleTask,
  selected,
  selectedForBulk,
  showBulkSelection,
  showAccountBadge,
  source,
  task
}: {
  onAddSubtask: (task: TaskViewModel) => void;
  onCreateList: () => void;
  onDeleteTask: (taskId: string) => void;
  onDuplicateTask: (taskId: string) => void;
  onBulkSelectTask: (taskId: string, selected: boolean, title?: string) => void;
  onMoveTask: (taskId: string, listId: string) => void;
  onMoveTaskRequest: (request: TaskMoveRequest) => void;
  onOpenTask: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  selected: boolean;
  selectedForBulk: boolean;
  showBulkSelection: boolean;
  showAccountBadge: boolean;
  source: CoreViewModelSource;
  task: TaskViewModel;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null);
  const completed = task.status === "completed";

  return (
    <div
      className={cx(
        "group relative grid items-start gap-2 py-1.5 pl-3 pr-4 transition-colors duration-fast ease-hcb",
        showBulkSelection ? "grid-cols-[24px_28px_minmax(0,1fr)_auto]" : "grid-cols-[28px_minmax(0,1fr)_auto]",
        selected ? "bg-surface-0" : "hover:bg-surface-0"
      )}
      draggable
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setMenuPoint({ x: event.clientX, y: event.clientY });
        setMenuOpen(true);
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(taskDragType, task.id);
      }}
      role="listitem"
    >
      {showBulkSelection ? (
        <input
          aria-label={`Select ${task.title}`}
          checked={selectedForBulk}
          className="mt-2 size-4 accent-[var(--color-accent)]"
          onChange={(event) => onBulkSelectTask(task.id, event.target.checked, task.title)}
          type="checkbox"
        />
      ) : null}
      <TaskCompletionButton completed={completed} onToggle={onToggleTask} task={task} />
      <button
        data-virtual-focus
        className="min-w-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={() => onOpenTask(task.id)}
        type="button"
      >
        <div className={cx(
          "line-clamp-2 text-[var(--text-sm)] font-medium",
          completed ? "text-text-muted line-through" : "text-text-primary"
        )}>{task.title}</div>
        {showAccountBadge && task.accountId ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone="neutral">{googleAccountLabel(source, task.accountId)}</Badge>
          </div>
        ) : null}
      </button>
      <button
        aria-expanded={menuOpen}
        aria-label={`Open ${task.title} task menu`}
        className="mt-0.5 flex size-8 items-center justify-center rounded-full text-text-muted opacity-0 transition-opacity duration-fast ease-hcb hover:bg-surface-1 hover:text-text-primary group-hover:opacity-100 group-focus-within:opacity-100"
        onClick={() => setMenuOpen((open) => !open)}
        type="button"
      >
        <MoreVertical aria-hidden="true" size={16} />
      </button>
      {menuOpen ? (
        <TaskActionMenu
          anchorPoint={menuPoint ?? undefined}
          onClose={() => setMenuOpen(false)}
          onAddSubtask={() => { onAddSubtask(task); setMenuOpen(false); }}
          onCreateList={() => { onCreateList(); setMenuOpen(false); }}
          onDelete={() => { onDeleteTask(task.id); setMenuOpen(false); }}
          onDuplicate={() => { onDuplicateTask(task.id); setMenuOpen(false); }}
          onMoveTask={(listId) => { onMoveTask(task.id, listId); setMenuOpen(false); }}
          onMoveTaskRequest={(request) => { onMoveTaskRequest(request); setMenuOpen(false); }}
          onOpen={() => { onOpenTask(task.id); setMenuOpen(false); }}
          source={source}
          task={task}
        />
      ) : null}
    </div>
  );
}

function TaskActionMenu({
  onSchedule, onToggleStar, starred,
  anchorPoint,
  onClose,
  onAddSubtask,
  onCreateList,
  onDelete,
  onDuplicate,
  onMoveTask,
  onMoveTaskRequest,
  onOpen,
  source,
  task
}: {
  onSchedule?: () => void;
  onToggleStar?: () => void;
  starred?: boolean;
  anchorPoint?: { x: number; y: number };
  onClose: () => void;
  onAddSubtask: () => void;
  onCreateList: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveTask: (listId: string) => void;
  onMoveTaskRequest: (request: TaskMoveRequest) => void;
  onOpen: () => void;
  source: CoreViewModelSource;
  task: TaskViewModel;
}): JSX.Element {
  const [context, setContext] = useState<{ previousId: string | null; beforePreviousId: string | null; nextId: string | null } | null>(null);
  const [contextError, setContextError] = useState<string>();
  const parents = useTaskParentCandidates(task.listId, task.id);
  useEffect(() => {
    let active = true;
    void window.hcb!.tasks.context({ id: task.id }).then((result) => {
      if (!active) return;
      if (result.ok) setContext(result.data);
      else setContextError(result.error.message);
    }).catch(() => { if (active) setContextError("Task order could not be loaded."); });
    return () => { active = false; };
  }, [task.id]);

  function moveWithinList(previousSiblingId: string | null): void {
    onMoveTaskRequest({
      id: task.id,
      listId: task.listId,
      parentId: task.parentId,
      previousSiblingId
    });
  }

  function promoteToRoot(): void {
    onMoveTaskRequest({
      id: task.id,
      listId: task.listId,
      parentId: null,
      previousSiblingId: task.parentId
    });
  }

  function makeSubtask(parentId: string): void {
    onMoveTaskRequest({
      id: task.id,
      listId: task.listId,
      parentId,
      previousSiblingId: null
    });
  }

  return (
    <FloatingMenu anchorPoint={anchorPoint} onClose={onClose} width={320}>
      {onSchedule ? <MenuButton onClick={onSchedule}><CalendarClock size={18} />Schedule on calendar</MenuButton> : null}
      {onToggleStar ? <MenuButton onClick={onToggleStar}><Star size={18} />{starred ? "Remove star" : "Star task"}</MenuButton> : null}
      <MenuButton onClick={onOpen}>
        <Target aria-hidden="true" size={18} />
        Set due date
      </MenuButton>
      <MenuButton disabled={Boolean(task.parentId)} onClick={onAddSubtask}>
        <CornerDownRight aria-hidden="true" size={18} />
        Add a subtask
      </MenuButton>
      {task.parentId ? (
        <MenuButton onClick={promoteToRoot}>
          <ChevronRight aria-hidden="true" size={18} />
          Promote to root
        </MenuButton>
      ) : null}
      <MenuButton onClick={onDuplicate}>
        <Copy aria-hidden="true" size={18} />
        Duplicate
      </MenuButton>
      <MenuButton onClick={onOpen}>
        <Paperclip aria-hidden="true" size={18} />
        Edit notes and links
      </MenuButton>
      <MenuButton onClick={onDelete}>
        <Trash2 aria-hidden="true" size={18} />
        Delete
      </MenuButton>
      <MenuSeparator />
      <MenuButton disabled={!context?.previousId} onClick={() => moveWithinList(context?.beforePreviousId ?? null)}>
        <ChevronDown aria-hidden="true" className="rotate-180" size={18} />
        Move up
      </MenuButton>
      <MenuButton disabled={!context?.nextId} onClick={() => moveWithinList(context?.nextId ?? null)}>
        <ChevronDown aria-hidden="true" size={18} />
        Move down
      </MenuButton>
      <MenuSeparator />
      {contextError ? <p role="alert" className="px-4 text-sm text-danger">{contextError}</p> : null}
      {task.parentId ? <MenuButton disabled><CornerDownRight aria-hidden size={18} />Subtasks cannot have children</MenuButton> : (
        <div className="grid gap-1 px-2 py-1">
          <Input aria-label="Find a parent task" placeholder="Find a parent task…" value={parents.query} onChange={(event) => parents.setQuery(event.target.value)} />
          <div className="max-h-48 overflow-y-auto">
            {parents.items.map((parent) => <MenuButton key={parent.id} onClick={() => makeSubtask(parent.id)}><CornerDownRight aria-hidden size={18} />Make subtask of {parent.title}</MenuButton>)}
          </div>
          <p role={parents.error ? "alert" : undefined} className="px-2 text-xs text-text-muted">{parents.error ?? (parents.loading ? "Loading parent tasks…" : parents.items.length ? "Up to 30 matches. Type to narrow the list." : "No matching parent tasks")}</p>
        </div>
      )}
      <MenuSeparator />
      {source.taskLists.map((list) => (
        <MenuButton
          disabled={list.id === task.listId}
          key={list.id}
          onClick={() => onMoveTask(list.id)}
        >
          <span className="w-5">{list.id === task.listId ? <Check aria-hidden="true" size={16} /> : null}</span>
          {list.title}
        </MenuButton>
      ))}
      <MenuButton onClick={onCreateList}>
        <ListPlus aria-hidden="true" size={18} />
        New list
      </MenuButton>
    </FloatingMenu>
  );
}

function MenuButton({
  children,
  disabled,
  onClick
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}): JSX.Element {
  return (
    <button
      className="flex min-h-9 w-full items-center gap-3 px-4 text-left text-[var(--text-base)] text-text-primary transition-colors duration-fast ease-hcb hover:bg-surface-0 disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function MenuSeparator(): JSX.Element {
  return <div className="my-2 h-px bg-border" />;
}
