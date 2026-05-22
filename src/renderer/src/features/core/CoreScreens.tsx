import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  CalendarEventCreateRequest,
  CalendarEventUpdateRequest,
  SettingsRecoveryActionRequest,
  SettingsSnapshot,
  SettingsUpdateRequest,
  TaskCreateRequest,
  TaskUpdateRequest
} from "@shared/ipc/contracts";
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  Copy,
  ListPlus,
  Pencil,
  Filter,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Trash2,
  X
} from "lucide-react";
import { Badge, Button, IconButton, Input, ListRow, Panel, StatusBanner, cx } from "../../components/primitives";
import { EmptyState, ErrorState, LoadingState, OfflineState } from "../../components/states";
import { VirtualizedList } from "../../components/VirtualizedList";
import type { SectionId } from "../../data/mockPlanner";
import {
  rendererNow,
  reportRendererTimingSince
} from "../../hooks/useRenderTiming";
import { useCoreViewModelSource, useLocalSearch } from "./coreViewModelSource";
import type {
  CalendarEventViewModel,
  CalendarViewId,
  CorePriority,
  NoteViewModel,
  SearchSource,
  SettingsSectionId,
  TaskFilterId,
  TaskGroupViewModel,
  TaskViewModel
} from "./coreViewModels";

function priorityTone(priority: CorePriority): "neutral" | "accent" | "warning" | "danger" {
  if (priority === "high") {
    return "danger";
  }

  if (priority === "medium") {
    return "warning";
  }

  if (priority === "low") {
    return "accent";
  }

  return "neutral";
}

function priorityLabel(priority: CorePriority): string {
  if (priority === "none") {
    return "No priority";
  }

  return `${priority[0].toUpperCase()}${priority.slice(1)} priority`;
}

function sourceTone(source: SearchSource): "accent" | "success" | "info" {
  if (source === "task") {
    return "success";
  }

  if (source === "event") {
    return "accent";
  }

  return "info";
}

function settingTone(status: string): "neutral" | "success" | "warning" | "info" {
  if (status === "Ready") {
    return "success";
  }

  if (status === "Conflict" || status === "Not requested" || status.includes("blocker")) {
    return "warning";
  }

  if (status === "Mock only" || status === "Enabled shell") {
    return "info";
  }

  return "neutral";
}

const guestEmailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function scheduleRendererFrame(callback: () => void): void {
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(callback);
    return;
  }

  window.setTimeout(callback, 0);
}

function normalizeGuestEmails(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values ?? []) {
    const email = value.trim().toLowerCase();

    if (!guestEmailPattern.test(email) || seen.has(email)) {
      continue;
    }

    seen.add(email);
    normalized.push(email);
  }

  return normalized;
}

function normalizeReminderMinutes(values: readonly number[] | undefined): number[] {
  const seen = new Set<number>();
  const normalized: number[] = [];

  for (const value of values ?? []) {
    if (!Number.isInteger(value) || value < 0 || value > 28 * 24 * 60 || seen.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);
  }

  return normalized.sort((left, right) => left - right);
}

function startOfUtcDayIso(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;

  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function addUtcDaysIso(value: string | Date, days: number): string {
  const date = typeof value === "string" ? new Date(value) : new Date(value.getTime());

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function dateInputValue(value: string): string {
  const parsed = new Date(value);

  if (!Number.isFinite(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
}

function dateInputToIso(value: string): string {
  return `${value}T00:00:00.000Z`;
}

function dateTimeLocalInputValue(value: string): string {
  const parsed = new Date(value);

  if (!Number.isFinite(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 16);
}

function dateTimeLocalInputToIso(value: string): string {
  const parsed = new Date(`${value}:00.000Z`);

  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function MetricTile({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0 rounded-hcbMd border border-border bg-bg-secondary px-3 py-2">
      <div className="truncate text-[var(--text-xs)] text-text-muted">{label}</div>
      <div className="mt-1 truncate text-[var(--text-lg)] font-semibold text-text-primary">{value}</div>
    </div>
  );
}

function CacheStatePanel({ title }: { title: string }): JSX.Element | null {
  const source = useCoreViewModelSource();

  if (source.dataState === "loading") {
    return (
      <Panel title={title} description="Local cache">
        <LoadingState description="Reading cached planner data from SQLite." />
      </Panel>
    );
  }

  if (source.dataState === "error" && !source.hasCachedData) {
    return (
      <Panel title={title} description="Local cache">
        <ErrorState description={source.errorMessage ?? "The local cache request failed."} />
      </Panel>
    );
  }

  if (source.dataState === "offline" && !source.hasCachedData) {
    return (
      <Panel title={title} description="Local cache">
        <OfflineState description="The preload bridge is unavailable in this renderer context." />
      </Panel>
    );
  }

  if (source.dataState === "empty" && !source.hasCachedData) {
    return (
      <Panel title={title} description="Local cache">
        <EmptyState
          description="No cached tasks, events, or notes are stored in SQLite yet."
          title="Nothing cached yet"
        />
      </Panel>
    );
  }

  return null;
}

function SectionChrome({
  children,
  sidebar,
  title
}: {
  children: ReactNode;
  sidebar?: ReactNode;
  title: string;
}): JSX.Element {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px] gap-3">
      <div className="min-w-0">{children}</div>
      <aside aria-label={`${title} support`} className="min-w-0">
        {sidebar}
      </aside>
    </div>
  );
}

function TaskCompletionButton({
  completed,
  onToggle,
  task
}: {
  completed: boolean;
  onToggle: (taskId: string) => void;
  task: TaskViewModel;
}): JSX.Element {
  return (
    <button
      aria-label={completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
      aria-pressed={completed}
      className={cx(
        "flex size-7 shrink-0 items-center justify-center rounded-hcbMd border transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        completed
          ? "border-success bg-bg-secondary text-success"
          : "border-border bg-surface-0 text-text-muted hover:border-accent hover:text-accent"
      )}
      onClick={() => onToggle(task.id)}
      type="button"
    >
      {completed ? <CheckCircle2 aria-hidden="true" size={17} /> : <Circle aria-hidden="true" size={17} />}
    </button>
  );
}

function TaskRow({
  completed,
  onDelete,
  onSelect,
  onToggle,
  selected,
  task
}: {
  completed: boolean;
  onDelete: (taskId: string) => void;
  onSelect: (taskId: string) => void;
  onToggle: (taskId: string) => void;
  selected: boolean;
  task: TaskViewModel;
}): JSX.Element {
  return (
    <div
      className={cx(
        "min-h-[76px] border-b border-border px-3 py-2 last:border-b-0",
        selected ? "bg-surface-0" : "bg-transparent"
      )}
      role="listitem"
    >
      <div className="flex min-w-0 items-start gap-3">
        <TaskCompletionButton completed={completed} onToggle={onToggle} task={task} />
        <button
          className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={() => onSelect(task.id)}
          type="button"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cx(
                "truncate text-[var(--text-md)] font-medium text-text-primary",
                completed && "text-text-muted line-through"
              )}
            >
              {task.title}
            </span>
            <span className="shrink-0 text-[var(--text-xs)] text-text-muted">{task.dueLabel}</span>
            {task.mutationState && task.mutationState !== "synced" ? (
              <Badge tone={task.mutationState === "failed" ? "danger" : "warning"}>
                {task.mutationState === "failed" ? "Failed" : "Queued"}
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-[var(--text-sm)] text-text-muted">{task.detail}</p>
          {task.subtasks.length > 0 ? (
            <div
              aria-label={`Subtasks for ${task.title}`}
              className="mt-2 flex flex-wrap gap-1"
            >
              {task.subtasks.map((subtask) => (
                <span
                  className="inline-flex max-w-full items-center gap-1 rounded-hcbSm border border-border bg-bg-tertiary px-2 py-0.5 text-[var(--text-xs)] text-text-secondary"
                  key={subtask.id}
                >
                  {subtask.completed ? (
                    <CheckCircle2 aria-hidden="true" className="text-success" size={12} />
                  ) : (
                    <Circle aria-hidden="true" className="text-text-muted" size={12} />
                  )}
                  <span className="truncate">{subtask.title}</span>
                </span>
              ))}
            </div>
          ) : null}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={priorityTone(task.priority)}>{priorityLabel(task.priority)}</Badge>
          <Badge>{task.list}</Badge>
          <IconButton
            icon={Trash2}
            label={`Delete ${task.title}`}
            onClick={() => onDelete(task.id)}
            variant="ghost"
          />
        </div>
      </div>
    </div>
  );
}

function TaskGroupPanel({
  group,
  onDeleteTask,
  onSelectTask,
  onToggleTask,
  selectedTaskId
}: {
  group: TaskGroupViewModel;
  onDeleteTask: (taskId: string) => void;
  onSelectTask: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  selectedTaskId: string | null;
}): JSX.Element {
  return (
    <Panel
      description={group.description}
      title={group.title}
      action={<Badge tone="neutral">{group.countLabel}</Badge>}
    >
      <VirtualizedList
        ariaLabel={`${group.title} tasks`}
        estimateRowHeight={88}
        getKey={(task) => task.id}
        items={group.tasks}
        performanceLabel={`tasks.${group.id}`}
        renderRow={(task) => (
          <TaskRow
            completed={task.status === "completed"}
            onDelete={onDeleteTask}
            onSelect={onSelectTask}
            onToggle={onToggleTask}
            selected={task.id === selectedTaskId}
            task={task}
          />
        )}
        viewportHeight={Math.min(250, Math.max(106, group.tasks.length * 88))}
      />
    </Panel>
  );
}

function EventRow({
  event,
  onOpen
}: {
  event: CalendarEventViewModel;
  onOpen?: (event: CalendarEventViewModel) => void;
}): JSX.Element {
  const content = (
    <>
      <span className="flex h-7 w-16 shrink-0 items-center justify-center rounded-hcbSm border border-border bg-surface-0 font-mono text-[var(--text-xs)] text-text-secondary">
        {event.timeLabel}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[var(--text-md)] font-medium text-text-primary">{event.title}</span>
          <span className="shrink-0 text-[var(--text-xs)] text-text-muted">{event.rangeLabel}</span>
        </span>
        <span className="block truncate text-[var(--text-sm)] text-text-muted">
          {event.calendar} - {event.location} - {event.notes}
        </span>
      </span>
      <Badge tone="accent">Event</Badge>
    </>
  );

  if (onOpen) {
    return (
      <button
        className="flex min-h-11 w-full items-center gap-3 border-b border-border bg-transparent px-3 py-2 text-left last:border-b-0 transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={() => onOpen(event)}
        role="listitem"
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className="flex min-h-11 w-full items-center gap-3 border-b border-border bg-transparent px-3 py-2 last:border-b-0"
      role="listitem"
    >
      {content}
    </div>
  );
}

function TodayTimelineRow({
  row
}: {
  row:
    | { kind: "task"; task: TaskViewModel }
    | { kind: "event"; event: CalendarEventViewModel };
}): JSX.Element {
  if (row.kind === "event") {
    return <EventRow event={row.event} />;
  }

  return (
    <ListRow
      description={row.task.detail}
      leading={<Circle aria-hidden="true" className="text-text-muted" size={17} />}
      meta={row.task.dueLabel}
      title={row.task.title}
      trailing={<Badge tone={priorityTone(row.task.priority)}>{priorityLabel(row.task.priority)}</Badge>}
    />
  );
}

function TodayView(): JSX.Element {
  const source = useCoreViewModelSource();
  const timelineRows = useMemo(
    () =>
      source.todayViewModel.timelineRows.map((row) =>
        row.kind === "event"
          ? { kind: "event" as const, event: source.calendarEventsById[row.itemId] }
          : { kind: "task" as const, task: source.getTaskById(row.itemId) }
      ),
    [source]
  );

  if (
    (source.dataState === "loading" ||
      source.dataState === "empty" ||
      source.dataState === "offline" ||
      source.dataState === "error") &&
    !source.hasCachedData
  ) {
    return <CacheStatePanel title="Today" />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid grid-cols-4 gap-3">
        {source.todayViewModel.metrics.map((metric) => (
          <MetricTile key={metric.id} label={metric.label} value={metric.value} />
        ))}
      </div>

      <SectionChrome
        title="Today"
        sidebar={
          <Panel title="Focus queue" description="Open tasks from the precomputed Today model">
            <VirtualizedList
              ariaLabel="Today focus queue"
              estimateRowHeight={58}
              getKey={(task) => task.id}
              items={source.todayViewModel.focusTasks}
              performanceLabel="today.focus-tasks"
              renderRow={(task) => (
                <ListRow
                  description={task.detail}
                  leading={<Circle aria-hidden="true" className="text-text-muted" size={17} />}
                  meta={task.dueLabel}
                  title={task.title}
                  trailing={<Badge tone={priorityTone(task.priority)}>{priorityLabel(task.priority)}</Badge>}
                />
              )}
              viewportHeight={306}
            />
          </Panel>
        }
      >
        <Panel title="Timeline" description="Tasks and calendar agenda from the local cache">
          <VirtualizedList
            ariaLabel="Today timeline"
            estimateRowHeight={58}
            getKey={(row, index) => `${row.kind}-${index}`}
            items={timelineRows}
            performanceLabel="today.timeline"
            renderRow={(row) => <TodayTimelineRow row={row} />}
            viewportHeight={306}
          />
        </Panel>
      </SectionChrome>
    </div>
  );
}

export interface TaskSurfaceCommand {
  id: "new-task" | "quick-capture";
  nonce: number;
}

interface TaskDraft {
  mode: "create" | "edit";
  id?: string;
  title: string;
  notes: string;
  dueDate: string;
  listId: string;
  parentId: string;
  priority: CorePriority;
}

interface QuickTaskParseResult {
  title: string;
  dueDate: string;
  listId: string;
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

function parseQuickTaskInput(
  input: string,
  taskLists: readonly { id: string; title: string }[],
  now = new Date()
): QuickTaskParseResult {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  let dueDate = "";
  let listId = taskLists[0]?.id ?? "";
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

  return {
    title: titleTokens.join(" ").trim(),
    dueDate,
    listId
  };
}

function TasksView({ command }: { command?: TaskSurfaceCommand | null }): JSX.Element {
  const source = useCoreViewModelSource();
  const [activeFilterId, setActiveFilterId] = useState<TaskFilterId>("open");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(() => newTaskDraft(source));
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [quickCaptureInput, setQuickCaptureInput] = useState("");
  const [newListTitle, setNewListTitle] = useState("");
  const [listTitleDrafts, setListTitleDrafts] = useState<Record<string, string>>({});
  const handledCommandNonce = useRef<number | null>(null);
  const quickCaptureOpenStartedAt = useRef<number | null>(null);
  const activeFilter = source.getTaskFilterViewModel(activeFilterId);
  const selectedTask = selectedTaskId ? source.getTaskById(selectedTaskId) : null;
  const parentOptions = source.largeTaskWindow.filter(
    (task) => task.id !== draft.id && task.parentId === null && task.status !== "deleted"
  );
  const parsedQuickTask = parseQuickTaskInput(quickCaptureInput, source.taskLists);
  const canSaveTask = draft.title.trim().length > 0 && draft.listId.length > 0 && !source.taskMutationPending;
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
    setActiveFilterId("open");

    if (command.id === "quick-capture") {
      quickCaptureOpenStartedAt.current = rendererNow();
      setQuickCaptureOpen(true);
      return;
    }

    setSelectedTaskId(null);
    setDraft(newTaskDraft(source));
    setQuickCaptureOpen(false);
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

  if (
    (source.dataState === "loading" ||
      source.dataState === "offline" ||
      source.dataState === "error") &&
    !source.hasCachedData
  ) {
    return <CacheStatePanel title="Tasks" />;
  }

  function openNewTask(): void {
    setSelectedTaskId(null);
    setDraft(newTaskDraft(source));
    setActiveFilterId("open");
  }

  function selectTask(taskId: string): void {
    const task = source.getTaskById(taskId);
    setSelectedTaskId(taskId);
    setDraft(editTaskDraft(task));
  }

  async function saveTask(): Promise<void> {
    if (!canSaveTask) {
      return;
    }

    const saved = draft.mode === "edit"
      ? await source.updateTask(taskUpdatePayload(draft))
      : await source.createTask(taskCreatePayload(draft));

    if (saved) {
      setSelectedTaskId(null);
      setDraft(newTaskDraft(source, { listId: draft.listId }));
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
      setSelectedTaskId(null);
      setDraft(newTaskDraft(source));
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
      priority: "none"
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

    setDraft(
      newTaskDraft(source, {
        listId: selectedTask.listId,
        parentId: selectedTask.id
      })
    );
  }

  function deleteTaskList(taskListId: string): void {
    void source.deleteTaskList(taskListId);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2" role="toolbar" aria-label="Task actions">
          <Button onClick={openNewTask} variant="primary">
            <Plus aria-hidden="true" size={15} />
            New task
          </Button>
          <Button onClick={toggleQuickCapture} variant="secondary">
            <ListPlus aria-hidden="true" size={15} />
            Quick capture
          </Button>
          <Button
            disabled={!selectedTask}
            onClick={() => selectedTask ? void toggleTask(selectedTask.id) : undefined}
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
            disabled={!selectedTask}
            onClick={() => selectedTask ? void deleteTask(selectedTask.id) : undefined}
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

      <SectionChrome
        title="Tasks"
        sidebar={
          <div className="grid gap-3">
            <Panel
              action={
                <div className="flex items-center gap-2">
                  {draft.mode === "edit" ? (
                    <IconButton
                      icon={Trash2}
                      label="Delete selected task"
                      onClick={() => draft.id ? void deleteTask(draft.id) : undefined}
                      variant="danger"
                    />
                  ) : null}
                  <Button disabled={!canSaveTask} onClick={() => void saveTask()} size="sm" variant="primary">
                    <Save aria-hidden="true" size={14} />
                    Save
                  </Button>
                </div>
              }
              title={draft.mode === "edit" ? "Edit task" : "New task"}
              description="Task details"
            >
              <div className="grid gap-3 p-3">
                <Input
                  aria-label="Task title"
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  placeholder="Task title"
                  value={draft.title}
                />
                <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
                  <span>List</span>
                  <select
                    aria-label="Task list"
                    className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    disabled={source.taskLists.length === 0}
                    onChange={(event) => setDraft({ ...draft, listId: event.target.value })}
                    value={draft.listId}
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
                    onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
                    type="date"
                    value={draft.dueDate}
                  />
                  <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
                    <span>Priority</span>
                    <select
                      aria-label="Task priority"
                      className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      onChange={(event) =>
                        setDraft({ ...draft, priority: event.target.value as CorePriority })
                      }
                      value={draft.priority}
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
                    onChange={(event) => setDraft({ ...draft, parentId: event.target.value })}
                    value={draft.parentId}
                  >
                    <option value="">No parent</option>
                    {parentOptions.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}
                      </option>
                    ))}
                  </select>
                </label>
                <textarea
                  aria-label="Task notes"
                  className="min-h-20 w-full resize-none rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-base)] text-text-primary placeholder:text-text-muted transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                  placeholder="Notes"
                  value={draft.notes}
                />
                <div className="flex items-center gap-2">
                  <Button disabled={!selectedTask} onClick={addSubtaskDraft} size="sm" variant="secondary">
                    <ListPlus aria-hidden="true" size={14} />
                    Add subtask
                  </Button>
                  <Button onClick={openNewTask} size="sm" variant="ghost">
                    Cancel
                  </Button>
                </div>
              </div>
            </Panel>
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
            {source.dataState === "stale" ? (
              <Panel title="Refresh state" description="Cached rows remain visible">
                <LoadingState description="Refreshing local cache." title="Refreshing" />
              </Panel>
            ) : null}
          </div>
        }
      >
        {activeFilter.state === "empty" ? (
          <Panel title="Task list" description="Empty filtered state">
            <EmptyState
              description="No cached tasks match this filter."
              title="No tasks in this filter"
            />
          </Panel>
        ) : activeFilter.state === "error" ? (
          <Panel title="Task list" description="Recoverable renderer error state">
            <ErrorState />
          </Panel>
        ) : (
          <div className="grid gap-3">
            {activeFilter.groups.map((group) => (
              <TaskGroupPanel
                group={group}
                key={group.id}
                onDeleteTask={(taskId) => void deleteTask(taskId)}
                onSelectTask={selectTask}
                onToggleTask={(taskId) => void toggleTask(taskId)}
                selectedTaskId={selectedTaskId}
              />
            ))}
          </div>
        )}
      </SectionChrome>
    </div>
  );
}

interface CalendarEventDraft {
  mode: "create" | "edit";
  id?: string;
  title: string;
  calendarId: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string;
  notes: string;
  guests: string;
  reminderMinutes: string;
}

function defaultCalendarId(source: ReturnType<typeof useCoreViewModelSource>): string {
  return (
    source.calendarSources.find((calendar) => calendar.selected)?.id ??
    source.calendarSources[0]?.id ??
    ""
  );
}

function defaultTimedStart(seed?: string): string {
  const base = seed ? new Date(seed) : new Date();

  if (!Number.isFinite(base.getTime())) {
    return new Date().toISOString();
  }

  base.setUTCMinutes(0, 0, 0);
  return base.toISOString();
}

function newCalendarDraft(
  source: ReturnType<typeof useCoreViewModelSource>,
  seed?: { startsAt?: string; allDay?: boolean }
): CalendarEventDraft {
  const allDay = seed?.allDay ?? false;
  const startsAt = allDay ? startOfUtcDayIso(seed?.startsAt ?? new Date().toISOString()) : defaultTimedStart(seed?.startsAt);
  const endsAt = allDay ? addUtcDaysIso(startsAt, 1) : addUtcDaysIso(startsAt, 0);
  const timedEnd = allDay ? endsAt : new Date(Date.parse(startsAt) + 60 * 60 * 1000).toISOString();

  return {
    mode: "create",
    title: "",
    calendarId: defaultCalendarId(source),
    startsAt,
    endsAt: allDay ? endsAt : timedEnd,
    allDay,
    location: "",
    notes: "",
    guests: "",
    reminderMinutes: ""
  };
}

function editCalendarDraft(event: CalendarEventViewModel): CalendarEventDraft {
  return {
    mode: "edit",
    id: event.id,
    title: event.title,
    calendarId: event.calendarId,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    location: event.location === "Scheduled" || event.location === "All day" ? "" : event.location,
    notes: event.notes === "Calendar cache" ? "" : event.notes,
    guests: event.guestEmails.join(", "),
    reminderMinutes: event.reminderMinutes[0] === undefined ? "" : String(event.reminderMinutes[0])
  };
}

function calendarEventPayload(draft: CalendarEventDraft): CalendarEventCreateRequest {
  const reminderMinutes = draft.reminderMinutes === "" ? [] : normalizeReminderMinutes([Number(draft.reminderMinutes)]);

  return {
    title: draft.title.trim(),
    calendarId: draft.calendarId,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    allDay: draft.allDay,
    location: draft.location,
    notes: draft.notes,
    guestEmails: normalizeGuestEmails(draft.guests.split(",")),
    reminderMinutes
  };
}

function allDayEndInputValue(endsAt: string): string {
  const end = new Date(endsAt);
  end.setUTCDate(end.getUTCDate() - 1);
  return dateInputValue(end.toISOString());
}

function CalendarEventForm({
  calendars,
  draft,
  error,
  onCancel,
  onDelete,
  onSave,
  setDraft
}: {
  calendars: ReturnType<typeof useCoreViewModelSource>["calendarSources"];
  draft: CalendarEventDraft;
  error?: string;
  onCancel: () => void;
  onDelete: () => void;
  onSave: () => void;
  setDraft: (draft: CalendarEventDraft) => void;
}): JSX.Element {
  function setAllDay(allDay: boolean): void {
    if (allDay) {
      const startsAt = startOfUtcDayIso(draft.startsAt);
      setDraft({
        ...draft,
        allDay,
        startsAt,
        endsAt: addUtcDaysIso(startsAt, 1)
      });
      return;
    }

    const startsAt = `${dateInputValue(draft.startsAt)}T09:00:00.000Z`;
    setDraft({
      ...draft,
      allDay,
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + 60 * 60 * 1000).toISOString()
    });
  }

  function setAllDayStart(value: string): void {
    const startsAt = dateInputToIso(value);
    const currentEnd = Date.parse(draft.endsAt);
    const minimumEnd = Date.parse(addUtcDaysIso(startsAt, 1));
    setDraft({
      ...draft,
      startsAt,
      endsAt: currentEnd <= Date.parse(startsAt) ? new Date(minimumEnd).toISOString() : draft.endsAt
    });
  }

  function setAllDayEnd(value: string): void {
    setDraft({
      ...draft,
      endsAt: addUtcDaysIso(dateInputToIso(value), 1)
    });
  }

  return (
    <Panel
      action={
        <div className="flex items-center gap-2">
          {draft.mode === "edit" ? (
            <IconButton icon={Trash2} label="Delete event" onClick={onDelete} variant="danger" />
          ) : null}
          <Button onClick={onSave} size="sm" variant="primary">
            Save
          </Button>
        </div>
      }
      title={draft.mode === "edit" ? "Edit event" : "New event"}
      description="Google Calendar event"
    >
      <div className="grid gap-3 p-3">
        {error ? <ErrorState description={error} title="Event not saved" /> : null}
        <Input
          aria-label="Event title"
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          placeholder="Title"
          value={draft.title}
        />
        <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
          <span>Calendar</span>
          <select
            aria-label="Event calendar"
            className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onChange={(event) => setDraft({ ...draft, calendarId: event.target.value })}
            value={draft.calendarId}
          >
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-8 items-center gap-2 text-[var(--text-sm)] text-text-secondary">
          <input
            checked={draft.allDay}
            className="accent-[var(--color-accent)]"
            onChange={(event) => setAllDay(event.target.checked)}
            type="checkbox"
          />
          All day
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Input
            aria-label="Event starts"
            onChange={(event) =>
              draft.allDay
                ? setAllDayStart(event.target.value)
                : setDraft({ ...draft, startsAt: dateTimeLocalInputToIso(event.target.value) })
            }
            type={draft.allDay ? "date" : "datetime-local"}
            value={draft.allDay ? dateInputValue(draft.startsAt) : dateTimeLocalInputValue(draft.startsAt)}
          />
          <Input
            aria-label="Event ends"
            min={draft.allDay ? dateInputValue(draft.startsAt) : undefined}
            onChange={(event) =>
              draft.allDay
                ? setAllDayEnd(event.target.value)
                : setDraft({ ...draft, endsAt: dateTimeLocalInputToIso(event.target.value) })
            }
            type={draft.allDay ? "date" : "datetime-local"}
            value={draft.allDay ? allDayEndInputValue(draft.endsAt) : dateTimeLocalInputValue(draft.endsAt)}
          />
        </div>
        <Input
          aria-label="Event location"
          onChange={(event) => setDraft({ ...draft, location: event.target.value })}
          placeholder="Location"
          value={draft.location}
        />
        <Input
          aria-label="Event guests"
          onChange={(event) => setDraft({ ...draft, guests: event.target.value })}
          placeholder="guest@example.com, team@example.com"
          value={draft.guests}
        />
        <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
          <span>Reminder</span>
          <select
            aria-label="Event reminder"
            className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onChange={(event) => setDraft({ ...draft, reminderMinutes: event.target.value })}
            value={draft.reminderMinutes}
          >
            <option value="">None</option>
            <option value="0">At start</option>
            <option value="5">5 minutes before</option>
            <option value="10">10 minutes before</option>
            <option value="15">15 minutes before</option>
            <option value="30">30 minutes before</option>
            <option value="60">1 hour before</option>
            <option value="1440">1 day before</option>
          </select>
        </label>
        <textarea
          aria-label="Event notes"
          className="min-h-24 w-full resize-none rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-base)] text-text-primary placeholder:text-text-muted transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          placeholder="Notes"
          value={draft.notes}
        />
        <Button onClick={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
      </div>
    </Panel>
  );
}

function CalendarTabButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button
      aria-selected={active}
      onClick={onClick}
      role="tab"
      size="sm"
      variant={active ? "secondary" : "ghost"}
    >
      {children}
    </Button>
  );
}

function DayView({
  onCreate,
  onOpen
}: {
  onCreate: (seed?: { startsAt?: string; allDay?: boolean }) => void;
  onOpen: (event: CalendarEventViewModel) => void;
}): JSX.Element {
  const source = useCoreViewModelSource();

  return (
    <Panel
      action={
        <Button onClick={() => onCreate()} size="sm" variant="primary">
          <Plus aria-hidden="true" size={14} />
          New event
        </Button>
      }
      title="Day view"
      description={`${source.calendarDayView.weekday}, ${source.calendarDayView.dateLabel}`}
    >
      <div className="grid gap-2 p-3" role="grid" aria-label="Calendar day view">
        {source.calendarDayView.events.map((event) => (
          <button
            className="grid min-h-14 grid-cols-[74px_minmax(0,1fr)] gap-3 rounded-hcbMd border border-border bg-bg-tertiary p-2 text-left transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            key={event.id}
            onClick={() => onOpen(event)}
            role="row"
            type="button"
          >
            <div className="font-mono text-[var(--text-xs)] text-text-muted" role="gridcell">
              {event.rangeLabel}
            </div>
            <div className="min-w-0" role="gridcell">
              <div className="truncate text-[var(--text-md)] font-medium text-text-primary">{event.title}</div>
              <div className="truncate text-[var(--text-xs)] text-text-muted">{event.location}</div>
            </div>
          </button>
        ))}
        {source.calendarDayView.events.length === 0 ? (
          <button
            className="min-h-24 rounded-hcbMd border border-dashed border-border bg-bg-tertiary text-[var(--text-sm)] text-text-muted hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={() => onCreate({ allDay: true })}
            type="button"
          >
            New all-day event
          </button>
        ) : null}
      </div>
    </Panel>
  );
}

function WeekView({
  onCreate,
  onOpen
}: {
  onCreate: (seed?: { startsAt?: string; allDay?: boolean }) => void;
  onOpen: (event: CalendarEventViewModel) => void;
}): JSX.Element {
  const source = useCoreViewModelSource();

  return (
    <Panel title="Week view" description="Visible week from cached event range">
      <div className="grid grid-cols-7 gap-2 p-3" role="grid" aria-label="Calendar week view">
        {source.calendarWeekDays.map((day) => (
          <div
            className={cx(
              "min-h-44 rounded-hcbMd border border-border bg-bg-tertiary p-2 text-left transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              day.isToday && "border-accent"
            )}
            key={day.id}
            onClick={() => onCreate({ startsAt: `${day.id.slice("week-".length)}T00:00:00.000Z`, allDay: true })}
            role="gridcell"
            tabIndex={0}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--text-xs)] font-medium text-text-muted">{day.weekday}</span>
              <span className="text-[var(--text-md)] font-semibold text-text-primary">{day.dateLabel}</span>
            </div>
            <div className="mt-2 grid gap-1">
              {day.events.slice(0, 3).map((event) => (
                <span
                  className="truncate rounded-hcbSm border border-border bg-surface-0 px-2 py-1 text-[var(--text-xs)] text-text-secondary"
                  key={event.id}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    onOpen(event);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  {event.timeLabel} {event.title}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function MonthView({
  onCreate,
  onOpen
}: {
  onCreate: (seed?: { startsAt?: string; allDay?: boolean }) => void;
  onOpen: (event: CalendarEventViewModel) => void;
}): JSX.Element {
  const source = useCoreViewModelSource();

  return (
    <Panel title="Month view" description="Cached event range by day">
      <div className="grid gap-1 p-3" role="grid" aria-label="Calendar month view">
        {source.calendarMonthWeeks.map((week) => (
          <div className="grid grid-cols-7 gap-1" key={week.id} role="row">
            {week.days.map((day) => (
              <div
                className={cx(
                  "min-h-20 rounded-hcbSm border border-border bg-bg-tertiary p-2 text-left transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  day.isToday && "border-accent",
                  day.isOutsideMonth && "opacity-55"
                )}
                key={day.id}
                onClick={() => onCreate({ startsAt: `${day.id.slice("month-".length)}T00:00:00.000Z`, allDay: true })}
                role="gridcell"
                tabIndex={0}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-xs)] text-text-muted">{day.weekday}</span>
                  <span className="text-[var(--text-sm)] font-semibold text-text-primary">{day.dateLabel}</span>
                </div>
                {day.events[0] ? (
                  <span
                    className="mt-2 block truncate rounded-hcbSm bg-surface-0 px-2 py-1 text-[var(--text-xs)] text-text-secondary"
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation();
                      onOpen(day.events[0]);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    {day.events[0].title}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function CalendarView(): JSX.Element {
  const source = useCoreViewModelSource();
  const [activeViewId, setActiveViewId] = useState<CalendarViewId>("agenda");
  const [draft, setDraft] = useState<CalendarEventDraft | null>(null);
  const [formError, setFormError] = useState<string | undefined>();
  const calendarNavigationStartedAt = useRef<number | null>(null);

  function setCalendarView(viewId: CalendarViewId): void {
    calendarNavigationStartedAt.current = rendererNow();
    setActiveViewId(viewId);
  }

  useEffect(() => {
    function handleCalendarCommand(event: Event): void {
      const detail = (event as CustomEvent<{ action: string; viewId?: CalendarViewId }>).detail;

      if (detail?.action === "new-event") {
        setCalendarView("agenda");
        setDraft(newCalendarDraft(source));
        setFormError(undefined);
      }

      if (detail?.action === "set-view" && detail.viewId) {
        setCalendarView(detail.viewId);
      }
    }

    window.addEventListener("hcb:calendar-command", handleCalendarCommand);
    return () => window.removeEventListener("hcb:calendar-command", handleCalendarCommand);
  }, [source]);

  useEffect(() => {
    scheduleRendererFrame(() => {
      reportRendererTimingSince("calendar.navigate", calendarNavigationStartedAt.current, {
        view: activeViewId,
        eventCount: source.calendarAgendaEvents.length
      });
      calendarNavigationStartedAt.current = null;
    });
  }, [activeViewId, source.calendarAgendaEvents.length]);

  if (
    (source.dataState === "loading" ||
      source.dataState === "offline" ||
      source.dataState === "error") &&
    !source.hasCachedData
  ) {
    return <CacheStatePanel title="Calendar" />;
  }

  function openCreate(seed?: { startsAt?: string; allDay?: boolean }): void {
    setDraft(newCalendarDraft(source, seed));
    setFormError(undefined);
  }

  function openEdit(event: CalendarEventViewModel): void {
    setDraft(editCalendarDraft(event));
    setFormError(undefined);
  }

  async function saveDraft(): Promise<void> {
    if (!draft) {
      return;
    }

    const payload = calendarEventPayload(draft);

    if (!payload.title) {
      setFormError("Title is required.");
      return;
    }

    if (!payload.calendarId) {
      setFormError("Choose a calendar.");
      return;
    }

    const result =
      draft.mode === "create"
        ? await window.hcb?.calendar.create(payload)
        : await window.hcb?.calendar.update({
            id: draft.id ?? "",
            ...payload
          } satisfies CalendarEventUpdateRequest);

    if (!result?.ok) {
      setFormError(result?.error.message ?? "Calendar event write failed.");
      return;
    }

    setDraft(null);
    source.refresh();
  }

  async function deleteDraft(): Promise<void> {
    if (!draft?.id) {
      return;
    }

    const result = await window.hcb?.calendar.delete({ id: draft.id });

    if (!result?.ok) {
      setFormError(result?.error.message ?? "Calendar event delete failed.");
      return;
    }

    setDraft(null);
    source.refresh();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2" role="tablist" aria-label="Calendar views">
          {(["agenda", "day", "week", "month"] as CalendarViewId[]).map((viewId) => (
            <CalendarTabButton
              active={viewId === activeViewId}
              key={viewId}
              onClick={() => setCalendarView(viewId)}
            >
              {viewId[0].toUpperCase()}
              {viewId.slice(1)}
            </CalendarTabButton>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => openCreate()} size="sm" variant="primary">
            <Plus aria-hidden="true" size={14} />
            New event
          </Button>
          <Badge tone={source.syncStatus.pendingMutationCount > 0 ? "warning" : "accent"}>
            {source.syncStatus.pendingMutationCount > 0
              ? `${source.syncStatus.pendingMutationCount} pending`
              : `Selected calendars: ${source.calendarSources.filter((calendar) => calendar.selected).length}`}
          </Badge>
        </div>
      </div>

      <SectionChrome
        title="Calendar"
        sidebar={
          <div className="grid gap-3">
            {draft ? (
              <CalendarEventForm
                calendars={source.calendarSources}
                draft={draft}
                error={formError}
                onCancel={() => setDraft(null)}
                onDelete={() => void deleteDraft()}
                onSave={() => void saveDraft()}
                setDraft={setDraft}
              />
            ) : null}
            {source.isOffline ? (
              <Panel title="Offline state" description="Google sync">
                <OfflineState />
              </Panel>
            ) : null}
            <Panel title="Calendar sources" description="Selected local mirrors">
              <div role="list">
                {source.calendarSources.map((calendar) => (
                  <ListRow
                    key={calendar.id}
                    leading={<CalendarDays aria-hidden="true" className="text-accent" size={16} />}
                    title={calendar.title}
                    trailing={<Badge tone={calendar.selected ? "success" : "neutral"}>{calendar.selected ? "On" : "Off"}</Badge>}
                  />
                ))}
                {source.calendarSources.length === 0 ? (
                  <EmptyState
                    description="No calendars have been cached yet."
                    title="No calendars"
                  />
                ) : null}
              </div>
            </Panel>
          </div>
        }
      >
        {activeViewId === "agenda" ? (
          <Panel title="Agenda view" description="Windowed rows from local event range">
            <VirtualizedList
              ariaLabel="Calendar agenda"
              estimateRowHeight={58}
              getKey={(event) => event.id}
              items={source.calendarAgendaEvents}
              performanceLabel="calendar.agenda"
              renderRow={(event) => <EventRow event={event} onOpen={openEdit} />}
              viewportHeight={352}
            />
          </Panel>
        ) : null}
        {activeViewId === "day" ? <DayView onCreate={openCreate} onOpen={openEdit} /> : null}
        {activeViewId === "week" ? <WeekView onCreate={openCreate} onOpen={openEdit} /> : null}
        {activeViewId === "month" ? <MonthView onCreate={openCreate} onOpen={openEdit} /> : null}
      </SectionChrome>
    </div>
  );
}

function buildPreview(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return "Empty local note";
  }

  return trimmed.length > 92 ? `${trimmed.slice(0, 89)}...` : trimmed;
}

function NotesView(): JSX.Element {
  const source = useCoreViewModelSource();
  const [notes, setNotes] = useState<NoteViewModel[]>(source.initialNotes);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    source.initialNotes[0]?.id ?? null
  );
  const [draftCounter, setDraftCounter] = useState(1);
  const requestedNoteDetails = useRef(new Set<string>());
  const lastNoteEditReportAt = useRef(0);
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;

  useEffect(() => {
    requestedNoteDetails.current.clear();
    setNotes(source.initialNotes);
    setSelectedNoteId((current) =>
      current && source.initialNotes.some((note) => note.id === current)
        ? current
        : source.initialNotes[0]?.id ?? null
    );
  }, [source.initialNotes]);

  useEffect(() => {
    if (
      !selectedNote ||
      selectedNote.id.startsWith("note-draft-") ||
      requestedNoteDetails.current.has(selectedNote.id)
    ) {
      return;
    }

    requestedNoteDetails.current.add(selectedNote.id);
    let cancelled = false;

    void window.hcb?.notes.get({ id: selectedNote.id }).then((result) => {
      if (cancelled || !result?.ok) {
        return;
      }

      setNotes((current) =>
        current.map((note) =>
          note.id === selectedNote.id
            ? {
                id: result.data.id,
                title: result.data.title,
                body: result.data.body,
                preview: result.data.preview,
                updatedLabel: note.updatedLabel
              }
            : note
        )
      );
    });

    return () => {
      cancelled = true;
    };
  }, [selectedNote?.id]);

  if (
    (source.dataState === "loading" ||
      source.dataState === "offline" ||
      source.dataState === "error") &&
    !source.hasCachedData
  ) {
    return <CacheStatePanel title="Notes" />;
  }

  async function createNote(): Promise<void> {
    const fallbackId = `note-draft-${draftCounter}`;
    const fallbackNote: NoteViewModel = {
      id: fallbackId,
      title: "Untitled note",
      body: "",
      preview: "Empty local note",
      updatedLabel: "Just now"
    };

    setDraftCounter((current) => current + 1);
    setNotes((current) => [fallbackNote, ...current]);
    setSelectedNoteId(fallbackId);

    const result = await window.hcb?.notes.create({
      title: "Untitled note",
      body: ""
    });

    if (result?.ok) {
      requestedNoteDetails.current.add(result.data.id);
      const persisted = {
        id: result.data.id,
        title: result.data.title,
        body: result.data.body,
        preview: result.data.preview,
        updatedLabel: "Just now"
      };

      setNotes((current) =>
        current.map((note) => (note.id === fallbackId ? persisted : note))
      );
      setSelectedNoteId(result.data.id);
    }
  }

  function updateSelectedNote(updates: Partial<Pick<NoteViewModel, "title" | "body">>): void {
    if (!selectedNote) {
      return;
    }

    const startedAt = rendererNow();
    setNotes((current) =>
      current.map((note) => {
        if (note.id !== selectedNote.id) {
          return note;
        }

        const nextBody = updates.body ?? note.body;
        return {
          ...note,
          ...updates,
          preview: buildPreview(nextBody),
          updatedLabel: "Edited locally"
        };
      })
    );

    if (startedAt !== null && startedAt - lastNoteEditReportAt.current > 250) {
      lastNoteEditReportAt.current = startedAt;
      scheduleRendererFrame(() => {
        reportRendererTimingSince("notes.edit.local", startedAt, {
          field: updates.body === undefined ? "title" : "body",
          noteCount: notes.length
        });
      });
    }
  }

  async function persistSelectedNote(): Promise<void> {
    if (!selectedNote || selectedNote.id.startsWith("note-draft-")) {
      return;
    }

    await window.hcb?.notes.update({
      id: selectedNote.id,
      title: selectedNote.title,
      body: selectedNote.body
    });
  }

  async function deleteSelectedNote(): Promise<void> {
    if (!selectedNote) {
      return;
    }

    if (!selectedNote.id.startsWith("note-draft-")) {
      await window.hcb?.notes.delete({ id: selectedNote.id });
    }

    const nextNotes = notes.filter((note) => note.id !== selectedNote.id);
    setNotes(nextNotes);
    setSelectedNoteId(nextNotes[0]?.id ?? null);
  }

  return (
    <SectionChrome
      title="Notes"
      sidebar={
        <Panel
          action={
            <Button onClick={createNote} size="sm" variant="primary">
              <Plus aria-hidden="true" size={14} />
              New note
            </Button>
          }
          title="Local notes"
          description="Local SQLite notes"
        >
          <VirtualizedList
            ariaLabel="Local notes"
            emptyState={
              <EmptyState
                description="Create a local note to populate SQLite."
                title="No local notes"
              />
            }
            estimateRowHeight={66}
            getKey={(note) => note.id}
            items={notes}
            performanceLabel="notes.list"
            renderRow={(note) => (
              <div className="border-b border-border last:border-b-0" role="listitem">
                <button
                  aria-current={note.id === selectedNoteId ? "true" : undefined}
                  className={cx(
                    "flex min-h-[66px] w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    note.id === selectedNoteId ? "bg-surface-0" : "bg-transparent hover:bg-surface-0"
                  )}
                  onClick={() => setSelectedNoteId(note.id)}
                  type="button"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[var(--text-md)] font-medium text-text-primary">
                        {note.title}
                      </span>
                      <span className="shrink-0 text-[var(--text-xs)] text-text-muted">
                        {note.updatedLabel}
                      </span>
                    </div>
                    <p className="truncate text-[var(--text-sm)] text-text-muted">{note.preview}</p>
                  </div>
                  <Badge tone="info">Local</Badge>
                </button>
              </div>
            )}
            viewportHeight={366}
          />
        </Panel>
      }
    >
      <Panel
        action={
          <IconButton
            disabled={!selectedNote}
            icon={Trash2}
            label="Delete selected note"
            onClick={deleteSelectedNote}
            variant="danger"
          />
        }
        title="Note editor"
        description="Local-only note content"
      >
        {selectedNote ? (
          <div className="grid gap-3 p-3">
            <Input
              aria-label="Note title"
              onBlur={() => void persistSelectedNote()}
              onChange={(event) => updateSelectedNote({ title: event.target.value })}
              value={selectedNote.title}
            />
            <textarea
              aria-label="Note body"
              className="min-h-[260px] w-full resize-none rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-base)] text-text-primary placeholder:text-text-muted transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onBlur={() => void persistSelectedNote()}
              onChange={(event) => updateSelectedNote({ body: event.target.value })}
              value={selectedNote.body}
            />
          </div>
        ) : (
          <EmptyState
            description="Use New note to start a local-only note. Nothing is uploaded to Google."
            title="No note selected"
          />
        )}
      </Panel>
    </SectionChrome>
  );
}

function SearchView({
  query,
  setQuery
}: {
  query: string;
  setQuery: (query: string) => void;
}): JSX.Element {
  const search = useLocalSearch(query);
  const searchViewModel = search.viewModel;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          size={15}
        />
        <Input
          aria-label="Search local cache"
          className="pl-9"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tasks, events, and notes"
          value={query}
        />
      </div>

      <Panel
        action={<Badge tone={searchViewModel.state === "results" ? "success" : "neutral"}>{searchViewModel.summary}</Badge>}
        title="Search results"
        description={
          search.state === "stale"
            ? "Refreshing local results"
            : "Capped SQLite-backed local results"
        }
      >
        {search.state === "loading" ? (
          <LoadingState description="Searching the local cache." title="Searching" />
        ) : search.state === "error" ? (
          <ErrorState description={search.errorMessage ?? "Search failed."} />
        ) : search.state === "offline" ? (
          <OfflineState description="Search requires the preload bridge." />
        ) : searchViewModel.state === "idle" ? (
          <EmptyState
            description="Type a query to search cached tasks, events, and notes."
            title="Search local cache"
          />
        ) : searchViewModel.state === "empty" ? (
          <EmptyState
            description="No cached tasks, events, or notes matched the query."
            title="No matching results"
          />
        ) : (
          <VirtualizedList
            ariaLabel="Search results"
            estimateRowHeight={60}
            getKey={(result) => result.id}
            items={searchViewModel.results}
            performanceLabel="search.results"
            renderRow={(result) => (
              <ListRow
                description={`${result.detail} - ${result.deepLinkLabel}`}
                title={result.title}
                trailing={<Badge tone={sourceTone(result.source)}>{result.source}</Badge>}
              />
            )}
            viewportHeight={356}
          />
        )}
      </Panel>
    </div>
  );
}

function SettingsView(): JSX.Element {
  const source = useCoreViewModelSource();
  const [selectedSectionId, setSelectedSectionId] = useState<SettingsSectionId>("google");
  const [confirmation, setConfirmation] = useState<{
    action: SettingsRecoveryActionRequest["action"];
    phrase: string;
  } | null>(null);
  const [confirmationInput, setConfirmationInput] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const selectedSection =
    source.settingsSections.find((section) => section.id === selectedSectionId) ??
    source.settingsSections[0];
  const diagnostics = source.diagnosticsSummary;
  const settings = source.settings;

  function updateSettings(request: SettingsUpdateRequest): void {
    setRecoveryMessage(null);
    void source.updateSettings(request);
  }

  function updateSelectedTaskList(taskListId: string, selected: boolean): void {
    const current = new Set(settings.selectedTaskListIds.length > 0
      ? settings.selectedTaskListIds
      : source.taskLists.map((taskList) => taskList.id));

    if (selected) {
      current.add(taskListId);
    } else {
      current.delete(taskListId);
    }

    updateSettings({ selectedTaskListIds: [...current] });
  }

  function updateSelectedCalendar(calendarId: string, selected: boolean): void {
    const current = new Set(settings.selectedCalendarIds.length > 0
      ? settings.selectedCalendarIds
      : source.calendarSources.filter((calendar) => calendar.selected).map((calendar) => calendar.id));

    if (selected) {
      current.add(calendarId);
    } else {
      current.delete(calendarId);
    }

    updateSettings({ selectedCalendarIds: [...current] });
  }

  function beginRecoveryAction(action: SettingsRecoveryActionRequest["action"]): void {
    if (action === "refresh") {
      void runRecovery({ action });
      return;
    }

    setConfirmation({ action, phrase: recoveryPhrase(action) });
    setConfirmationInput("");
  }

  async function runRecovery(request: SettingsRecoveryActionRequest): Promise<void> {
    const result = await source.runRecoveryAction(request);

    if (result) {
      setRecoveryMessage(result.message);
      setConfirmation(null);
      setConfirmationInput("");
    }
  }

  function confirmRecoveryAction(): void {
    if (!confirmation || confirmationInput !== confirmation.phrase) {
      return;
    }

    void runRecovery({
      action: confirmation.action,
      confirmation: {
        accepted: true,
        phrase: confirmationInput
      }
    });
  }

  function copyDiagnostics(): void {
    const payload = JSON.stringify(diagnostics ?? selectedSection.rows, null, 2);
    void navigator.clipboard?.writeText(payload);
    setRecoveryMessage("Diagnostics summary copied without credentials, raw Google payloads, MCP bearer tokens, or sensitive bodies.");
  }

  function requestNotificationPermission(): void {
    void window.hcb?.native.requestNotificationPermission().then(() => {
      source.refresh();
    });
  }

  function renderSectionControls(): JSX.Element {
    if (selectedSection.id === "google") {
      return (
        <div className="grid gap-3 p-3">
          <SettingsRows rows={selectedSection.rows} status={selectedSection.status} />
          <StatusBanner
            description="Only sanitized connection state is available in the renderer."
            title="Credential storage"
            tone="success"
          />
        </div>
      );
    }

    if (selectedSection.id === "resources") {
      const selectedTaskLists = new Set(settings.selectedTaskListIds);
      const selectedCalendars = new Set(settings.selectedCalendarIds);

      return (
        <div className="grid grid-cols-2 gap-3 p-3">
          <div className="min-w-0 rounded-hcbMd border border-border bg-bg-tertiary">
            <div className="border-b border-border px-3 py-2">
              <h3 className="truncate text-[var(--text-md)] font-semibold text-text-primary">Task lists</h3>
              <p className="truncate text-[var(--text-xs)] text-text-muted">Google Tasks</p>
            </div>
            <div className="grid gap-2 p-3">
              {source.taskLists.length === 0 ? (
                <EmptyState description="No task lists are cached yet." title="No task lists" />
              ) : source.taskLists.map((taskList) => (
                <label
                  className="flex min-h-8 items-center gap-2 rounded-hcbMd border border-border bg-bg-tertiary px-3 text-[var(--text-sm)] text-text-secondary"
                  key={taskList.id}
                >
                  <input
                    checked={selectedTaskLists.size === 0 || selectedTaskLists.has(taskList.id)}
                    className="accent-[var(--color-accent)]"
                    onChange={(event) => updateSelectedTaskList(taskList.id, event.target.checked)}
                    type="checkbox"
                  />
                  <span className="min-w-0 flex-1 truncate">{taskList.title}</span>
                  <Badge>{taskList.activeTaskCount ?? taskList.taskCount ?? 0}</Badge>
                </label>
              ))}
            </div>
          </div>
          <div className="min-w-0 rounded-hcbMd border border-border bg-bg-tertiary">
            <div className="border-b border-border px-3 py-2">
              <h3 className="truncate text-[var(--text-md)] font-semibold text-text-primary">Calendars</h3>
              <p className="truncate text-[var(--text-xs)] text-text-muted">Google Calendar</p>
            </div>
            <div className="grid gap-2 p-3">
              {source.calendarSources.length === 0 ? (
                <EmptyState description="No calendars are cached yet." title="No calendars" />
              ) : source.calendarSources.map((calendar) => (
                <label
                  className="flex min-h-8 items-center gap-2 rounded-hcbMd border border-border bg-bg-tertiary px-3 text-[var(--text-sm)] text-text-secondary"
                  key={calendar.id}
                >
                  <input
                    checked={selectedCalendars.size === 0 ? calendar.selected : selectedCalendars.has(calendar.id)}
                    className="accent-[var(--color-accent)]"
                    onChange={(event) => updateSelectedCalendar(calendar.id, event.target.checked)}
                    type="checkbox"
                  />
                  <span className="min-w-0 flex-1 truncate">{calendar.title}</span>
                  <Badge>{calendar.eventCount ?? 0}</Badge>
                </label>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (selectedSection.id === "sync") {
      return (
        <div className="grid gap-3 p-3">
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span>Sync mode</span>
            <select
              aria-label="Sync mode"
              className={settingsSelectClass}
              onChange={(event) =>
                updateSettings({ syncMode: event.target.value as SettingsSnapshot["syncMode"] })
              }
              value={settings.syncMode}
            >
              <option value="manual">Manual</option>
              <option value="balanced">Balanced</option>
              <option value="near-real-time">Near real-time</option>
            </select>
          </label>
          <div className="flex items-center gap-2">
            <Button disabled={source.settingsMutationPending} onClick={() => beginRecoveryAction("refresh")}>
              <RotateCcw aria-hidden="true" size={14} />
              Refresh
            </Button>
            <Button
              disabled={source.settingsMutationPending}
              onClick={() => beginRecoveryAction("forceFullResync")}
              variant="danger"
            >
              Force full resync
            </Button>
          </div>
          <SettingsRows rows={selectedSection.rows} status={selectedSection.status} />
        </div>
      );
    }

    if (selectedSection.id === "appearance") {
      return (
        <div className="grid gap-3 p-3">
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span>Theme</span>
            <select
              aria-label="Theme"
              className={settingsSelectClass}
              onChange={(event) =>
                updateSettings({ theme: event.target.value as SettingsSnapshot["theme"] })
              }
              value={settings.theme}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      );
    }

    if (selectedSection.id === "hotkeys") {
      return (
        <div className="grid gap-3 p-3">
          <StatusBanner
            description="Shortcut conflicts are recoverable and do not stop the app."
            title="Shortcut attention"
            tone="warning"
          />
          <Input
            aria-label="Quick capture shortcut"
            onBlur={(event) =>
              updateSettings({
                quickCaptureShortcut: event.currentTarget.value.trim() || null
              })
            }
            defaultValue={settings.quickCaptureShortcut ?? ""}
            placeholder="Ctrl+Space"
          />
        </div>
      );
    }

    if (selectedSection.id === "tray") {
      return (
        <div className="grid gap-3 p-3">
          <SettingsToggle
            checked={settings.showTrayIcon}
            label="Show menu bar icon"
            onChange={(checked) => updateSettings({ showTrayIcon: checked })}
          />
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span>Primary click</span>
            <select
              aria-label="Tray click action"
              className={settingsSelectClass}
              onChange={(event) =>
                updateSettings({
                  trayClickAction: event.target.value as SettingsSnapshot["trayClickAction"]
                })
              }
              value={settings.trayClickAction}
            >
              <option value="open-menu">Open menu bar panel</option>
              <option value="toggle-window">Show or hide window</option>
              <option value="quick-capture">Quick capture</option>
              <option value="open-today">Open Today</option>
            </select>
          </label>
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span>Panel style</span>
            <select
              aria-label="Menu bar panel style"
              className={settingsSelectClass}
              onChange={(event) =>
                updateSettings({
                  menuBarPanelStyle: event.target.value as SettingsSnapshot["menuBarPanelStyle"]
                })
              }
              value={settings.menuBarPanelStyle}
            >
              <option value="adaptive">Adaptive</option>
              <option value="agenda">Agenda</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <SettingsToggle
            checked={settings.showMenuBarBadge}
            label="Show overdue badge"
            onChange={(checked) => updateSettings({ showMenuBarBadge: checked })}
          />
        </div>
      );
    }

    if (selectedSection.id === "notifications") {
      return (
        <div className="grid gap-3 p-3">
          <SettingsToggle
            checked={settings.notificationsEnabled}
            label="Enable local notifications"
            onChange={(checked) => updateSettings({ notificationsEnabled: checked })}
          />
          <Input
            aria-label="Notification lead minutes"
            min={0}
            max={40320}
            onBlur={(event) =>
              updateSettings({
                notificationLeadMinutes: Number(event.currentTarget.value) || 0
              })
            }
            defaultValue={String(settings.notificationLeadMinutes)}
            type="number"
          />
          <Button onClick={requestNotificationPermission} variant="ghost">
            Request permission
          </Button>
        </div>
      );
    }

    if (selectedSection.id === "localData") {
      return (
        <div className="grid gap-3 p-3">
          <div className="grid grid-cols-3 gap-2">
            <MetricTile label="Cache rows" value={String((diagnostics?.cache.taskCount ?? 0) + (diagnostics?.cache.eventCount ?? 0))} />
            <MetricTile label="Checkpoints" value={String(diagnostics?.checkpoints.totalCount ?? 0)} />
            <MetricTile label="Pending" value={String(diagnostics?.pendingMutations.totalCount ?? 0)} />
          </div>
          <Button
            disabled={source.settingsMutationPending}
            onClick={() => beginRecoveryAction("clearGoogleCache")}
            variant="danger"
          >
            <Trash2 aria-hidden="true" size={14} />
            Clear local Google cache
          </Button>
        </div>
      );
    }

    if (selectedSection.id === "mcp") {
      return (
        <div className="grid gap-3 p-3">
          <SettingsToggle
            checked={settings.mcpEnabled}
            label="Enable MCP server"
            onChange={(checked) => updateSettings({ mcpEnabled: checked })}
          />
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span>Permission mode</span>
            <select
              aria-label="MCP permission mode"
              className={settingsSelectClass}
              onChange={(event) =>
                updateSettings({
                  mcpPermissionMode: event.target.value as SettingsSnapshot["mcpPermissionMode"]
                })
              }
              value={settings.mcpPermissionMode}
            >
              <option value="read-only">Read-only</option>
              <option value="confirm-writes">Confirm writes</option>
              <option value="allow-writes">Allow writes</option>
            </select>
          </label>
          <Input
            aria-label="MCP port"
            min={0}
            max={65535}
            onBlur={(event) => updateSettings({ mcpPort: Number(event.currentTarget.value) || 0 })}
            defaultValue={String(settings.mcpPort)}
            type="number"
          />
          <Button
            disabled={source.settingsMutationPending}
            onClick={() => beginRecoveryAction("resetMcpToken")}
            variant="danger"
          >
            Reset MCP token
          </Button>
        </div>
      );
    }

    if (selectedSection.id === "platform") {
      return (
        <div className="grid gap-3 p-3">
          <SettingsRows rows={selectedSection.rows} status={selectedSection.status} />
        </div>
      );
    }

    return (
      <div className="grid gap-3 p-3">
        <SettingsToggle
          checked={settings.diagnosticsIncludePerformance}
          label="Include performance diagnostics"
          onChange={(checked) => updateSettings({ diagnosticsIncludePerformance: checked })}
        />
        <div className="grid grid-cols-3 gap-2">
          <MetricTile label="Startup" value={`${Math.round(diagnostics?.performance.startup.shellVisibleMs ?? 0)}ms`} />
          <MetricTile label="Migration" value={`${Math.round(diagnostics?.performance.migrationDurationMs ?? 0)}ms`} />
          <MetricTile label="MCP requests" value={String(diagnostics?.performance.mcpRequestCounts.totalRequests ?? 0)} />
        </div>
        <SettingsRows rows={selectedSection.rows} status={selectedSection.status} />
      </div>
    );
  }

  return (
    <SectionChrome
      title="Settings"
      sidebar={
        <Panel title="Settings sections" description="Required v1 preference areas">
          <div className="grid gap-1 p-2" role="list">
            {source.settingsSections.map((section) => (
              <button
                aria-pressed={section.id === selectedSectionId}
                className={cx(
                  "flex min-h-9 w-full items-center gap-2 rounded-hcbMd px-2 text-left transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  section.id === selectedSectionId
                    ? "bg-surface-0 text-text-primary"
                    : "text-text-secondary hover:bg-surface-0 hover:text-text-primary"
                )}
                key={section.id}
                onClick={() => setSelectedSectionId(section.id)}
                type="button"
              >
                <Settings2 aria-hidden="true" size={15} />
                <span className="min-w-0 flex-1 truncate">{section.title}</span>
                <Badge tone={settingTone(section.status)}>{section.status}</Badge>
              </button>
            ))}
          </div>
        </Panel>
      }
    >
      <div className="grid gap-3">
        <Panel
          action={
            <Button onClick={copyDiagnostics} size="sm" variant="ghost">
              <Copy aria-hidden="true" size={14} />
              Copy diagnostics
            </Button>
          }
          title={selectedSection.title}
          description={selectedSection.detail}
        >
          {renderSectionControls()}
        </Panel>

        {source.settingsMutationError ? (
          <StatusBanner
            description={source.settingsMutationError}
            title="Settings action not applied"
            tone="warning"
          />
        ) : null}
        {recoveryMessage ? (
          <StatusBanner description={recoveryMessage} title="Recovery action applied" tone="success" />
        ) : null}
        {confirmation ? (
          <Panel title="Confirm destructive action" description={confirmation.action}>
            <div className="grid gap-3 p-3">
              <Input
                aria-label="Confirmation phrase"
                onChange={(event) => setConfirmationInput(event.target.value)}
                placeholder={confirmation.phrase}
                value={confirmationInput}
              />
              <div className="flex items-center gap-2">
                <Button
                  disabled={confirmationInput !== confirmation.phrase || source.settingsMutationPending}
                  onClick={confirmRecoveryAction}
                  variant="danger"
                >
                  Confirm
                </Button>
                <Button onClick={() => setConfirmation(null)} variant="ghost">
                  Cancel
                </Button>
              </div>
            </div>
          </Panel>
        ) : null}

        <Panel title="Diagnostics state" description="Sanitized status and recoverable errors">
          <div className="grid grid-cols-4 gap-2 p-3">
            <MetricTile label="Credentials" value={diagnostics?.redaction.credentials ?? "redacted"} />
            <MetricTile label="Google payloads" value={diagnostics?.redaction.googlePayloads ?? "omitted"} />
            <MetricTile label="MCP bearer" value={diagnostics?.redaction.mcpBearerTokens ?? "redacted"} />
            <MetricTile label="Sensitive bodies" value={diagnostics?.redaction.sensitiveBodies ?? "omitted"} />
          </div>
        </Panel>
      </div>
    </SectionChrome>
  );
}

const settingsSelectClass =
  "h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function recoveryPhrase(action: SettingsRecoveryActionRequest["action"]): string {
  if (action === "forceFullResync") {
    return "FULL RESYNC";
  }

  if (action === "clearGoogleCache") {
    return "CLEAR CACHE";
  }

  if (action === "resetMcpToken") {
    return "RESET MCP TOKEN";
  }

  return "";
}

function SettingsRows({
  rows,
  status
}: {
  rows: Array<{ id: string; label: string; value: string }>;
  status: string;
}): JSX.Element {
  return (
    <div role="list">
      {rows.map((row) => (
        <ListRow
          description={row.value}
          key={row.id}
          title={row.label}
          trailing={<Badge tone={settingTone(status)}>{status}</Badge>}
        />
      ))}
    </div>
  );
}

function SettingsToggle({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label className="flex min-h-9 items-center gap-2 rounded-hcbMd border border-border bg-bg-tertiary px-3 text-[var(--text-sm)] text-text-secondary">
      <input
        checked={checked}
        className="accent-[var(--color-accent)]"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}

export function SectionContent({
  activeSectionId,
  searchQuery,
  setSearchQuery,
  taskCommand
}: {
  activeSectionId: SectionId;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  taskCommand?: TaskSurfaceCommand | null;
}): JSX.Element {
  if (activeSectionId === "tasks") {
    return <TasksView command={taskCommand} />;
  }

  if (activeSectionId === "calendar") {
    return <CalendarView />;
  }

  if (activeSectionId === "notes") {
    return <NotesView />;
  }

  if (activeSectionId === "search") {
    return <SearchView query={searchQuery} setQuery={setSearchQuery} />;
  }

  if (activeSectionId === "settings") {
    return <SettingsView />;
  }

  return <TodayView />;
}
