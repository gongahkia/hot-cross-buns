import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import type {
  CalendarEventCreateRequest,
  CalendarEventUpdateRequest,
  SavedSearchView,
  SettingsRecoveryActionRequest,
  SettingsSnapshot,
  SettingsUpdateRequest,
  TaskCreateRequest,
  TaskUpdateRequest
} from "@shared/ipc/contracts";
import {
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  ListPlus,
  Pencil,
  Filter,
  Minus,
  Plus,
  RotateCcw,
  Save,
  StepBack,
  StepForward,
  Search,
  Settings2,
  Trash2,
  X
} from "lucide-react";
import { getPlannerAction, type PlannerActionId } from "../../actions/plannerActions";
import { Badge, Button, IconButton, Input, ListRow, Panel, StatusBanner, cx } from "../../components/primitives";
import { EmptyState, ErrorState, LoadingState, OfflineState } from "../../components/states";
import { VirtualizedList } from "../../components/VirtualizedList";
import type { SectionId } from "../../data/mockPlanner";
import {
  rendererNow,
  reportRendererTimingSince
} from "../../hooks/useRenderTiming";
import { getAppNotifications, type AppNotificationTone } from "./appNotifications";
import { useCoreViewModelSource, useLocalSearch } from "./coreViewModelSource";
import type {
  CalendarEventViewModel,
  CalendarViewId,
  CorePriority,
  NoteViewModel,
  SearchSource,
  ScheduledTaskBlockViewModel,
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

function actionLabel(actionId: PlannerActionId): string {
  return getPlannerAction(actionId).label;
}

function actionDescription(actionId: PlannerActionId): string {
  return getPlannerAction(actionId).description;
}

function handleActivationKeyDown(event: KeyboardEvent<HTMLElement>, callback: () => void): void {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  callback();
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

function dateRangeInputToInclusiveIsoRange(
  startDate: string,
  endDate: string
): { start: string; end: string } | null {
  if (!startDate || !endDate) {
    return null;
  }

  const start = dateInputToIso(startDate);
  const endDay = dateInputToIso(endDate);

  if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(endDay))) {
    return null;
  }

  return {
    start,
    end: addUtcDaysIso(endDay, 1)
  };
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
  bulkSelected,
  completed,
  onDelete,
  onBulkSelect,
  onSelect,
  onToggle,
  selected,
  task
}: {
  bulkSelected: boolean;
  completed: boolean;
  onDelete: (taskId: string) => void;
  onBulkSelect: (taskId: string, selected: boolean) => void;
  onSelect: (taskId: string) => void;
  onToggle: (taskId: string) => void;
  selected: boolean;
  task: TaskViewModel;
}): JSX.Element {
  return (
    <div
      className={cx(
        "min-h-[76px] border-b border-border px-3 py-2 last:border-b-0",
        selected || bulkSelected ? "bg-surface-0" : "bg-transparent"
      )}
      role="listitem"
    >
      <div className="flex min-w-0 items-start gap-3">
        <TaskCompletionButton completed={completed} onToggle={onToggle} task={task} />
        <input
          aria-label={`Select ${task.title}`}
          checked={bulkSelected}
          className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
          onChange={(event) => onBulkSelect(task.id, event.target.checked)}
          type="checkbox"
        />
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
  bulkSelectedTaskIds,
  onBulkSelectTask,
  onDeleteTask,
  onSelectTask,
  onToggleTask,
  selectedTaskId
}: {
  group: TaskGroupViewModel;
  bulkSelectedTaskIds: string[];
  onBulkSelectTask: (taskId: string, selected: boolean) => void;
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
            bulkSelected={bulkSelectedTaskIds.includes(task.id)}
            completed={task.status === "completed"}
            onBulkSelect={onBulkSelectTask}
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
  onMoveBlock,
  onRepairBlock,
  onResizeBlock,
  onUnscheduleBlock,
  row
}: {
  onMoveBlock: (block: ScheduledTaskBlockViewModel, minutes: number) => void;
  onRepairBlock: (block: ScheduledTaskBlockViewModel) => void;
  onResizeBlock: (block: ScheduledTaskBlockViewModel, minutes: number) => void;
  onUnscheduleBlock: (blockId: string) => void;
  row:
    | { kind: "task"; task: TaskViewModel }
    | { kind: "event"; event: CalendarEventViewModel }
    | { kind: "scheduledTaskBlock"; block: ScheduledTaskBlockViewModel };
}): JSX.Element {
  if (row.kind === "event") {
    return <EventRow event={row.event} />;
  }

  if (row.kind === "scheduledTaskBlock") {
    const conflictDetail =
      row.block.conflictTitles.length > 0
        ? ` - Conflicts with ${row.block.conflictTitles.join(", ")}`
        : "";

    return (
      <ListRow
        description={`${row.block.rangeLabel} - ${row.block.calendar}${conflictDetail}`}
        leading={<Clock3 aria-hidden="true" className="text-accent" size={17} />}
        meta={`${row.block.durationMinutes} min`}
        title={row.block.title}
        trailing={
          <div className="flex items-center gap-1">
            {row.block.isNextUp ? <Badge tone="info">Next</Badge> : null}
            {row.block.conflictCount > 0 ? <Badge tone="warning">Conflict</Badge> : null}
            {row.block.mutationState && row.block.mutationState !== "synced" ? (
              <Badge tone={row.block.mutationState === "failed" ? "danger" : "warning"}>
                {row.block.mutationState === "failed" ? "Failed" : "Queued"}
              </Badge>
            ) : (
              <Badge tone={row.block.status === "orphaned" ? "warning" : "accent"}>
                {row.block.status === "orphaned" ? "Needs repair" : "Scheduled"}
              </Badge>
            )}
            {row.block.status === "orphaned" ? (
              <IconButton
                icon={RotateCcw}
                label={`Repair ${row.block.title}`}
                onClick={() => onRepairBlock(row.block)}
                variant="ghost"
              />
            ) : null}
            <IconButton
              icon={StepBack}
              label={`Move ${row.block.title} earlier`}
              onClick={() => onMoveBlock(row.block, -30)}
              variant="ghost"
            />
            <IconButton
              icon={StepForward}
              label={`Move ${row.block.title} later`}
              onClick={() => onMoveBlock(row.block, 30)}
              variant="ghost"
            />
            <IconButton
              disabled={row.block.durationMinutes <= 15}
              icon={Minus}
              label={`Shorten ${row.block.title}`}
              onClick={() => onResizeBlock(row.block, -15)}
              variant="ghost"
            />
            <IconButton
              icon={Plus}
              label={`Lengthen ${row.block.title}`}
              onClick={() => onResizeBlock(row.block, 15)}
              variant="ghost"
            />
            <IconButton
              icon={X}
              label={`Unschedule ${row.block.title}`}
              onClick={() => onUnscheduleBlock(row.block.id)}
              variant="ghost"
            />
          </div>
        }
      />
    );
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

type TodayTimelineDataRow =
  | { kind: "task"; task: TaskViewModel }
  | { kind: "event"; event: CalendarEventViewModel }
  | { kind: "scheduledTaskBlock"; block: ScheduledTaskBlockViewModel };

type TodayTimelineEntry =
  | { kind: "header"; id: string; title: string; detail: string; count: number }
  | { kind: "row"; id: string; row: TodayTimelineDataRow };

const todayTimelineSections = [
  {
    id: "all-day",
    title: "All day",
    detail: "Fixed calendar blocks"
  },
  {
    id: "morning",
    title: "Morning",
    detail: "Before noon"
  },
  {
    id: "afternoon",
    title: "Afternoon",
    detail: "Midday work"
  },
  {
    id: "evening",
    title: "Evening",
    detail: "Later agenda"
  },
  {
    id: "unscheduled",
    title: "Unscheduled",
    detail: "Tasks without a planned time"
  }
] as const;

type TodayTimelineSectionId = (typeof todayTimelineSections)[number]["id"];

function todayTimelineSection(row: TodayTimelineDataRow): TodayTimelineSectionId {
  if (row.kind === "task") {
    return "unscheduled";
  }

  const startsAt = row.kind === "scheduledTaskBlock" ? row.block.startsAt : row.event.startsAt;

  if (row.kind === "event" && row.event.allDay) {
    return "all-day";
  }

  const hour = new Date(startsAt).getHours();

  if (hour < 12) {
    return "morning";
  }

  if (hour < 17) {
    return "afternoon";
  }

  return "evening";
}

function buildTodayTimelineEntries(rows: TodayTimelineDataRow[]): TodayTimelineEntry[] {
  const grouped = new Map<TodayTimelineSectionId, TodayTimelineDataRow[]>();

  for (const row of rows) {
    const sectionId = todayTimelineSection(row);
    grouped.set(sectionId, [...(grouped.get(sectionId) ?? []), row]);
  }

  return todayTimelineSections.flatMap((section) => {
    const sectionRows = grouped.get(section.id) ?? [];

    if (sectionRows.length === 0) {
      return [];
    }

    return [
      {
        kind: "header" as const,
        id: section.id,
        title: section.title,
        detail: section.detail,
        count: sectionRows.length
      },
      ...sectionRows.map((row, index) => ({
        kind: "row" as const,
        id: `${section.id}-${row.kind}-${index}`,
        row
      }))
    ];
  });
}

function TodayTimelineHeader({
  count,
  detail,
  title
}: {
  count: number;
  detail: string;
  title: string;
}): JSX.Element {
  return (
    <div className="flex min-h-9 items-center gap-3 border-b border-border bg-bg-tertiary px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[var(--text-sm)] font-semibold text-text-primary">{title}</div>
        <div className="truncate text-[var(--text-xs)] text-text-muted">{detail}</div>
      </div>
      <Badge tone="neutral">{count}</Badge>
    </div>
  );
}

function TodayView(): JSX.Element {
  const source = useCoreViewModelSource();
  const defaultTaskId = source.todayViewModel.focusTasks[0]?.id ?? "";
  const defaultCalendar = defaultCalendarId(source);
  const [scheduleTaskId, setScheduleTaskId] = useState(defaultTaskId);
  const [scheduleCalendarId, setScheduleCalendarId] = useState(defaultCalendar);
  const [scheduleStart, setScheduleStart] = useState(() =>
    dateTimeLocalInputValue(defaultTimedStart(new Date().toISOString()))
  );
  const [scheduleDuration, setScheduleDuration] = useState("30");
  const timelineRows = useMemo<TodayTimelineDataRow[]>(() => {
    const rows: TodayTimelineDataRow[] = [];

    for (const row of source.todayViewModel.timelineRows) {
      if (row.kind === "event") {
        const event = source.calendarEventsById[row.itemId];

        if (event) {
          rows.push({ kind: "event", event });
        }
      } else if (row.kind === "scheduledTaskBlock") {
        const block = source.getScheduledTaskBlockById(row.itemId);

        if (block) {
          rows.push({ kind: "scheduledTaskBlock", block });
        }
      } else {
        rows.push({ kind: "task", task: source.getTaskById(row.itemId) });
      }
    }

    return rows;
  }, [source]);
  const timelineEntries = useMemo(() => buildTodayTimelineEntries(timelineRows), [timelineRows]);
  const canScheduleTask =
    scheduleTaskId.length > 0 &&
    scheduleCalendarId.length > 0 &&
    scheduleStart.length > 0 &&
    Number(scheduleDuration) >= 5 &&
    !source.taskMutationPending;

  useEffect(() => {
    setScheduleTaskId((current) => current || defaultTaskId);
  }, [defaultTaskId]);

  useEffect(() => {
    setScheduleCalendarId((current) => current || defaultCalendar);
  }, [defaultCalendar]);

  async function scheduleSelectedTask(): Promise<void> {
    if (!canScheduleTask) {
      return;
    }

    const scheduled = await source.scheduleTaskBlock({
      taskId: scheduleTaskId,
      calendarId: scheduleCalendarId,
      startsAt: dateTimeLocalInputToIso(scheduleStart),
      durationMinutes: Number(scheduleDuration)
    });

    if (scheduled) {
      const nextTaskId = source.todayViewModel.focusTasks.find((task) => task.id !== scheduleTaskId)?.id ?? "";
      setScheduleTaskId(nextTaskId);
    }
  }

  function moveBlock(block: ScheduledTaskBlockViewModel, minutes: number): void {
    const nextStart = new Date(Date.parse(block.startsAt) + minutes * 60 * 1000).toISOString();

    void source.moveScheduledTaskBlock({
      id: block.id,
      startsAt: nextStart
    });
  }

  function repairBlock(block: ScheduledTaskBlockViewModel): void {
    void source.moveScheduledTaskBlock({
      id: block.id,
      calendarId: block.calendarId,
      startsAt: block.startsAt,
      durationMinutes: block.durationMinutes
    });
  }

  function resizeBlock(block: ScheduledTaskBlockViewModel, minutes: number): void {
    void source.moveScheduledTaskBlock({
      id: block.id,
      durationMinutes: Math.max(5, block.durationMinutes + minutes)
    });
  }

  const conflictSummary =
    source.todayViewModel.conflictCount === 0
      ? "No timeline conflicts"
      : `${source.todayViewModel.conflictCount} timeline ${
          source.todayViewModel.conflictCount === 1 ? "conflict" : "conflicts"
        }`;
  const timelineStatusTitle = source.todayViewModel.nextUp
    ? `Next up: ${source.todayViewModel.nextUp.title}`
    : `Now ${source.todayViewModel.currentTimeLabel}`;
  const timelineStatusDescription = source.todayViewModel.nextUp
    ? `${source.todayViewModel.nextUp.detail} - ${conflictSummary}`
    : `No upcoming timed rows - ${conflictSummary}`;

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

      <StatusBanner
        description={timelineStatusDescription}
        icon={source.todayViewModel.conflictCount > 0 ? AlertTriangle : Clock3}
        title={timelineStatusTitle}
        tone={source.todayViewModel.conflictCount > 0 ? "warning" : "info"}
      />

      <SectionChrome
        title="Today"
        sidebar={
          <div className="grid gap-3">
            <Panel
              action={
                <Button
                  disabled={!canScheduleTask}
                  onClick={() => void scheduleSelectedTask()}
                  size="sm"
                  variant="primary"
                >
                  <CalendarPlus aria-hidden="true" size={14} />
                  Schedule
                </Button>
              }
              title="Schedule task"
              description="Create a linked Google Calendar block"
            >
              <div className="grid gap-3 p-3">
                <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
                  <span>Task</span>
                  <select
                    aria-label="Task to schedule"
                    className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    disabled={source.todayViewModel.focusTasks.length === 0}
                    onChange={(event) => setScheduleTaskId(event.target.value)}
                    value={scheduleTaskId}
                  >
                    {source.todayViewModel.focusTasks.length === 0 ? (
                      <option value="">No unscheduled tasks</option>
                    ) : null}
                    {source.todayViewModel.focusTasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
                  <span>Calendar</span>
                  <select
                    aria-label="Schedule calendar"
                    className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    disabled={source.calendarSources.length === 0}
                    onChange={(event) => setScheduleCalendarId(event.target.value)}
                    value={scheduleCalendarId}
                  >
                    {source.calendarSources.length === 0 ? <option value="">No calendars</option> : null}
                    {source.calendarSources.map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>
                        {calendar.title}
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  aria-label="Schedule starts"
                  onChange={(event) => setScheduleStart(event.target.value)}
                  type="datetime-local"
                  value={scheduleStart}
                />
                <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
                  <span>Duration</span>
                  <select
                    aria-label="Schedule duration"
                    className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    onChange={(event) => setScheduleDuration(event.target.value)}
                    value={scheduleDuration}
                  >
                    <option value="15">15 min</option>
                    <option value="30">30 min</option>
                    <option value="45">45 min</option>
                    <option value="60">60 min</option>
                    <option value="90">90 min</option>
                    <option value="120">120 min</option>
                  </select>
                </label>
              </div>
            </Panel>
            <Panel title="Focus queue" description="Open unscheduled tasks">
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
                viewportHeight={220}
              />
            </Panel>
          </div>
        }
      >
        <Panel title="Timeline" description="Tasks and calendar agenda from the local cache">
          <VirtualizedList
            ariaLabel="Today timeline"
            estimateRowHeight={58}
            emptyState={
              <EmptyState
                description="No cached agenda rows are available for Today."
                title="No timeline rows"
              />
            }
            getKey={(entry) => entry.id}
            items={timelineEntries}
            performanceLabel="today.timeline"
            renderRow={(entry) =>
              entry.kind === "header" ? (
                <TodayTimelineHeader
                  count={entry.count}
                  detail={entry.detail}
                  title={entry.title}
                />
              ) : (
                <TodayTimelineRow
                  onMoveBlock={moveBlock}
                  onRepairBlock={repairBlock}
                  onResizeBlock={resizeBlock}
                  onUnscheduleBlock={(blockId) => void source.unscheduleTaskBlock(blockId)}
                  row={entry.row}
                />
              )
            }
            viewportHeight={342}
          />
        </Panel>
      </SectionChrome>
    </div>
  );
}

export interface TaskSurfaceCommand {
  id: "task.create" | "task.quickCapture";
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
  const [bulkSelectedTaskIds, setBulkSelectedTaskIds] = useState<string[]>([]);
  const [bulkMoveListId, setBulkMoveListId] = useState("");
  const handledCommandNonce = useRef<number | null>(null);
  const quickCaptureOpenStartedAt = useRef<number | null>(null);
  const activeFilter = source.getTaskFilterViewModel(activeFilterId);
  const selectedTask = selectedTaskId ? source.getTaskById(selectedTaskId) : null;
  const taskIdsInWindow = new Set(source.largeTaskWindow.map((task) => task.id));
  const visibleTaskIds = activeFilter.groups.flatMap((group) => group.tasks.map((task) => task.id));
  const bulkSelectedTaskIdsInWindow = bulkSelectedTaskIds.filter((taskId) => taskIdsInWindow.has(taskId));
  const bulkSelectedTasks = bulkSelectedTaskIdsInWindow.map((taskId) => source.getTaskById(taskId));
  const allVisibleTasksSelected =
    visibleTaskIds.length > 0 && visibleTaskIds.every((taskId) => bulkSelectedTaskIdsInWindow.includes(taskId));
  const bulkCompletionLabel =
    bulkSelectedTasks.length > 0 && bulkSelectedTasks.every((task) => task.status === "completed")
      ? "Reopen selected"
      : "Complete selected";
  const bulkMoveTargetListId = bulkMoveListId || defaultTaskListId(source);
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
          <div className="grid gap-3">
            <Panel
              action={
                <div className="flex items-center gap-2">
                  {draft.mode === "edit" ? (
                    <IconButton
                      data-action-id="task.deleteSelected"
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
                bulkSelectedTaskIds={bulkSelectedTaskIdsInWindow}
                group={group}
                onBulkSelectTask={setTaskBulkSelected}
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
  actionId,
  active,
  children,
  onClick
}: {
  actionId: PlannerActionId;
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button
      aria-selected={active}
      data-action-id={actionId}
      onClick={onClick}
      role="tab"
      size="sm"
      variant={active ? "secondary" : "ghost"}
    >
      {children}
    </Button>
  );
}

function calendarViewActionId(viewId: CalendarViewId): PlannerActionId {
  return `calendar.view.${viewId}` as PlannerActionId;
}

const dayPlanningHours = Array.from({ length: 12 }, (_, index) => index + 7);
const calendarEventDragType = "application/x-hcb-calendar-event";
const calendarEventResizeDragType = "application/x-hcb-calendar-event-resize";

function hourSlotIso(day: string, hour: number): string {
  return `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

function hourSlotLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function eventOverlapsHour(event: CalendarEventViewModel, day: string, hour: number): boolean {
  const startsAt = Date.parse(hourSlotIso(day, hour));
  const endsAt = Date.parse(hourSlotIso(day, hour + 1));

  return Date.parse(event.startsAt) < endsAt && Date.parse(event.endsAt) > startsAt;
}

function startCalendarEventDrag(dragEvent: DragEvent<HTMLElement>, eventId: string): void {
  dragEvent.dataTransfer.effectAllowed = "move";
  dragEvent.dataTransfer.setData(calendarEventDragType, eventId);
  dragEvent.dataTransfer.setData("text/plain", eventId);
}

function startCalendarEventResizeDrag(dragEvent: DragEvent<HTMLElement>, eventId: string): void {
  dragEvent.stopPropagation();
  dragEvent.dataTransfer.effectAllowed = "move";
  dragEvent.dataTransfer.setData(calendarEventResizeDragType, eventId);
  dragEvent.dataTransfer.setData("text/plain", eventId);
}

function allowCalendarDrop(dragEvent: DragEvent<HTMLElement>): void {
  dragEvent.preventDefault();
  dragEvent.dataTransfer.dropEffect = "move";
}

function calendarEventDragId(dragEvent: DragEvent<HTMLElement>): string {
  return dragEvent.dataTransfer.getData(calendarEventDragType);
}

function calendarEventResizeDragId(dragEvent: DragEvent<HTMLElement>): string {
  return dragEvent.dataTransfer.getData(calendarEventResizeDragType);
}

function sameTimeOnDate(value: string, day: string): string {
  return `${day}T${value.slice(11)}`;
}

function visibleCalendarEvent(
  event: CalendarEventViewModel,
  visibleCalendarIds: ReadonlySet<string>
): boolean {
  return visibleCalendarIds.has(event.calendarId);
}

function DayView({
  onCreate,
  onMoveEvent,
  onOpen,
  onResizeEvent,
  visibleCalendarIds
}: {
  onCreate: (seed?: { startsAt?: string; allDay?: boolean }) => void;
  onMoveEvent: (eventId: string, startsAt: string, allDay: boolean) => void;
  onOpen: (event: CalendarEventViewModel) => void;
  onResizeEvent: (eventId: string, endsAt: string) => void;
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  const source = useCoreViewModelSource();
  const day = source.calendarDayView.id.slice("day-".length);

  return (
    <Panel
      action={
        <Button
          data-action-id="calendar.create"
          onClick={() => onCreate()}
          size="sm"
          title={actionDescription("calendar.create")}
          variant="primary"
        >
          <Plus aria-hidden="true" size={14} />
          {actionLabel("calendar.create")}
        </Button>
      }
      title="Day view"
      description={`${source.calendarDayView.weekday}, ${source.calendarDayView.dateLabel}`}
    >
      <div className="grid gap-2 p-3" role="grid" aria-label="Calendar day view">
        {dayPlanningHours.map((hour) => {
          const slotEvents = source.calendarDayView.events.filter(
            (event) =>
              visibleCalendarEvent(event, visibleCalendarIds) &&
              !event.allDay &&
              eventOverlapsHour(event, day, hour)
          );
          const label = hourSlotLabel(hour);
          const slotStart = hourSlotIso(day, hour);

          return (
            <div
              className="grid min-h-[72px] grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-hcbMd border border-border bg-bg-tertiary p-2"
              key={hour}
              onDragOver={allowCalendarDrop}
              onDrop={(dragEvent) => {
                dragEvent.preventDefault();
                const resizeEventId = calendarEventResizeDragId(dragEvent);

                if (resizeEventId) {
                  onResizeEvent(resizeEventId, slotStart);
                  return;
                }

                const eventId = calendarEventDragId(dragEvent);

                if (eventId) {
                  onMoveEvent(eventId, slotStart, false);
                }
              }}
              role="row"
            >
              <button
                aria-label={`Create event at ${label}`}
                className="font-mono text-[var(--text-xs)] text-text-muted hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                data-action-id="calendar.create"
                onClick={() => onCreate({ startsAt: hourSlotIso(day, hour), allDay: false })}
                type="button"
              >
                {label}
              </button>
              <div className="grid content-start gap-1" role="gridcell">
                {slotEvents.length > 0 ? (
                  slotEvents.map((event) => (
                    <div
                      className="grid grid-cols-[minmax(0,1fr)_24px] gap-1"
                      key={event.id}
                    >
                      <button
                        className="truncate rounded-hcbSm border border-border bg-surface-0 px-2 py-1 text-left text-[var(--text-xs)] text-text-secondary transition-colors duration-fast ease-hcb hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        draggable
                        onClick={() => onOpen(event)}
                        onDragStart={(dragEvent) => startCalendarEventDrag(dragEvent, event.id)}
                        type="button"
                      >
                        {event.rangeLabel} {event.title}
                      </button>
                      <span
                        aria-label={`Resize ${event.title} end`}
                        className="flex h-7 cursor-ns-resize items-center justify-center rounded-hcbSm border border-border bg-surface-0 text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        draggable
                        onDragStart={(dragEvent) => startCalendarEventResizeDrag(dragEvent, event.id)}
                        onKeyDown={(keyEvent) => {
                          keyEvent.stopPropagation();
                          handleActivationKeyDown(keyEvent, () =>
                            onResizeEvent(
                              event.id,
                              new Date(Date.parse(event.endsAt) + 15 * 60 * 1000).toISOString()
                            )
                          );
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <StepForward aria-hidden="true" size={12} />
                      </span>
                    </div>
                  ))
                ) : (
                  <button
                    className="min-h-9 rounded-hcbSm border border-dashed border-border text-left text-[var(--text-sm)] text-text-muted transition-colors duration-fast ease-hcb hover:bg-surface-0 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    data-action-id="calendar.create"
                    onClick={() => onCreate({ startsAt: hourSlotIso(day, hour), allDay: false })}
                    type="button"
                  >
                    Open slot
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function WeekView({
  onCreate,
  onMoveEvent,
  onOpen,
  visibleCalendarIds
}: {
  onCreate: (seed?: { startsAt?: string; allDay?: boolean }) => void;
  onMoveEvent: (eventId: string, startsAt: string, allDay: boolean) => void;
  onOpen: (event: CalendarEventViewModel) => void;
  visibleCalendarIds: ReadonlySet<string>;
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
            onDragOver={allowCalendarDrop}
            onDrop={(dragEvent) => {
              dragEvent.preventDefault();
              const eventId = calendarEventDragId(dragEvent);
              const draggedEvent = eventId ? source.calendarEventsById[eventId] : undefined;

              if (!draggedEvent) {
                return;
              }

              const dayKey = day.id.slice("week-".length);

              onMoveEvent(
                draggedEvent.id,
                draggedEvent.allDay
                  ? `${dayKey}T00:00:00.000Z`
                  : sameTimeOnDate(draggedEvent.startsAt, dayKey),
                draggedEvent.allDay
              );
            }}
            onKeyDown={(event) =>
              handleActivationKeyDown(event, () =>
                onCreate({ startsAt: `${day.id.slice("week-".length)}T00:00:00.000Z`, allDay: true })
              )
            }
            role="gridcell"
            tabIndex={0}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--text-xs)] font-medium text-text-muted">{day.weekday}</span>
              <span className="text-[var(--text-md)] font-semibold text-text-primary">{day.dateLabel}</span>
            </div>
            <div className="mt-2 grid gap-1">
              {day.events.filter((event) => visibleCalendarEvent(event, visibleCalendarIds)).slice(0, 3).map((calendarEvent) => (
                <span
                  className="cursor-grab truncate rounded-hcbSm border border-border bg-surface-0 px-2 py-1 text-[var(--text-xs)] text-text-secondary active:cursor-grabbing"
                  draggable
                  key={calendarEvent.id}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    onOpen(calendarEvent);
                  }}
                  onDragStart={(dragEvent) => startCalendarEventDrag(dragEvent, calendarEvent.id)}
                  onKeyDown={(keyEvent) => {
                    keyEvent.stopPropagation();
                    handleActivationKeyDown(keyEvent, () => onOpen(calendarEvent));
                  }}
                  role="button"
                  tabIndex={0}
                >
                  {calendarEvent.timeLabel} {calendarEvent.title}
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
  onOpen,
  visibleCalendarIds
}: {
  onCreate: (seed?: { startsAt?: string; allDay?: boolean }) => void;
  onOpen: (event: CalendarEventViewModel) => void;
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  const source = useCoreViewModelSource();

  return (
    <Panel title="Month view" description="Cached event range by day">
      <div className="grid gap-1 p-3" role="grid" aria-label="Calendar month view">
        {source.calendarMonthWeeks.map((week) => (
          <div className="grid grid-cols-7 gap-1" key={week.id} role="row">
            {week.days.map((day) => {
              const firstVisibleEvent = day.events.find((event) =>
                visibleCalendarEvent(event, visibleCalendarIds)
              );

              return (
                <div
                  className={cx(
                    "min-h-20 rounded-hcbSm border border-border bg-bg-tertiary p-2 text-left transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    day.isToday && "border-accent",
                    day.isOutsideMonth && "opacity-55"
                  )}
                  key={day.id}
                  onClick={() => onCreate({ startsAt: `${day.id.slice("month-".length)}T00:00:00.000Z`, allDay: true })}
                  onKeyDown={(event) =>
                    handleActivationKeyDown(event, () =>
                      onCreate({ startsAt: `${day.id.slice("month-".length)}T00:00:00.000Z`, allDay: true })
                    )
                  }
                  role="gridcell"
                  tabIndex={0}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--text-xs)] text-text-muted">{day.weekday}</span>
                    <span className="text-[var(--text-sm)] font-semibold text-text-primary">{day.dateLabel}</span>
                  </div>
                  {firstVisibleEvent ? (
                    <span
                      className="mt-2 block truncate rounded-hcbSm bg-surface-0 px-2 py-1 text-[var(--text-xs)] text-text-secondary"
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        onOpen(firstVisibleEvent);
                      }}
                      onKeyDown={(keyEvent) => {
                        keyEvent.stopPropagation();
                        handleActivationKeyDown(keyEvent, () => onOpen(firstVisibleEvent));
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      {firstVisibleEvent.title}
                    </span>
                  ) : null}
                </div>
              );
            })}
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
  const [calendarActionError, setCalendarActionError] = useState<string | undefined>();
  const [availabilityStartDate, setAvailabilityStartDate] = useState(() =>
    dateInputValue(startOfUtcDayIso(new Date()))
  );
  const [availabilityEndDate, setAvailabilityEndDate] = useState(() =>
    dateInputValue(addUtcDaysIso(startOfUtcDayIso(new Date()), 6))
  );
  const [availabilityCalendarIds, setAvailabilityCalendarIds] = useState<string[]>([]);
  const [availabilityText, setAvailabilityText] = useState("");
  const [availabilityError, setAvailabilityError] = useState<string | undefined>();
  const [availabilityBusyBlockCount, setAvailabilityBusyBlockCount] = useState<number | null>(null);
  const [availabilityPending, setAvailabilityPending] = useState(false);
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<string[]>([]);
  const calendarNavigationStartedAt = useRef<number | null>(null);
  const calendarVisibilityInitialized = useRef(false);
  const availableCalendarIds = useMemo(
    () => new Set(source.calendarSources.map((calendar) => calendar.id)),
    [source.calendarSources]
  );
  const visibleCalendarIdSet = useMemo(
    () => new Set(visibleCalendarIds.filter((calendarId) => availableCalendarIds.has(calendarId))),
    [availableCalendarIds, visibleCalendarIds]
  );
  const visibleCalendarEvents = useMemo(
    () =>
      source.calendarAgendaEvents.filter((event) =>
        visibleCalendarEvent(event, visibleCalendarIdSet)
      ),
    [source.calendarAgendaEvents, visibleCalendarIdSet]
  );
  const selectedAvailabilityCalendarIds = availabilityCalendarIds.filter((calendarId) =>
    availableCalendarIds.has(calendarId)
  );
  const availabilityRange = dateRangeInputToInclusiveIsoRange(availabilityStartDate, availabilityEndDate);
  const canExportAvailability =
    selectedAvailabilityCalendarIds.length > 0 &&
    availabilityRange !== null &&
    Date.parse(availabilityRange.end) > Date.parse(availabilityRange.start) &&
    !availabilityPending;

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
    if (availabilityCalendarIds.length > 0 || source.calendarSources.length === 0) {
      return;
    }

    const selectedCalendarIds = source.calendarSources
      .filter((calendar) => calendar.selected)
      .map((calendar) => calendar.id);

    setAvailabilityCalendarIds(
      selectedCalendarIds.length > 0
        ? selectedCalendarIds
        : source.calendarSources.map((calendar) => calendar.id)
    );
  }, [availabilityCalendarIds.length, source.calendarSources]);

  useEffect(() => {
    if (source.calendarSources.length === 0) {
      setVisibleCalendarIds([]);
      calendarVisibilityInitialized.current = false;
      return;
    }

    if (!calendarVisibilityInitialized.current) {
      const selectedCalendarIds = source.calendarSources
        .filter((calendar) => calendar.selected)
        .map((calendar) => calendar.id);

      setVisibleCalendarIds(
        selectedCalendarIds.length > 0
          ? selectedCalendarIds
          : source.calendarSources.map((calendar) => calendar.id)
      );
      calendarVisibilityInitialized.current = true;
      return;
    }

    setVisibleCalendarIds((current) => {
      const next = current.filter((calendarId) => availableCalendarIds.has(calendarId));
      return next.length === current.length ? current : next;
    });
  }, [availableCalendarIds, source.calendarSources]);

  useEffect(() => {
    scheduleRendererFrame(() => {
      reportRendererTimingSince("calendar.navigate", calendarNavigationStartedAt.current, {
        view: activeViewId,
        eventCount: visibleCalendarEvents.length
      });
      calendarNavigationStartedAt.current = null;
    });
  }, [activeViewId, visibleCalendarEvents.length]);

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

  async function updateCalendarEventTime(
    request: Pick<CalendarEventUpdateRequest, "id" | "startsAt" | "endsAt" | "allDay">
  ): Promise<void> {
    const result = await window.hcb?.calendar.update(request);

    if (!result?.ok) {
      setCalendarActionError(result?.error.message ?? "Calendar event update failed.");
      return;
    }

    setCalendarActionError(undefined);
    source.refresh();
  }

  function moveCalendarEvent(eventId: string, startsAt: string, allDay: boolean): void {
    const event = source.calendarEventsById[eventId];

    if (!event) {
      return;
    }

    const durationMs = Math.max(5 * 60 * 1000, Date.parse(event.endsAt) - Date.parse(event.startsAt));
    const endsAt = allDay
      ? addUtcDaysIso(startsAt, Math.max(1, Math.round(durationMs / (24 * 60 * 60 * 1000))))
      : new Date(Date.parse(startsAt) + durationMs).toISOString();

    void updateCalendarEventTime({
      id: event.id,
      startsAt,
      endsAt,
      allDay
    });
  }

  function resizeCalendarEvent(eventId: string, endsAt: string): void {
    const event = source.calendarEventsById[eventId];

    if (!event || Date.parse(endsAt) <= Date.parse(event.startsAt)) {
      return;
    }

    void updateCalendarEventTime({
      id: event.id,
      endsAt
    });
  }

  function toggleAvailabilityCalendar(calendarId: string, selected: boolean): void {
    setAvailabilityCalendarIds((current) => {
      const next = new Set(current);

      if (selected) {
        next.add(calendarId);
      } else {
        next.delete(calendarId);
      }

      return Array.from(next);
    });
  }

  async function exportAvailability(): Promise<void> {
    if (!canExportAvailability || availabilityRange === null) {
      setAvailabilityError("Choose at least one calendar and a valid date range.");
      return;
    }

    setAvailabilityPending(true);
    setAvailabilityError(undefined);

    const result = await window.hcb?.calendar.exportAvailability({
      calendarIds: selectedAvailabilityCalendarIds,
      start: availabilityRange.start,
      end: availabilityRange.end,
      format: "text"
    });

    setAvailabilityPending(false);

    if (!result?.ok) {
      setAvailabilityError(result?.error.message ?? "Availability export failed.");
      return;
    }

    setAvailabilityText(result.data.text);
    setAvailabilityBusyBlockCount(result.data.busyBlockCount);
  }

  function copyAvailability(): void {
    if (!availabilityText) {
      return;
    }

    void navigator.clipboard?.writeText(availabilityText);
  }

  function toggleVisibleCalendar(calendarId: string, selected: boolean): void {
    setVisibleCalendarIds((current) => {
      const next = new Set(current);

      if (selected) {
        next.add(calendarId);
      } else {
        next.delete(calendarId);
      }

      return Array.from(next);
    });
  }

  function showAllCalendars(): void {
    setVisibleCalendarIds(source.calendarSources.map((calendar) => calendar.id));
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2" role="tablist" aria-label="Calendar views">
          {(["agenda", "day", "week", "month"] as CalendarViewId[]).map((viewId) => (
            <CalendarTabButton
              actionId={calendarViewActionId(viewId)}
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
          <Button
            data-action-id="calendar.create"
            onClick={() => openCreate()}
            size="sm"
            title={actionDescription("calendar.create")}
            variant="primary"
          >
            <Plus aria-hidden="true" size={14} />
            {actionLabel("calendar.create")}
          </Button>
          <Badge tone={source.syncStatus.pendingMutationCount > 0 ? "warning" : "accent"}>
            {source.syncStatus.pendingMutationCount > 0
              ? `${source.syncStatus.pendingMutationCount} pending`
              : `Visible calendars: ${visibleCalendarIdSet.size}`}
          </Badge>
          <Badge tone="neutral">
            UTC
          </Badge>
        </div>
      </div>

      {calendarActionError ? (
        <StatusBanner
          action={
            <IconButton
              icon={X}
              label="Dismiss calendar interaction error"
              onClick={() => setCalendarActionError(undefined)}
              variant="ghost"
            />
          }
          description={calendarActionError}
          icon={AlertTriangle}
          title="Calendar interaction not saved"
          tone="warning"
        />
      ) : null}

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
            <Panel
              action={
                <Button
                  disabled={visibleCalendarIdSet.size === source.calendarSources.length}
                  onClick={showAllCalendars}
                  size="sm"
                  variant="ghost"
                >
                  Show all
                </Button>
              }
              title="Calendar visibility"
              description={`${visibleCalendarIdSet.size}/${source.calendarSources.length} shown, times shown in UTC`}
            >
              <div className="grid gap-2 p-3" role="group" aria-label="Calendar visibility">
                {source.calendarSources.map((calendar) => (
                  <label
                    className="flex min-h-9 items-center gap-2 rounded-hcbMd border border-border bg-bg-tertiary px-3 text-[var(--text-sm)] text-text-secondary"
                    key={calendar.id}
                  >
                    <input
                      checked={visibleCalendarIdSet.has(calendar.id)}
                      className="accent-[var(--color-accent)]"
                      onChange={(event) => toggleVisibleCalendar(calendar.id, event.target.checked)}
                      type="checkbox"
                    />
                    <CalendarDays aria-hidden="true" className="text-accent" size={16} />
                    <span className="min-w-0 flex-1 truncate">{calendar.title}</span>
                    <Badge tone="neutral">{calendar.timeZone ?? "UTC"}</Badge>
                  </label>
                ))}
                {source.calendarSources.length === 0 ? (
                  <EmptyState
                    description="No calendars have been cached yet."
                    title="No calendars"
                  />
                ) : null}
              </div>
            </Panel>
            <Panel
              action={
                <Button
                  disabled={!canExportAvailability}
                  onClick={() => void exportAvailability()}
                  size="sm"
                  variant="primary"
                >
                  <Copy aria-hidden="true" size={14} />
                  Generate
                </Button>
              }
              title="Share availability"
              description={`${selectedAvailabilityCalendarIds.length} calendars`}
            >
              <div className="grid gap-3 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    aria-label="Availability start"
                    onChange={(event) => setAvailabilityStartDate(event.target.value)}
                    type="date"
                    value={availabilityStartDate}
                  />
                  <Input
                    aria-label="Availability end"
                    min={availabilityStartDate || undefined}
                    onChange={(event) => setAvailabilityEndDate(event.target.value)}
                    type="date"
                    value={availabilityEndDate}
                  />
                </div>
                <div className="grid gap-2" role="group" aria-label="Availability calendars">
                  {source.calendarSources.map((calendar) => (
                    <label
                      className="flex min-h-8 items-center gap-2 text-[var(--text-sm)] text-text-secondary"
                      key={calendar.id}
                    >
                      <input
                        checked={selectedAvailabilityCalendarIds.includes(calendar.id)}
                        className="accent-[var(--color-accent)]"
                        onChange={(event) =>
                          toggleAvailabilityCalendar(calendar.id, event.target.checked)
                        }
                        type="checkbox"
                      />
                      <span className="min-w-0 flex-1 truncate">{calendar.title}</span>
                    </label>
                  ))}
                </div>
                {availabilityError ? (
                  <ErrorState description={availabilityError} title="Availability not generated" />
                ) : null}
                {availabilityText ? (
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone="accent">
                        {availabilityBusyBlockCount ?? 0} busy blocks
                      </Badge>
                      <IconButton
                        icon={Copy}
                        label="Copy availability"
                        onClick={copyAvailability}
                        variant="ghost"
                      />
                    </div>
                    <textarea
                      aria-label="Availability export"
                      className="min-h-32 w-full resize-none rounded-hcbMd border border-border bg-surface-0 px-3 py-2 font-mono text-[var(--text-sm)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      readOnly
                      value={availabilityText}
                    />
                  </div>
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
              items={visibleCalendarEvents}
              performanceLabel="calendar.agenda"
              renderRow={(event) => <EventRow event={event} onOpen={openEdit} />}
              viewportHeight={352}
            />
          </Panel>
        ) : null}
        {activeViewId === "day" ? (
          <DayView
            onCreate={openCreate}
            onMoveEvent={moveCalendarEvent}
            onOpen={openEdit}
            onResizeEvent={resizeCalendarEvent}
            visibleCalendarIds={visibleCalendarIdSet}
          />
        ) : null}
        {activeViewId === "week" ? (
          <WeekView
            onCreate={openCreate}
            onMoveEvent={moveCalendarEvent}
            onOpen={openEdit}
            visibleCalendarIds={visibleCalendarIdSet}
          />
        ) : null}
        {activeViewId === "month" ? (
          <MonthView
            onCreate={openCreate}
            onOpen={openEdit}
            visibleCalendarIds={visibleCalendarIdSet}
          />
        ) : null}
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

function normalizedNoteTitle(title: string): string {
  return title.trim().toLowerCase();
}

function extractNoteLinks(body: string): string[] {
  const links = new Set<string>();
  const pattern = /\[\[([^\]]{1,160})\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(body)) !== null) {
    const title = match[1]?.trim();

    if (title) {
      links.add(title);
    }
  }

  return Array.from(links);
}

type PlannerLinkKind = "note" | "task" | "event";

interface PlannerLinkReference {
  kind: PlannerLinkKind;
  label: string;
  raw: string;
}

interface NoteProperty {
  key: string;
  value: string;
}

function parsePlannerLink(raw: string): PlannerLinkReference {
  const [maybeKind, ...rest] = raw.split(":");
  const kind = maybeKind.toLowerCase();

  if ((kind === "note" || kind === "task" || kind === "event") && rest.length > 0) {
    return {
      kind,
      label: rest.join(":").trim(),
      raw
    };
  }

  return {
    kind: "note",
    label: raw.trim(),
    raw
  };
}

function extractNoteProperties(body: string): NoteProperty[] {
  const supportedKeys = new Set(["status", "tags", "project", "date", "source"]);
  const properties: NoteProperty[] = [];

  for (const line of body.split(/\r?\n/).slice(0, 12)) {
    const match = /^([a-zA-Z][\w-]{1,24}):\s*(.+)$/.exec(line.trim());

    if (!match) {
      continue;
    }

    const key = match[1].toLowerCase();
    const value = match[2].trim();

    if (supportedKeys.has(key) && value) {
      properties.push({ key, value });
    }
  }

  return properties;
}

function renderInlineNoteLinks(
  value: string,
  onOpenNoteLink: (title: string) => void
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\[\[([^\]]{1,160})\]\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    const title = match[1]?.trim() ?? "";
    const link = parsePlannerLink(title);

    if (match.index > cursor) {
      nodes.push(value.slice(cursor, match.index));
    }

    nodes.push(link.kind === "note" ? (
      <button
        className="rounded-hcbSm px-1 text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        key={`${title}-${match.index}`}
        onClick={() => onOpenNoteLink(link.label)}
        type="button"
      >
        {link.label}
      </button>
    ) : (
      <span
        className="inline-flex rounded-hcbSm border border-border bg-bg-tertiary px-1 text-text-secondary"
        key={`${title}-${match.index}`}
      >
        {link.kind}: {link.label}
      </span>
    ));
    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) {
    nodes.push(value.slice(cursor));
  }

  return nodes.length > 0 ? nodes : [value];
}

function MarkdownPreview({
  body,
  onOpenNoteLink
}: {
  body: string;
  onOpenNoteLink: (title: string) => void;
}): JSX.Element {
  const lines = body.split(/\r?\n/);

  if (body.trim().length === 0) {
    return <EmptyState description="This note has no body yet." title="Empty note" />;
  }

  return (
    <div
      aria-label="Note preview"
      className="grid min-h-[260px] content-start gap-2 rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-base)] text-text-primary"
      role="region"
    >
      {lines.map((line, index) => {
        const trimmed = line.trim();

        if (!trimmed) {
          return <div aria-hidden="true" className="h-2" key={`blank-${index}`} />;
        }

        const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
        if (heading) {
          const level = heading[1].length;
          const className =
            level === 1
              ? "text-[var(--text-xl)] font-semibold"
              : level === 2
                ? "text-[var(--text-lg)] font-semibold"
                : "text-[var(--text-md)] font-semibold";

          return (
            <div className={className} key={`heading-${index}`}>
              {renderInlineNoteLinks(heading[2], onOpenNoteLink)}
            </div>
          );
        }

        const taskItem = /^[-*]\s+\[( |x|X)\]\s+(.+)$/.exec(trimmed);
        if (taskItem) {
          const checked = taskItem[1].toLowerCase() === "x";

          return (
            <div className="flex items-start gap-2" key={`task-${index}`}>
              <input
                checked={checked}
                className="mt-1 accent-[var(--color-accent)]"
                readOnly
                type="checkbox"
              />
              <span className={cx("min-w-0", checked && "text-text-muted line-through")}>
                {renderInlineNoteLinks(taskItem[2], onOpenNoteLink)}
              </span>
            </div>
          );
        }

        const listItem = /^[-*]\s+(.+)$/.exec(trimmed);
        if (listItem) {
          return (
            <div className="flex items-start gap-2" key={`list-${index}`}>
              <span className="text-text-muted">-</span>
              <span className="min-w-0">{renderInlineNoteLinks(listItem[1], onOpenNoteLink)}</span>
            </div>
          );
        }

        const quote = /^>\s+(.+)$/.exec(trimmed);
        if (quote) {
          return (
            <blockquote
              className="border-l-2 border-accent pl-3 text-text-secondary"
              key={`quote-${index}`}
            >
              {renderInlineNoteLinks(quote[1], onOpenNoteLink)}
            </blockquote>
          );
        }

        return <p key={`paragraph-${index}`}>{renderInlineNoteLinks(trimmed, onOpenNoteLink)}</p>;
      })}
    </div>
  );
}

function NotesView(): JSX.Element {
  const source = useCoreViewModelSource();
  const [notes, setNotes] = useState<NoteViewModel[]>(source.initialNotes);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    source.initialNotes[0]?.id ?? null
  );
  const [noteViewMode, setNoteViewMode] = useState<"edit" | "preview">("edit");
  const [plannerLinkTarget, setPlannerLinkTarget] = useState("");
  const [draftCounter, setDraftCounter] = useState(1);
  const requestedNoteDetails = useRef(new Set<string>());
  const lastNoteEditReportAt = useRef(0);
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
  const noteByNormalizedTitle = useMemo(
    () => new Map(notes.map((note) => [normalizedNoteTitle(note.title), note])),
    [notes]
  );
  const selectedNoteLinks = selectedNote ? extractNoteLinks(selectedNote.body) : [];
  const selectedNoteProperties = selectedNote ? extractNoteProperties(selectedNote.body) : [];
  const selectedNoteBacklinks = selectedNote
    ? notes.filter(
        (note) =>
          note.id !== selectedNote.id &&
          extractNoteLinks(note.body).some(
            (title) => normalizedNoteTitle(title) === normalizedNoteTitle(selectedNote.title)
          )
      )
    : [];

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

  useEffect(() => {
    for (const note of notes) {
      if (
        note.id === selectedNote?.id ||
        note.id.startsWith("note-draft-") ||
        requestedNoteDetails.current.has(note.id)
      ) {
        continue;
      }

      requestedNoteDetails.current.add(note.id);
      void window.hcb?.notes.get({ id: note.id }).then((result) => {
        if (!result?.ok) {
          return;
        }

        setNotes((current) =>
          current.map((currentNote) =>
            currentNote.id === result.data.id
              ? {
                  id: result.data.id,
                  title: result.data.title,
                  body: result.data.body,
                  preview: result.data.preview,
                  updatedLabel: currentNote.updatedLabel
                }
              : currentNote
          )
        );
      });
    }
  }, [notes, selectedNote?.id]);

  useEffect(() => {
    function handleNoteCommand(event: Event): void {
      const detail = (event as CustomEvent<{ action: string }>).detail;

      if (detail?.action === "new-note") {
        void createNote();
      }
    }

    window.addEventListener("hcb:note-command", handleNoteCommand);
    return () => window.removeEventListener("hcb:note-command", handleNoteCommand);
  });

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

  async function createNoteWithTemplate(title: string, body: string): Promise<void> {
    const fallbackId = `note-draft-${draftCounter}`;
    const fallbackNote: NoteViewModel = {
      id: fallbackId,
      title,
      body,
      preview: buildPreview(body),
      updatedLabel: "Just now"
    };

    setDraftCounter((current) => current + 1);
    setNotes((current) => [fallbackNote, ...current]);
    setSelectedNoteId(fallbackId);
    setNoteViewMode("edit");

    const result = await window.hcb?.notes.create({ title, body });

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

  function createDailyNote(): void {
    const today = dateInputValue(new Date().toISOString());
    void createNoteWithTemplate(
      `Daily ${today}`,
      `status: open\ntags: daily\ndate: ${today}\n\n# Daily ${today}\n- [ ] Review calendar\n- [ ] Triage inbox\n`
    );
  }

  function createMeetingNote(): void {
    const today = dateInputValue(new Date().toISOString());
    void createNoteWithTemplate(
      `Meeting ${today}`,
      `status: draft\ntags: meeting\ndate: ${today}\n\n# Meeting ${today}\nAttendees:\n\nNotes:\n\nDecisions:\n- \n`
    );
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

  function openNoteLink(title: string): void {
    const linkedNote = noteByNormalizedTitle.get(normalizedNoteTitle(title));

    if (linkedNote) {
      setSelectedNoteId(linkedNote.id);
    }
  }

  function insertPlannerLink(): void {
    if (!selectedNote || !plannerLinkTarget) {
      return;
    }

    const suffix = selectedNote.body.endsWith("\n") || selectedNote.body.length === 0 ? "" : "\n";
    updateSelectedNote({ body: `${selectedNote.body}${suffix}[[${plannerLinkTarget}]]` });
  }

  return (
    <SectionChrome
      title="Notes"
      sidebar={
        <div className="grid gap-3">
          <Panel
            action={
              <Button
                data-action-id="note.create"
                onClick={createNote}
                size="sm"
                title={actionDescription("note.create")}
                variant="primary"
              >
                <Plus aria-hidden="true" size={14} />
                {actionLabel("note.create")}
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
          <Panel title="Planner links" description="Insert local note, task, or event links">
            <div className="grid gap-3 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={createDailyNote} size="sm" variant="secondary">
                  <CalendarPlus aria-hidden="true" size={14} />
                  Daily note
                </Button>
                <Button onClick={createMeetingNote} size="sm" variant="ghost">
                  <Pencil aria-hidden="true" size={14} />
                  Meeting note
                </Button>
              </div>
              <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
                <span>Link target</span>
                <select
                  aria-label="Planner link target"
                  className={settingsSelectClass}
                  disabled={!selectedNote}
                  onChange={(event) => setPlannerLinkTarget(event.target.value)}
                  value={plannerLinkTarget}
                >
                  <option value="">Choose local target</option>
                  {notes.map((note) => (
                    <option key={`note-${note.id}`} value={note.title}>
                      Note - {note.title}
                    </option>
                  ))}
                  {source.largeTaskWindow.slice(0, 20).map((task) => (
                    <option key={`task-${task.id}`} value={`task:${task.title}`}>
                      Task - {task.title}
                    </option>
                  ))}
                  {source.calendarAgendaEvents.slice(0, 20).map((event) => (
                    <option key={`event-${event.id}`} value={`event:${event.title}`}>
                      Event - {event.title}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                disabled={!selectedNote || !plannerLinkTarget}
                onClick={insertPlannerLink}
                size="sm"
                variant="primary"
              >
                <Plus aria-hidden="true" size={14} />
                Insert link
              </Button>
            </div>
          </Panel>
          <Panel
            title="Note links"
            description={
              selectedNote
                ? `${selectedNoteLinks.length} outgoing, ${selectedNoteBacklinks.length} backlinks`
                : "No note"
            }
          >
            {selectedNote ? (
              <div className="grid gap-3 p-3">
                <div className="grid gap-2">
                  <div className="text-[var(--text-xs)] font-semibold uppercase text-text-muted">
                    Links
                  </div>
                  {selectedNoteLinks.length > 0 ? (
                    selectedNoteLinks.map((title) => {
                      const link = parsePlannerLink(title);
                      const linkedNote = link.kind === "note"
                        ? noteByNormalizedTitle.get(normalizedNoteTitle(link.label))
                        : undefined;

                      return linkedNote ? (
                        <Button
                          aria-label={`Open linked note ${linkedNote.title}`}
                          key={title}
                          onClick={() => setSelectedNoteId(linkedNote.id)}
                          size="sm"
                          variant="ghost"
                        >
                          <Search aria-hidden="true" size={14} />
                          {linkedNote.title}
                        </Button>
                      ) : (
                        <Badge key={title} tone={link.kind === "note" ? "warning" : "accent"}>
                          {link.kind === "note" ? "Broken" : link.kind}: {link.label}
                        </Badge>
                      );
                    })
                  ) : (
                    <span className="text-[var(--text-sm)] text-text-muted">None</span>
                  )}
                </div>
                <div className="grid gap-2">
                  <div className="text-[var(--text-xs)] font-semibold uppercase text-text-muted">
                    Backlinks
                  </div>
                  {selectedNoteBacklinks.length > 0 ? (
                    selectedNoteBacklinks.map((note) => (
                      <Button
                        aria-label={`Open backlink ${note.title}`}
                        key={note.id}
                        onClick={() => setSelectedNoteId(note.id)}
                        size="sm"
                        variant="ghost"
                      >
                        <RotateCcw aria-hidden="true" size={14} />
                        {note.title}
                      </Button>
                    ))
                  ) : (
                    <span className="text-[var(--text-sm)] text-text-muted">None</span>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState description="Select a note to inspect links." title="No note selected" />
            )}
          </Panel>
          <Panel
            title="Note properties"
            description={selectedNote ? `${selectedNoteProperties.length} inferred` : "No note"}
          >
            {selectedNote ? (
              selectedNoteProperties.length > 0 ? (
                <div className="flex flex-wrap gap-2 p-3">
                  {selectedNoteProperties.map((property) => (
                    <Badge key={`${property.key}-${property.value}`} tone="info">
                      {property.key}: {property.value}
                    </Badge>
                  ))}
                </div>
              ) : (
                <EmptyState
                  description="Add lines like status:, tags:, project:, date:, or source: near the top of the note."
                  title="No properties"
                />
              )
            ) : (
              <EmptyState description="Select a note to inspect properties." title="No note selected" />
            )}
          </Panel>
        </div>
      }
    >
      <Panel
        action={
          <div className="flex items-center gap-2">
            <Button
              disabled={!selectedNote}
              onClick={() => setNoteViewMode("edit")}
              size="sm"
              variant={noteViewMode === "edit" ? "secondary" : "ghost"}
            >
              <Pencil aria-hidden="true" size={14} />
              Edit
            </Button>
            <Button
              disabled={!selectedNote}
              onClick={() => setNoteViewMode("preview")}
              size="sm"
              variant={noteViewMode === "preview" ? "secondary" : "ghost"}
            >
              <Search aria-hidden="true" size={14} />
              Preview
            </Button>
            <IconButton
              disabled={!selectedNote}
              icon={Trash2}
              label="Delete selected note"
              onClick={deleteSelectedNote}
              variant="danger"
            />
          </div>
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
            {noteViewMode === "edit" ? (
              <textarea
                aria-label="Note body"
                className="min-h-[260px] w-full resize-none rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-base)] text-text-primary placeholder:text-text-muted transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onBlur={() => void persistSelectedNote()}
                onChange={(event) => updateSelectedNote({ body: event.target.value })}
                value={selectedNote.body}
              />
            ) : (
              <MarkdownPreview body={selectedNote.body} onOpenNoteLink={openNoteLink} />
            )}
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

function defaultSavedSearchName(query: string, existingCount: number): string {
  const textTerms = query
    .split(/\s+/)
    .filter((token) => token.length > 0 && !token.includes(":"))
    .slice(0, 4)
    .join(" ");

  if (textTerms) {
    return textTerms.length > 42 ? `${textTerms.slice(0, 39)}...` : textTerms;
  }

  return `Saved search ${existingCount + 1}`;
}

function nextSavedSearchViews(
  current: readonly SavedSearchView[],
  view: SavedSearchView
): SavedSearchView[] {
  const withoutMatchingQuery = current.filter(
    (savedView) => savedView.query.trim() !== view.query.trim()
  );

  return [view, ...withoutMatchingQuery].slice(0, 20);
}

function SearchView({
  query,
  setQuery
}: {
  query: string;
  setQuery: (query: string) => void;
}): JSX.Element {
  const source = useCoreViewModelSource();
  const search = useLocalSearch(query);
  const searchViewModel = search.viewModel;
  const [savedSearchName, setSavedSearchName] = useState("");
  const trimmedQuery = query.trim();
  const matchingSavedSearch = source.settings.savedSearchViews.find(
    (view) => view.query.trim() === trimmedQuery
  );
  const canSaveSearch =
    trimmedQuery.length > 0 &&
    search.parsed.errors.length === 0 &&
    !matchingSavedSearch &&
    !source.settingsMutationPending;

  async function saveSearchView(): Promise<void> {
    if (!canSaveSearch) {
      return;
    }

    const now = new Date().toISOString();
    const view: SavedSearchView = {
      id: `search-${Date.now()}`,
      name: savedSearchName.trim() || defaultSavedSearchName(trimmedQuery, source.settings.savedSearchViews.length),
      query: trimmedQuery,
      createdAt: now,
      updatedAt: now
    };
    const saved = await source.updateSettings({
      savedSearchViews: nextSavedSearchViews(source.settings.savedSearchViews, view)
    });

    if (saved) {
      setSavedSearchName("");
    }
  }

  function deleteSearchView(viewId: string): void {
    void source.updateSettings({
      savedSearchViews: source.settings.savedSearchViews.filter((view) => view.id !== viewId)
    });
  }

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

      {search.parsed.chips.length > 0 ? (
        <div aria-label="Parsed search filters" className="flex flex-wrap gap-2">
          {search.parsed.chips.map((chip) => (
            <Badge key={chip.id} tone="accent">
              {chip.label}: {chip.value}
            </Badge>
          ))}
        </div>
      ) : null}

      {search.parsed.errors.length > 0 ? (
        <div
          aria-live="polite"
          className="rounded-hcbMd border border-warning bg-bg-secondary px-3 py-2 text-[var(--text-sm)] text-warning"
          role="alert"
        >
          {search.parsed.errors[0]?.message ?? "Invalid search query."}
        </div>
      ) : null}

      <Panel
        action={
          <Button
            disabled={!canSaveSearch}
            onClick={() => void saveSearchView()}
            size="sm"
            variant="primary"
          >
            <Save aria-hidden="true" size={14} />
            Save search
          </Button>
        }
        title="Saved searches"
        description={`${source.settings.savedSearchViews.length} local views`}
      >
        <div className="grid gap-3 p-3">
          <Input
            aria-label="Saved search name"
            disabled={trimmedQuery.length === 0}
            onChange={(event) => setSavedSearchName(event.target.value)}
            placeholder={trimmedQuery ? defaultSavedSearchName(trimmedQuery, source.settings.savedSearchViews.length) : "Name current query"}
            value={savedSearchName}
          />
          {matchingSavedSearch ? (
            <StatusBanner
              description={matchingSavedSearch.query}
              title={`${matchingSavedSearch.name} is saved`}
              tone="success"
            />
          ) : null}
          {source.settings.savedSearchViews.length > 0 ? (
            <div className="grid gap-2" role="list" aria-label="Saved search views">
              {source.settings.savedSearchViews.map((view) => (
                <div
                  className="grid grid-cols-[minmax(0,1fr)_32px] gap-2"
                  key={view.id}
                  role="listitem"
                >
                  <button
                    className="min-w-0 rounded-hcbMd border border-border bg-bg-tertiary px-3 py-2 text-left transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    onClick={() => setQuery(view.query)}
                    type="button"
                  >
                    <span className="block truncate text-[var(--text-sm)] font-medium text-text-primary">
                      {view.name}
                    </span>
                    <span className="block truncate font-mono text-[var(--text-xs)] text-text-muted">
                      {view.query}
                    </span>
                  </button>
                  <IconButton
                    icon={Trash2}
                    label={`Delete saved search ${view.name}`}
                    onClick={() => deleteSearchView(view.id)}
                    variant="danger"
                  />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              description="Save structured local searches once their filters are useful."
              title="No saved searches"
            />
          )}
        </div>
      </Panel>

      <Panel
        action={<Badge tone={searchViewModel.state === "results" ? "success" : "neutral"}>{searchViewModel.summary}</Badge>}
        title="Search results"
        description={
          search.state === "invalid"
            ? "Fix filter syntax to refresh local results"
            : search.state === "stale"
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
  const googleStatus = source.googleStatus;
  const [googleClientId, setGoogleClientId] = useState(googleStatus.clientId ?? "");
  const [googleClientSecret, setGoogleClientSecret] = useState("");

  useEffect(() => {
    setGoogleClientId(googleStatus.clientId ?? "");
  }, [googleStatus.clientId]);

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
    if (action === "refresh" || action === "resetOnboarding") {
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

  async function saveGoogleOAuthClient(): Promise<void> {
    setRecoveryMessage(null);

    if (!window.hcb) {
      return;
    }

    const request =
      googleClientSecret.trim().length > 0
        ? { clientId: googleClientId, clientSecret: googleClientSecret.trim() }
        : { clientId: googleClientId };
    const result = await window.hcb.google.saveOAuthClient(request);

    if (result.ok) {
      setGoogleClientSecret("");
      setRecoveryMessage("Google OAuth client configuration saved.");
      source.setGoogleStatus(result.data);
      return;
    }

    setRecoveryMessage(result.error.message);
  }

  async function beginGoogleOAuth(): Promise<void> {
    setRecoveryMessage(null);

    const result = await window.hcb?.google.beginOAuth();

    if (result?.ok) {
      setRecoveryMessage(result.data.message);
      source.refreshGoogleStatus();
      for (const delayMs of [2_000, 5_000, 10_000]) {
        window.setTimeout(() => source.refreshGoogleStatus(), delayMs);
      }
      return;
    }

    if (result && !result.ok) {
      setRecoveryMessage(result.error.message);
    }
  }

  async function disconnectGoogle(): Promise<void> {
    setRecoveryMessage(null);

    const result = await window.hcb?.google.disconnect();

    if (result?.ok) {
      setRecoveryMessage("Google account disconnected.");
      source.setGoogleStatus(result.data);
      return;
    }

    if (result && !result.ok) {
      setRecoveryMessage(result.error.message);
    }
  }

  function renderSectionControls(): JSX.Element {
    if (selectedSection.id === "google") {
      return (
        <div className="grid gap-3 p-3">
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span>Desktop OAuth client ID</span>
            <Input
              aria-label="Google OAuth client ID"
              onChange={(event) => setGoogleClientId(event.currentTarget.value)}
              placeholder="Client ID from Google Cloud Console"
              value={googleClientId}
            />
          </label>
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span>Client secret</span>
            <Input
              aria-label="Google OAuth client secret"
              onChange={(event) => setGoogleClientSecret(event.currentTarget.value)}
              placeholder={googleStatus.hasClientSecret ? "Stored in Keychain" : "Optional for Desktop clients"}
              type="password"
              value={googleClientSecret}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={googleClientId.trim().length < 10 || source.settingsMutationPending}
              onClick={() => void saveGoogleOAuthClient()}
            >
              <Save aria-hidden="true" size={14} />
              Save client
            </Button>
            <Button
              disabled={!googleStatus.oauthClientConfigured}
              onClick={() => void beginGoogleOAuth()}
              variant="secondary"
            >
              <CheckCircle2 aria-hidden="true" size={14} />
              Connect Google
            </Button>
            <Button
              disabled={!googleStatus.account}
              onClick={() => void disconnectGoogle()}
              variant="ghost"
            >
              Disconnect
            </Button>
          </div>
          <SettingsRows rows={selectedSection.rows} status={selectedSection.status} />
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
      const queue = diagnostics?.pendingMutations;

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
            <Button
              data-action-id="sync.refresh"
              disabled={source.settingsMutationPending}
              onClick={() => beginRecoveryAction("refresh")}
            >
              <RotateCcw aria-hidden="true" size={14} />
              Refresh
            </Button>
            <Button
              data-action-id="sync.forceFullResync"
              disabled={source.settingsMutationPending}
              onClick={() => beginRecoveryAction("forceFullResync")}
              variant="danger"
            >
              Force full resync
            </Button>
          </div>
          <div className="grid grid-cols-5 gap-2">
            <MetricTile label="Pending" value={String(queue?.pendingCount ?? source.syncStatus.pendingMutationCount)} />
            <MetricTile label="Applying" value={String(queue?.applyingCount ?? 0)} />
            <MetricTile label="Failed" value={String(queue?.failedCount ?? 0)} />
            <MetricTile label="Retryable" value={String(queue?.retryableCount ?? 0)} />
            <MetricTile label="Auth paused" value={String(queue?.authPausedCount ?? 0)} />
          </div>
          {queue?.nextRetryAt ? (
            <StatusBanner
              description={queue.nextRetryAt}
              title="Next retry scheduled"
              tone="info"
            />
          ) : null}
          {queue?.byResourceType.length ? (
            <div className="grid gap-2" role="list" aria-label="Sync queue resource types">
              {queue.byResourceType.map((bucket) => (
                <ListRow
                  key={bucket.resourceType}
                  title={bucket.resourceType}
                  description={`${bucket.count} queued mutation${bucket.count === 1 ? "" : "s"}`}
                  trailing={<Badge tone="warning">{bucket.count}</Badge>}
                />
              ))}
            </div>
          ) : null}
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
          <Button
            disabled={source.settingsMutationPending}
            onClick={() => beginRecoveryAction("resetOnboarding")}
            variant="secondary"
          >
            <RotateCcw aria-hidden="true" size={14} />
            Reset onboarding
          </Button>
          <StatusBanner
            description="Tasks and calendar mirrors are cached in local SQLite; OAuth secrets, Google tokens, and MCP bearer tokens stay in OS credential storage. Copy diagnostics omits raw payloads, credentials, note bodies, task notes, event descriptions, and guest lists."
            title="Privacy boundary"
            tone="info"
          />
        </div>
      );
    }

    if (selectedSection.id === "mcp") {
      return (
        <div className="grid gap-3 p-3">
          <SettingsToggle
            actionId="mcp.toggle"
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
      const nativeReport = diagnostics?.native;

      return (
        <div className="grid gap-3 p-3">
          <SettingsRows rows={selectedSection.rows} status={selectedSection.status} />
          {nativeReport?.capabilities.length ? (
            <div className="grid gap-2" role="list" aria-label="Native capabilities">
              {nativeReport.capabilities.map((capability) => (
                <ListRow
                  key={capability.key}
                  title={capability.label}
                  description={capability.message ?? (capability.supported ? "Available" : "Unavailable")}
                  trailing={
                    <Badge tone={capability.supported ? "success" : "warning"}>
                      {capability.state}
                    </Badge>
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState
              description="The sanitized native capability report has no per-feature rows yet."
              title="No capability rows"
            />
          )}
          {nativeReport?.diagnostics.length ? (
            <div className="grid gap-2" role="list" aria-label="Native diagnostics">
              {nativeReport.diagnostics.map((diagnostic) => (
                <ListRow
                  key={`${diagnostic.key}-${diagnostic.message}`}
                  title={diagnostic.key}
                  description={diagnostic.message}
                  trailing={<Badge tone={diagnostic.severity === "blocker" ? "danger" : "warning"}>{diagnostic.severity}</Badge>}
                />
              ))}
            </div>
          ) : null}
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
            <Button
              data-action-id="diagnostics.copy"
              onClick={copyDiagnostics}
              size="sm"
              title={actionDescription("diagnostics.copy")}
              variant="ghost"
            >
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

function notificationBadgeTone(tone: AppNotificationTone): "neutral" | "success" | "warning" | "danger" | "info" {
  if (tone === "success") {
    return "success";
  }

  if (tone === "danger") {
    return "danger";
  }

  if (tone === "warning" || tone === "offline") {
    return "warning";
  }

  return "info";
}

function NotificationsView(): JSX.Element {
  const source = useCoreViewModelSource();
  const appNotices = getAppNotifications(source);
  const notificationSection = source.settingsSections.find((section) => section.id === "notifications");

  function updateSettings(request: SettingsUpdateRequest): void {
    void source.updateSettings(request);
  }

  function requestNotificationPermission(): void {
    void window.hcb?.native.requestNotificationPermission().then(() => {
      source.refresh();
    });
  }

  return (
    <SectionChrome
      title="Notifications"
      sidebar={
        <Panel title="Local reminders" description={notificationSection?.status ?? "Not configured"}>
          <div className="grid gap-3 p-3">
            <SettingsToggle
              checked={source.settings.notificationsEnabled}
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
              defaultValue={String(source.settings.notificationLeadMinutes)}
              type="number"
            />
            <Button onClick={requestNotificationPermission} variant="ghost">
              Request permission
            </Button>
          </div>
        </Panel>
      }
    >
      <div className="grid gap-3">
        <Panel
          title="App notifications"
          description="Recent cache and action state"
        >
          {appNotices.length > 0 ? (
            <div role="list">
              {appNotices.map((notification) => (
                <ListRow
                  key={notification.id}
                  title={notification.title}
                  description={notification.description}
                  trailing={<Badge tone={notificationBadgeTone(notification.tone)}>{notification.status}</Badge>}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              description="App-level notices appear here after cache, settings, or task state changes."
              title="No app notifications"
            />
          )}
        </Panel>

        <Panel title="Delivery status" description="Local notification settings">
          <div className="grid grid-cols-3 gap-2 p-3">
            <MetricTile label="Enabled" value={source.settings.notificationsEnabled ? "On" : "Off"} />
            <MetricTile label="Lead time" value={`${source.settings.notificationLeadMinutes} min`} />
            <MetricTile
              label="Permission"
              value={notificationSection?.rows.find((row) => row.id === "permission")?.value ?? "Unknown"}
            />
          </div>
          {notificationSection ? (
            <SettingsRows rows={notificationSection.rows} status={notificationSection.status} />
          ) : null}
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
  actionId,
  checked,
  label,
  onChange
}: {
  actionId?: PlannerActionId;
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label
      className="flex min-h-9 items-center gap-2 rounded-hcbMd border border-border bg-bg-tertiary px-3 text-[var(--text-sm)] text-text-secondary"
      data-action-id={actionId}
    >
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

  if (activeSectionId === "notifications") {
    return <NotificationsView />;
  }

  if (activeSectionId === "settings") {
    return <SettingsView />;
  }

  return <TodayView />;
}
