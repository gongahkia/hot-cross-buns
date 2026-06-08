import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import {
  CalendarClock,
  Clock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownRight,
  ListPlus,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  Star,
  Target,
  Trash2
} from "lucide-react";
import type { TaskListSummary } from "@shared/ipc/contracts";
import { FloatingMenu } from "../../../../components/FloatingMenu";
import { Badge, Button, IconButton, cx } from "../../../../components/primitives";
import { EmptyState } from "../../../../components/states";
import type { CoreViewModelSource } from "../../coreViewModelSource";
import type { ScheduledTaskBlockViewModel, TaskViewModel } from "../../coreViewModels";
import {
  TaskCompletionButton,
  taskScheduleLabel,
  taskScheduleTone
} from "../../coreScreenShared";
import { useAutoCollapsedSidebar } from "../useAutoCollapsedSidebar";

export interface TaskBoardSelection {
  mode: "lists" | "starred";
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
  onOpenTask: (taskId: string) => void;
  onRenameList: (list: TaskListSummary) => void;
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
  date: "Date",
  deadline: "Deadline",
  starred: "Starred recently",
  title: "Title"
};
const taskDragType = "application/x-hcb-task-id";

function activeRootTasks(source: CoreViewModelSource): TaskViewModel[] {
  return source.largeTaskWindow.filter(
    (task) => task.parentId === null && task.status === "open" && task.dueDate !== null
  );
}

function visibleListTasks(source: CoreViewModelSource, listId: string): TaskViewModel[] {
  return activeRootTasks(source).filter((task) => task.listId === listId);
}

function completedRootTasks(source: CoreViewModelSource): TaskViewModel[] {
  return source.largeTaskWindow.filter(
    (task) => task.parentId === null && task.status === "completed"
  );
}

function completedListTasks(source: CoreViewModelSource, listId: string): TaskViewModel[] {
  return completedRootTasks(source).filter((task) => task.listId === listId);
}

function sortTasks(
  tasks: TaskViewModel[],
  sort: TaskListSort,
  starred: StarredState
): TaskViewModel[] {
  return [...tasks].sort((left, right) => {
    if (sort === "title") {
      return left.title.localeCompare(right.title);
    }

    if (sort === "deadline") {
      return (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31");
    }

    if (sort === "date") {
      return (Date.parse(right.updatedAt ?? "") || 0) - (Date.parse(left.updatedAt ?? "") || 0);
    }

    if (sort === "starred") {
      return (starred.starredAt[right.id] ?? 0) - (starred.starredAt[left.id] ?? 0);
    }

    return 0;
  });
}

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
  return Number.isNaN(date.getTime()) ? "Snoozed" : `Snoozed ${date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  })}`;
}

export function GoogleTasksBoard({
  listSorts,
  onCreateList,
  onCreateTask,
  onDeleteList,
  onDeleteTask,
  onDuplicateTask,
  onMoveTask,
  onOpenTask,
  onRenameList,
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
  const { autoCollapsed, containerRef } = useAutoCollapsedSidebar();
  const effectiveSidebarCollapsed = sidebarCollapsed || autoCollapsed;
  const starredVisibleCount = activeRootTasks(source).filter((task) => starred.ids.has(task.id)).length;
  const allListIds = source.taskLists.map((list) => list.id);
  const visibleListIds = selectedView.listIds ?? allListIds;
  const visibleListIdSet = new Set(visibleListIds);
  const columns = useMemo(() => {
    if (selectedView.mode === "starred") {
      return [
        {
          id: "starred",
          list: null,
          title: "Starred tasks",
          tasks: sortTasks(
            activeRootTasks(source).filter((task) => starred.ids.has(task.id)),
            "starred",
            starred
          ),
          completedTasks: []
        }
      ];
    }

    const lists = source.taskLists.filter((list) => visibleListIdSet.has(list.id));

    return lists.map((list) => ({
      id: list.id,
      list,
      title: list.title,
      tasks: sortTasks(
        visibleListTasks(source, list.id),
        listSorts[list.id] ?? "myOrder",
        starred
      ),
      completedTasks: sortTasks(completedListTasks(source, list.id), "date", starred)
    }));
  }, [listSorts, selectedView.mode, source, starred, visibleListIdSet]);

  return (
    <div
      className={cx(
        "grid min-h-0 flex-1 gap-3",
        effectiveSidebarCollapsed ? "grid-cols-[56px_minmax(0,1fr)]" : "grid-cols-[260px_minmax(0,1fr)]"
      )}
      ref={containerRef}
    >
      <TaskBoardSidebar
        collapsed={effectiveSidebarCollapsed}
        onCreateList={onCreateList}
        onCreateTask={() => onCreateTask()}
        onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
        selectedView={selectedView}
        setSelectedView={setSelectedView}
        source={source}
        starredCount={starredVisibleCount}
        visibleListIds={visibleListIds}
      />
      <div className="min-h-0 min-w-0 overflow-hidden rounded-hcbLg bg-bg-secondary">
        <div
          className="flex h-full min-h-[480px] min-w-0 gap-3 overflow-x-auto p-3"
          role="list"
          aria-label={selectedView.mode === "starred" ? "Starred task lists" : "Task lists"}
        >
          {columns.length > 0 ? (
            columns.map((column) => (
              <TaskListColumn
                key={column.id}
                list={column.list}
                listSort={column.list ? listSorts[column.list.id] ?? "myOrder" : "starred"}
                onCreateList={onCreateList}
                onCreateTask={onCreateTask}
                onDeleteList={onDeleteList}
                onDeleteTask={onDeleteTask}
                onDuplicateTask={onDuplicateTask}
                onMoveTask={onMoveTask}
                onOpenTask={onOpenTask}
                onRenameList={onRenameList}
                onSetListSort={onSetListSort}
                onToggleStar={onToggleStar}
                onToggleTask={onToggleTask}
                onAddSubtask={onAddSubtask}
                scheduledBlocksByTask={scheduledBlocksByTask}
                selectedTaskId={selectedTaskId}
                source={source}
                starred={starred}
                completedTasks={column.completedTasks}
                tasks={column.tasks}
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
  source,
  starredCount,
  visibleListIds
}: {
  collapsed: boolean;
  onCreateList: () => void;
  onCreateTask: () => void;
  onToggleCollapsed: () => void;
  selectedView: TaskBoardSelection;
  setSelectedView: (selection: TaskBoardSelection) => void;
  source: CoreViewModelSource;
  starredCount: number;
  visibleListIds: string[];
}): JSX.Element {
  const allListIds = source.taskLists.map((list) => list.id);
  const visibleListIdSet = new Set(visibleListIds);

  function selectAllLists(): void {
    setSelectedView({ mode: "lists", listIds: null });
  }

  function selectStarredTasks(): void {
    setSelectedView({ mode: "starred", listIds: selectedView.listIds });
  }

  function toggleList(listId: string): void {
    const nextSet = new Set(visibleListIds);

    if (nextSet.has(listId)) {
      nextSet.delete(listId);
    } else {
      nextSet.add(listId);
    }

    const nextListIds = allListIds.filter((id) => nextSet.has(id));
    setSelectedView({
      mode: "lists",
      listIds: nextListIds.length === allListIds.length ? null : nextListIds
    });
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
        <Button className="h-12 min-w-0 flex-1 justify-start rounded-hcbLg shadow-sm" onClick={onCreateTask} variant="primary">
          <Plus aria-hidden="true" size={18} />
          Create tasks
        </Button>
        <IconButton
          className="size-10 rounded-hcbMd"
          icon={PanelLeftClose}
          label="Collapse task sidebar"
          onClick={onToggleCollapsed}
          variant="ghost"
        />
      </div>
      <div className="mt-5 grid gap-1">
        <TaskSidebarButton
          count={activeRootTasks(source).length}
          icon="all"
          label="All tasks"
          onClick={selectAllLists}
          selected={selectedView.mode === "lists" && selectedView.listIds === null}
        />
        <TaskSidebarButton
          count={starredCount}
          icon="star"
          label="Starred"
          onClick={selectStarredTasks}
          selected={selectedView.mode === "starred"}
        />
      </div>
      <div className="mt-6">
        <div className="px-2 text-[var(--text-sm)] font-semibold text-text-primary">Lists</div>
        <div className="mt-2 grid gap-1">
          {source.taskLists.map((list) => (
            <TaskListCheckbox
              checked={visibleListIdSet.has(list.id)}
              count={visibleListTasks(source, list.id).length}
              key={list.id}
              label={list.title}
              onClick={() => toggleList(list.id)}
            />
          ))}
        </div>
      </div>
      <Button className="mt-5 justify-start" onClick={onCreateList} variant="ghost">
        <Plus aria-hidden="true" size={16} />
        Create new list
      </Button>
    </aside>
  );
}

function TaskSidebarButton({
  count,
  icon,
  label,
  onClick,
  selected
}: {
  count: number;
  icon: "all" | "star";
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
      {icon === "star" ? (
        <Star aria-hidden="true" className={selected ? "fill-current" : undefined} size={17} />
      ) : (
        <CheckCircle2 aria-hidden="true" size={17} />
      )}
      <span className="truncate text-[var(--text-base)] font-medium">{label}</span>
      <span className="text-[var(--text-xs)] text-text-muted">{count}</span>
    </button>
  );
}

function TaskListCheckbox({
  checked,
  count,
  label,
  onClick
}: {
  checked: boolean;
  count: number;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cx(
        "grid h-9 grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-hcbLg px-2 text-left transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        checked ? "text-text-primary" : "text-text-secondary hover:bg-surface-0 hover:text-text-primary"
      )}
      onClick={onClick}
      role="checkbox"
      type="button"
    >
      <span
        aria-hidden="true"
        className={cx(
          "flex size-4 items-center justify-center rounded-[4px] border",
          checked ? "border-accent bg-accent text-bg-primary" : "border-text-muted bg-transparent"
        )}
      >
        {checked ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      <span className="truncate text-[var(--text-base)] font-medium">{label}</span>
      <span className="text-[var(--text-xs)] text-text-muted">{count}</span>
    </button>
  );
}

function TaskListColumn({
  list,
  listSort,
  onCreateList,
  onCreateTask,
  onDeleteList,
  onDeleteTask,
  onDuplicateTask,
  onMoveTask,
  onOpenTask,
  onRenameList,
  onSetListSort,
  onToggleStar,
  onToggleTask,
  onAddSubtask,
  scheduledBlocksByTask,
  selectedTaskId,
  source,
  starred,
  completedTasks,
  tasks,
  title
}: {
  list: TaskListSummary | null;
  listSort: TaskListSort;
  onCreateList: () => void;
  onCreateTask: (listId?: string) => void;
  onDeleteList: (listId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onDuplicateTask: (taskId: string) => void;
  onMoveTask: (taskId: string, listId: string) => void;
  onOpenTask: (taskId: string) => void;
  onRenameList: (list: TaskListSummary) => void;
  onSetListSort: (listId: string, sort: TaskListSort) => void;
  onToggleStar: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  onAddSubtask: (task: TaskViewModel) => void;
  scheduledBlocksByTask: Map<string, ScheduledTaskBlockViewModel>;
  selectedTaskId: string | null;
  source: CoreViewModelSource;
  starred: StarredState;
  completedTasks: TaskViewModel[];
  tasks: TaskViewModel[];
  title: string;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);
  const hasRows = tasks.length > 0 || completedTasks.length > 0;

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
      className={cx(
        "flex max-h-full w-[min(420px,calc(100vw-2rem))] shrink-0 flex-col overflow-hidden rounded-hcbLg border border-border bg-bg-primary",
        dropActive && "ring-2 ring-info"
      )}
      onDragLeave={() => setDropActive(false)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role="listitem"
    >
      <div className="relative flex items-center gap-2 px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate text-[var(--text-xl)] font-medium text-text-primary">{title}</h2>
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
        {list ? "Add a task" : "Add a starred task"}
      </button>
      <div
        className="min-h-0 flex-1 overflow-y-auto pb-3"
        role="list"
        aria-label={`${title} tasks`}
      >
        {tasks.length > 0 ? (
          tasks.map((task) => (
            <GoogleTaskRow
              key={task.id}
              onCreateList={onCreateList}
              onDeleteTask={onDeleteTask}
              onDuplicateTask={onDuplicateTask}
              onMoveTask={onMoveTask}
              onOpenTask={onOpenTask}
              onToggleStar={onToggleStar}
              onToggleTask={onToggleTask}
              onAddSubtask={onAddSubtask}
              scheduledBlock={scheduledBlocksByTask.get(task.id)}
              selected={selectedTaskId === task.id}
              source={source}
              starred={starred.ids.has(task.id)}
              task={task}
            />
          ))
        ) : null}
        {completedTasks.length > 0 ? (
          <div className="border-t border-border/70 pt-2">
            <button
              aria-expanded={completedOpen}
              className="mb-1 flex h-9 w-full items-center gap-2 px-4 text-left text-[var(--text-base)] font-medium text-text-secondary hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={() => setCompletedOpen((open) => !open)}
              type="button"
            >
              {completedOpen ? (
                <ChevronDown aria-hidden="true" size={17} />
              ) : (
                <ChevronRight aria-hidden="true" size={17} />
              )}
              Completed ({completedTasks.length})
            </button>
            {completedOpen
              ? completedTasks.map((task) => (
                  <GoogleTaskRow
                    key={task.id}
                    onCreateList={onCreateList}
                    onDeleteTask={onDeleteTask}
                    onDuplicateTask={onDuplicateTask}
                    onMoveTask={onMoveTask}
                    onOpenTask={onOpenTask}
                    onToggleStar={onToggleStar}
                    onToggleTask={onToggleTask}
                    onAddSubtask={onAddSubtask}
                    scheduledBlock={scheduledBlocksByTask.get(task.id)}
                    selected={selectedTaskId === task.id}
                    source={source}
                    starred={starred.ids.has(task.id)}
                    task={task}
                  />
                ))
              : null}
          </div>
        ) : null}
        {!hasRows ? (
          <div className="grid min-h-[320px] place-items-center px-6">
            <EmptyState
              description={list ? "Add a task to keep this list moving." : "Star tasks from any list to collect them here."}
              title={list ? "No tasks yet" : "No starred tasks"}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ListActionMenu({
  list,
  onClose,
  onDeleteList,
  onRenameList,
  onSetListSort,
  selectedSort
}: {
  list: TaskListSummary;
  onClose: () => void;
  onDeleteList: (listId: string) => void;
  onRenameList: (list: TaskListSummary) => void;
  onSetListSort: (listId: string, sort: TaskListSort) => void;
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
      <MenuButton disabled>Move list to first position</MenuButton>
      <MenuSeparator />
      <MenuButton onClick={() => { window.print(); onClose(); }}>Print list</MenuButton>
      <MenuButton disabled>Delete all completed tasks</MenuButton>
      <MenuButton disabled>Clean up old tasks</MenuButton>
    </div>
  );
}

function GoogleTaskRow({
  onCreateList,
  onDeleteTask,
  onDuplicateTask,
  onMoveTask,
  onOpenTask,
  onToggleStar,
  onToggleTask,
  onAddSubtask,
  scheduledBlock,
  selected,
  source,
  starred,
  task
}: {
  onCreateList: () => void;
  onDeleteTask: (taskId: string) => void;
  onDuplicateTask: (taskId: string) => void;
  onMoveTask: (taskId: string, listId: string) => void;
  onOpenTask: (taskId: string) => void;
  onToggleStar: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  onAddSubtask: (task: TaskViewModel) => void;
  scheduledBlock?: ScheduledTaskBlockViewModel;
  selected: boolean;
  source: CoreViewModelSource;
  starred: boolean;
  task: TaskViewModel;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null);
  const scheduleLabel = taskScheduleLabel(task, scheduledBlock);
  const preview = taskPreview(task);
  const completed = task.status === "completed";
  const futureSnoozed = isFutureSnoozed(task);

  return (
    <div
      className={cx(
        "group relative grid grid-cols-[32px_minmax(0,1fr)_auto] gap-2 px-4 py-2 transition-colors duration-fast ease-hcb",
        selected ? "bg-surface-0" : "hover:bg-surface-0",
        futureSnoozed && "opacity-65"
      )}
      draggable
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuPoint({ x: event.clientX, y: event.clientY });
        setMenuOpen(true);
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(taskDragType, task.id);
      }}
      role="listitem"
    >
      <TaskCompletionButton completed={completed} onToggle={onToggleTask} task={task} />
      <button
        className="min-w-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={() => onOpenTask(task.id)}
        type="button"
      >
        <div className={cx(
          "line-clamp-2 text-[var(--text-md)] font-medium",
          completed ? "text-text-muted line-through" : "text-text-primary"
        )}>{task.title}</div>
        {preview ? (
          <p className={cx(
            "mt-0.5 line-clamp-2 text-[var(--text-sm)]",
            completed ? "text-text-muted line-through" : "text-text-secondary"
          )}>{preview}</p>
        ) : null}
        {scheduleLabel || task.dueDate || task.snoozeUntil ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
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
      </button>
      <div
        className="relative flex items-start gap-1 opacity-0 transition-opacity duration-fast ease-hcb group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <IconButton
          className={cx("size-9 rounded-full [&_svg]:size-5", starred ? "text-accent [&_svg]:fill-current" : undefined)}
          icon={Star}
          label={starred ? `Unstar ${task.title}` : `Star ${task.title}`}
          onClick={() => onToggleStar(task.id)}
          variant="ghost"
        />
        {menuOpen ? (
          <TaskActionMenu
            anchorPoint={menuPoint ?? undefined}
            onClose={() => setMenuOpen(false)}
            onAddSubtask={() => { onAddSubtask(task); setMenuOpen(false); }}
            onCreateList={() => { onCreateList(); setMenuOpen(false); }}
            onDelete={() => { onDeleteTask(task.id); setMenuOpen(false); }}
            onDuplicate={() => { onDuplicateTask(task.id); setMenuOpen(false); }}
            onMoveTask={(listId) => { onMoveTask(task.id, listId); setMenuOpen(false); }}
            onOpen={() => { onOpenTask(task.id); setMenuOpen(false); }}
            source={source}
            task={task}
          />
        ) : null}
      </div>
    </div>
  );
}

function TaskActionMenu({
  anchorPoint,
  onClose,
  onAddSubtask,
  onCreateList,
  onDelete,
  onDuplicate,
  onMoveTask,
  onOpen,
  source,
  task
}: {
  anchorPoint?: { x: number; y: number };
  onClose: () => void;
  onAddSubtask: () => void;
  onCreateList: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveTask: (listId: string) => void;
  onOpen: () => void;
  source: CoreViewModelSource;
  task: TaskViewModel;
}): JSX.Element {
  return (
    <FloatingMenu anchorPoint={anchorPoint} onClose={onClose} width={320}>
      <MenuButton onClick={onOpen}>
        <Target aria-hidden="true" size={18} />
        Add deadline
      </MenuButton>
      <MenuButton onClick={onAddSubtask}>
        <CornerDownRight aria-hidden="true" size={18} />
        Add a subtask
      </MenuButton>
      <MenuButton onClick={onDuplicate}>
        <Copy aria-hidden="true" size={18} />
        Duplicate
      </MenuButton>
      <MenuButton disabled>
        <Paperclip aria-hidden="true" size={18} />
        Add attachment
      </MenuButton>
      <MenuButton onClick={onDelete}>
        <Trash2 aria-hidden="true" size={18} />
        Delete
      </MenuButton>
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
