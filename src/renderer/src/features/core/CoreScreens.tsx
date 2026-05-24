import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, DragEvent, KeyboardEvent, ReactNode, SetStateAction, UIEvent } from "react";
import type {
  CalendarEventCreateRequest,
  CalendarEventRecurrence,
  CalendarEventUpdateRequest,
  DiagnosticsSummaryResponse,
  NativeCapabilityDescriptor,
  NativeCapabilityDiagnostic,
  SavedSearchView,
  SavedTaskView,
  ScheduleSlot,
  SettingsRecoveryActionRequest,
  SettingsSnapshot,
  SettingsUpdateRequest,
  TaskCreateRequest,
  TaskUpdateRequest
} from "@shared/ipc/contracts";
import {
  appColorThemes,
  defaultAppColorTheme,
  resolveAppColorTheme,
  resolveAppThemeMode,
  type AppColorThemeId
} from "@shared/ipc/themeCatalog";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Flag,
  ListPlus,
  MapPin,
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
  Users,
  X
} from "lucide-react";
import { getPlannerAction, type PlannerActionId } from "../../actions/plannerActions";
import { useInspector } from "../../components/Inspector";
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
  CalendarDayViewModel,
  CalendarMonthWeekViewModel,
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
import {
  NoteInspectorBody,
  type NoteDraftValue,
  type NoteInspectorBodyHandle
} from "./inspectors/NoteInspectorBody";
import {
  TaskInspectorBody,
  taskDraftsEqual,
  type TaskDraft
} from "./inspectors/TaskInspectorBody";
import { buildNotePreview } from "./notesParsing";

type CalendarSourceViewModel = ReturnType<typeof useCoreViewModelSource>["calendarSources"][number];
type CompactTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

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

function currentSystemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function fontFamilyOptions(fontFamilies: readonly string[], currentFontName: string | null): string[] {
  const unique = new Set<string>();

  for (const fontName of [...fontFamilies, currentFontName ?? ""]) {
    const trimmed = fontName.trim();

    if (trimmed) {
      unique.add(trimmed);
    }
  }

  return [...unique].sort((left, right) => left.localeCompare(right));
}

function priorityLabel(priority: CorePriority): string {
  if (priority === "none") {
    return "No priority";
  }

  return `${priority[0].toUpperCase()}${priority.slice(1)} priority`;
}

function taskDueCue(task: TaskViewModel): { label: string; tone: CompactTone } | null {
  if (task.status === "completed") {
    return { label: "Done", tone: "success" };
  }

  if (!task.dueDate) {
    return null;
  }

  const today = dateOnlyFromLocalDate(new Date());

  if (task.dueDate < today) {
    return { label: "Overdue", tone: "danger" };
  }

  if (task.dueDate === today) {
    return { label: "Due today", tone: "warning" };
  }

  return { label: task.dueLabel, tone: "neutral" };
}

function taskDurationLabel(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) {
    return "30 min";
  }

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;

  return remaining === 0 ? `${hours} hr` : `${hours} hr ${remaining} min`;
}

function taskScheduleLabel(
  task: TaskViewModel,
  scheduledBlock?: ScheduledTaskBlockViewModel
): string | null {
  if (scheduledBlock) {
    return scheduledBlock.status === "orphaned"
      ? `Orphaned ${scheduledBlock.rangeLabel}`
      : `Scheduled ${scheduledBlock.rangeLabel}`;
  }

  if (task.plannedStart && task.plannedEnd) {
    return `Planned ${timeLabel(task.plannedStart)}-${timeLabel(task.plannedEnd)}`;
  }

  if (task.durationMinutes) {
    return taskDurationLabel(task.durationMinutes);
  }

  return null;
}

function taskScheduleTone(scheduledBlock?: ScheduledTaskBlockViewModel): CompactTone {
  if (scheduledBlock?.status === "orphaned") {
    return "warning";
  }

  if (scheduledBlock) {
    return "info";
  }

  return "neutral";
}

function taskBridgeDescription(
  task: TaskViewModel,
  scheduledBlock?: ScheduledTaskBlockViewModel
): string {
  const parts = [task.detail];
  const scheduleLabel = taskScheduleLabel(task, scheduledBlock);

  if (scheduleLabel) {
    parts.push(scheduleLabel);
  }

  if (task.lockedSchedule) {
    parts.push("Locked");
  }

  return parts.filter(Boolean).join(" - ");
}

function scheduledBlockByTaskId(
  blocks: ScheduledTaskBlockViewModel[]
): Map<string, ScheduledTaskBlockViewModel> {
  const byTaskId = new Map<string, ScheduledTaskBlockViewModel>();

  for (const block of blocks) {
    const existing = byTaskId.get(block.taskId);

    if (!existing || existing.status === "orphaned" || block.status === "scheduled") {
      byTaskId.set(block.taskId, block);
    }
  }

  return byTaskId;
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
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
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
  scheduledBlock,
  task
}: {
  bulkSelected: boolean;
  completed: boolean;
  onDelete: (taskId: string) => void;
  onBulkSelect: (taskId: string, selected: boolean) => void;
  onSelect: (taskId: string) => void;
  onToggle: (taskId: string) => void;
  selected: boolean;
  scheduledBlock?: ScheduledTaskBlockViewModel;
  task: TaskViewModel;
}): JSX.Element {
  const dueCue = taskDueCue(task);
  const scheduleLabel = taskScheduleLabel(task, scheduledBlock);

  return (
    <div
      className={cx(
        "min-h-[76px] border-b border-border px-3 py-2 last:border-b-0",
        selected || bulkSelected ? "bg-surface-0" : "bg-transparent"
      )}
      role="listitem"
    >
      <div className="flex min-w-0 flex-wrap items-start gap-3 sm:flex-nowrap">
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
            {dueCue ? (
              <Badge aria-label={`Task due state ${task.title}`} tone={dueCue.tone}>
                {dueCue.label}
              </Badge>
            ) : null}
            {task.mutationState && task.mutationState !== "synced" ? (
              <Badge tone={task.mutationState === "failed" ? "danger" : "warning"}>
                {task.mutationState === "failed" ? "Failed" : "Queued"}
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-[var(--text-sm)] text-text-muted">{task.detail}</p>
          {scheduleLabel || task.tags?.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {scheduleLabel ? (
                <Badge
                  aria-label={`Task schedule ${task.title}`}
                  className="gap-1"
                  tone={taskScheduleTone(scheduledBlock)}
                >
                  <CalendarClock aria-hidden="true" size={11} />
                  {scheduleLabel}
                </Badge>
              ) : null}
              {task.tags?.slice(0, 3).map((tag) => (
                <Badge key={tag} tone="neutral">
                  +{tag}
                </Badge>
              ))}
            </div>
          ) : null}
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
          <Badge aria-label={`Task priority ${task.title}`} className="gap-1" tone={priorityTone(task.priority)}>
            <Flag aria-hidden="true" size={11} />
            {priorityLabel(task.priority)}
          </Badge>
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
  scheduledBlocksByTaskId,
  selectedTaskId
}: {
  group: TaskGroupViewModel;
  bulkSelectedTaskIds: string[];
  onBulkSelectTask: (taskId: string, selected: boolean) => void;
  onDeleteTask: (taskId: string) => void;
  onSelectTask: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  scheduledBlocksByTaskId?: Map<string, ScheduledTaskBlockViewModel>;
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
            scheduledBlock={scheduledBlocksByTaskId?.get(task.id)}
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
      {event.mutationState && event.mutationState !== "synced" ? (
        <Badge tone={event.mutationState === "failed" ? "danger" : "warning"}>
          {event.mutationState === "failed" ? "Failed" : "Queued"}
        </Badge>
      ) : null}
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

function TodayFocusTaskRow({
  nextStart,
  onSchedule,
  onToggleTask,
  task
}: {
  nextStart: string | null;
  onSchedule: (task: TaskViewModel, startsAt: string) => void;
  onToggleTask: (taskId: string) => void;
  task: TaskViewModel;
}): JSX.Element {
  const dueCue = taskDueCue(task);
  const scheduleAtLabel = nextStart ? `Schedule ${task.title} at ${timeLabel(nextStart)}` : `Schedule ${task.title}`;

  return (
    <ListRow
      className="transition-colors duration-fast ease-hcb hover:bg-surface-0"
      description={taskBridgeDescription(task)}
      draggable={task.status === "open"}
      leading={<TaskCompletionButton completed={task.status === "completed"} onToggle={onToggleTask} task={task} />}
      meta={taskDurationLabel(task.durationMinutes)}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-hcb-task", task.id);
      }}
      title={task.title}
      trailing={
        <div className="flex shrink-0 items-center gap-1">
          {dueCue ? <Badge tone={dueCue.tone}>{dueCue.label}</Badge> : null}
          <Badge aria-label={`Task priority ${task.title}`} className="gap-1" tone={priorityTone(task.priority)}>
            <Flag aria-hidden="true" size={11} />
            {priorityLabel(task.priority)}
          </Badge>
          <IconButton
            className="size-7"
            disabled={!nextStart || task.status !== "open"}
            icon={CalendarClock}
            label={scheduleAtLabel}
            onClick={() => nextStart ? onSchedule(task, nextStart) : undefined}
            variant="ghost"
          />
        </div>
      }
    />
  );
}

function TodayScheduledBlockRow({
  block,
  onMoveBlock,
  onRepairBlock,
  onResizeBlock,
  onUnscheduleBlock
}: {
  block: ScheduledTaskBlockViewModel;
  onMoveBlock: (block: ScheduledTaskBlockViewModel, minutes: number) => void;
  onRepairBlock: (block: ScheduledTaskBlockViewModel) => void;
  onResizeBlock: (block: ScheduledTaskBlockViewModel, minutes: number) => void;
  onUnscheduleBlock: (blockId: string) => void;
}): JSX.Element {
  const conflictDetail =
    block.conflictTitles.length > 0 ? ` - Conflicts with ${block.conflictTitles.join(", ")}` : "";

  return (
    <ListRow
      className={block.status === "orphaned" ? "bg-warning/10" : undefined}
      description={`${block.rangeLabel} - ${block.calendar}${conflictDetail}`}
      leading={<CalendarClock aria-hidden="true" className="text-accent" size={17} />}
      meta={taskDurationLabel(block.durationMinutes)}
      selected={block.isNextUp}
      title={block.title}
      trailing={
        <div className="flex shrink-0 items-center gap-1">
          {block.isNextUp ? <Badge tone="info">Next</Badge> : null}
          {block.conflictCount > 0 ? <Badge tone="danger">Conflict</Badge> : null}
          {block.mutationState && block.mutationState !== "synced" ? (
            <Badge tone={block.mutationState === "failed" ? "danger" : "warning"}>
              {block.mutationState === "failed" ? "Failed" : "Queued"}
            </Badge>
          ) : (
            <Badge tone={block.status === "orphaned" ? "warning" : "success"}>
              {block.status === "orphaned" ? "Needs repair" : "Scheduled"}
            </Badge>
          )}
          {block.status === "orphaned" ? (
            <IconButton
              className="size-7"
              icon={RotateCcw}
              label={`Repair ${block.title}`}
              onClick={() => onRepairBlock(block)}
              variant="ghost"
            />
          ) : null}
          <IconButton
            className="size-7"
            icon={StepBack}
            label={`Move ${block.title} earlier`}
            onClick={() => onMoveBlock(block, -30)}
            variant="ghost"
          />
          <IconButton
            className="size-7"
            icon={StepForward}
            label={`Move ${block.title} later`}
            onClick={() => onMoveBlock(block, 30)}
            variant="ghost"
          />
          <IconButton
            className="size-7"
            disabled={block.durationMinutes <= 15}
            icon={Minus}
            label={`Shorten ${block.title}`}
            onClick={() => onResizeBlock(block, -15)}
            variant="ghost"
          />
          <IconButton
            className="size-7"
            icon={Plus}
            label={`Lengthen ${block.title}`}
            onClick={() => onResizeBlock(block, 15)}
            variant="ghost"
          />
          <IconButton
            className="size-7"
            icon={X}
            label={`Unschedule ${block.title}`}
            onClick={() => onUnscheduleBlock(block.id)}
            variant="ghost"
          />
        </div>
      }
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

interface TodayGridRow {
  id: string;
  startsAt: string;
  label: string;
}

type QuickAddKind = "task" | "event";

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC"
  }).format(new Date(value));
}

function todayGridRows(date: string, startHour: number, endHour: number): TodayGridRow[] {
  const rows: TodayGridRow[] = [];
  const startMs = Date.parse(`${date}T00:00:00.000Z`) + startHour * 60 * 60 * 1000;
  const count = Math.max(0, (endHour - startHour) * 2);

  for (let index = 0; index < count; index += 1) {
    const startsAt = new Date(startMs + index * 30 * 60 * 1000).toISOString();
    rows.push({
      id: startsAt,
      startsAt,
      label: timeLabel(startsAt)
    });
  }

  return rows;
}

function nextOpenScheduleStart(
  rows: TodayGridRow[],
  slotsByRow: Map<string, ScheduleSlot[]>
): string | null {
  let lastBusyIndex = -1;

  rows.forEach((row, index) => {
    if ((slotsByRow.get(row.id) ?? []).length > 0) {
      lastBusyIndex = index;
    }
  });

  const afterBusy = rows.find((row, index) => index > lastBusyIndex && (slotsByRow.get(row.id) ?? []).length === 0);

  if (afterBusy) {
    return afterBusy.startsAt;
  }

  return rows.find((row) => (slotsByRow.get(row.id) ?? []).length === 0)?.startsAt ?? rows[0]?.startsAt ?? null;
}

function scheduleSlotDurationMinutes(slot: ScheduleSlot): number {
  return Math.max(5, Math.round((Date.parse(slot.endsAt) - Date.parse(slot.startsAt)) / 60_000));
}

function scheduleSlotMinutesFromStart(slot: ScheduleSlot, startHour: number): number {
  const dateStart = Date.parse(`${slot.startsAt.slice(0, 10)}T00:00:00.000Z`);
  return Math.max(0, Math.round((Date.parse(slot.startsAt) - dateStart) / 60_000) - startHour * 60);
}

function halfHourRowStart(value: string): string {
  const date = new Date(value);
  const minutes = date.getUTCMinutes();

  date.setUTCMinutes(minutes < 30 ? 0 : 30, 0, 0);
  return date.toISOString();
}

function addMinutesIso(startsAt: string, minutes: number): string {
  return new Date(Date.parse(startsAt) + minutes * 60 * 1000).toISOString();
}

function slotTitle(slot: ScheduleSlot, source: ReturnType<typeof useCoreViewModelSource>): string {
  if (slot.taskId) {
    return source.getTaskById(slot.taskId).title;
  }

  if (slot.eventId) {
    return source.calendarEventsById[slot.eventId]?.title ?? "Calendar event";
  }

  return "Scheduled";
}

function slotDetail(slot: ScheduleSlot, source: ReturnType<typeof useCoreViewModelSource>): string {
  if (slot.taskId) {
    const task = source.getTaskById(slot.taskId);
    return `${task.list} - ${scheduleSlotDurationMinutes(slot)} min`;
  }

  if (slot.eventId) {
    const event = source.calendarEventsById[slot.eventId];
    return event ? `${event.calendar} - ${event.rangeLabel}` : "Calendar event";
  }

  return `${scheduleSlotDurationMinutes(slot)} min`;
}

function slotTone(slot: ScheduleSlot): { border: string; background: string; label: string } {
  if (slot.conflict) {
    return {
      border: "border-danger",
      background: "rgba(244, 63, 94, 0.16)",
      label: "Conflict"
    };
  }

  if (slot.eventId) {
    return {
      border: "border-accent",
      background: "rgba(56, 189, 248, 0.14)",
      label: "Event"
    };
  }

  if (slot.locked) {
    return {
      border: "border-warning",
      background: "rgba(245, 158, 11, 0.14)",
      label: "Locked"
    };
  }

  return {
    border: "border-success",
    background: "rgba(34, 197, 94, 0.14)",
    label: "Task"
  };
}

function TodayView(): JSX.Element {
  const source = useCoreViewModelSource();
  const schedule = source.todayViewModel.schedule;
  const todayDate = dateOnlyFromLocalDate(new Date());
  const startHour = source.settings.todayWorkingHoursStart;
  const endHour = Math.max(startHour + 1, source.settings.todayWorkingHoursEnd);
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  const [quickAddSlot, setQuickAddSlot] = useState<string | null>(null);
  const [quickAddTitle, setQuickAddTitle] = useState("");
  const [quickAddKind, setQuickAddKind] = useState<QuickAddKind>("task");
  const [todayActionError, setTodayActionError] = useState<string | null>(null);
  const rows = useMemo(() => todayGridRows(todayDate, startHour, endHour), [endHour, startHour, todayDate]);
  const slotsByRow = useMemo(() => {
    const byRow = new Map<string, ScheduleSlot[]>();

    for (const slot of schedule.slots) {
      const key = halfHourRowStart(slot.startsAt);
      byRow.set(key, [...(byRow.get(key) ?? []), slot]);
    }

    return byRow;
  }, [schedule.slots]);
  const scheduledBlocksByTaskId = useMemo(
    () => scheduledBlockByTaskId(source.scheduledTaskBlocks),
    [source.scheduledTaskBlocks]
  );
  const todayScheduledBlocks = useMemo(
    () =>
      source.scheduledTaskBlocks
        .filter((block) => block.startsAt.slice(0, 10) === todayDate || block.status === "orphaned")
        .sort(
          (left, right) =>
            left.startsAt.localeCompare(right.startsAt) ||
            left.endsAt.localeCompare(right.endsAt) ||
            left.title.localeCompare(right.title)
        ),
    [source.scheduledTaskBlocks, todayDate]
  );
  const nextScheduleStart = useMemo(
    () => nextOpenScheduleStart(rows, slotsByRow),
    [rows, slotsByRow]
  );
  const unscheduledTasks = schedule.unscheduled.map((task) => source.getTaskById(task.id));
  const usedCapacityMinutes = schedule.slots
    .filter((slot) => slot.taskId)
    .reduce((total, slot) => total + scheduleSlotDurationMinutes(slot), 0);
  const capacityPercent = Math.min(100, Math.round((usedCapacityMinutes / source.settings.todayCapacityMinutes) * 100));
  const conflictCount = schedule.slots.filter((slot) => slot.conflict).length;
  const currentRowId = halfHourRowStart(nowIso);

  useEffect(() => {
    const interval = window.setInterval(() => setNowIso(new Date().toISOString()), 60_000);

    return () => window.clearInterval(interval);
  }, []);

  if (
    (source.dataState === "loading" ||
      source.dataState === "empty" ||
      source.dataState === "offline" ||
      source.dataState === "error") &&
    !source.hasCachedData
  ) {
    return <CacheStatePanel title="Today" />;
  }

  async function saveTaskSchedule(taskId: string, startsAt: string, durationMinutes: number): Promise<void> {
    const existingSlot = schedule.slots.find((slot) => slot.taskId === taskId);

    if (existingSlot?.locked) {
      return;
    }

    setTodayActionError(null);

    const existingBlock = scheduledBlocksByTaskId.get(taskId);
    const calendarId = existingBlock?.calendarId ?? defaultCalendarId(source);
    const saved = existingBlock
      ? await source.moveScheduledTaskBlock({
          id: existingBlock.id,
          calendarId,
          startsAt,
          durationMinutes
        })
      : calendarId
        ? await source.scheduleTaskBlock({
            taskId,
            calendarId,
            startsAt,
            durationMinutes
          })
        : await source.updateTask({
            id: taskId,
            plannedStart: startsAt,
            plannedEnd: addMinutesIso(startsAt, durationMinutes),
            durationMinutes
          });

    if (saved) {
      source.refresh();
    } else {
      setTodayActionError("Task schedule was not saved.");
    }
  }

  async function moveTaskSlotBy(slot: ScheduleSlot, minutes: number): Promise<void> {
    if (!slot.taskId || slot.locked) {
      return;
    }

    await saveTaskSchedule(
      slot.taskId,
      addMinutesIso(slot.startsAt, minutes),
      scheduleSlotDurationMinutes(slot)
    );
  }

  function scheduleTaskAt(task: TaskViewModel, startsAt: string): void {
    void saveTaskSchedule(task.id, startsAt, task.durationMinutes ?? 30);
  }

  async function moveScheduledBlockBy(block: ScheduledTaskBlockViewModel, minutes: number): Promise<void> {
    const saved = await source.moveScheduledTaskBlock({
      id: block.id,
      calendarId: block.calendarId,
      startsAt: addMinutesIso(block.startsAt, minutes),
      durationMinutes: block.durationMinutes
    });

    if (saved) {
      source.refresh();
    }
  }

  async function resizeScheduledBlockBy(block: ScheduledTaskBlockViewModel, minutes: number): Promise<void> {
    const durationMinutes = Math.max(15, block.durationMinutes + minutes);
    const saved = await source.moveScheduledTaskBlock({
      id: block.id,
      calendarId: block.calendarId,
      startsAt: block.startsAt,
      durationMinutes
    });

    if (saved) {
      source.refresh();
    }
  }

  async function repairScheduledBlock(block: ScheduledTaskBlockViewModel): Promise<void> {
    const saved = await source.moveScheduledTaskBlock({
      id: block.id,
      calendarId: block.calendarId || defaultCalendarId(source),
      startsAt: block.startsAt,
      durationMinutes: block.durationMinutes
    });

    if (saved) {
      source.refresh();
    }
  }

  async function unscheduleBlock(blockId: string): Promise<void> {
    const saved = await source.unscheduleTaskBlock(blockId);

    if (saved) {
      source.refresh();
    }
  }

  async function createQuickAdd(): Promise<void> {
    const title = quickAddTitle.trim();

    if (!quickAddSlot || !title) {
      return;
    }

    setTodayActionError(null);

    if (quickAddKind === "task") {
      const created = await source.createTask({
        title,
        notes: "",
        dueDate: null,
        listId: defaultTaskListId(source),
        parentId: null,
        priority: "none",
        plannedStart: quickAddSlot,
        plannedEnd: addMinutesIso(quickAddSlot, 30),
        durationMinutes: 30
      });

      if (created) {
        setQuickAddTitle("");
        setQuickAddSlot(null);
        source.refresh();
      }

      return;
    }

    const result = await window.hcb?.calendar.create({
      title,
      calendarId: defaultCalendarId(source),
      startsAt: quickAddSlot,
      endsAt: addMinutesIso(quickAddSlot, 30),
      allDay: false,
      location: "",
      notes: "",
      guestEmails: [],
      reminderMinutes: []
    });

    if (!result?.ok) {
      setTodayActionError(result?.error.message ?? "Calendar event create failed.");
      return;
    }

    setQuickAddTitle("");
    setQuickAddSlot(null);
    source.refresh();
  }

  function dropTaskAt(row: TodayGridRow, event: DragEvent<HTMLDivElement>): void {
    const taskId = event.dataTransfer.getData("application/x-hcb-task");

    if (!taskId) {
      return;
    }

    event.preventDefault();
    const slot = schedule.slots.find((candidate) => candidate.taskId === taskId);
    const durationMinutes = slot ? scheduleSlotDurationMinutes(slot) : source.getTaskById(taskId).durationMinutes ?? 30;
    void saveTaskSchedule(taskId, row.startsAt, durationMinutes);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
        <MetricTile label="Used" value={`${usedCapacityMinutes}/${source.settings.todayCapacityMinutes} min`} />
        <MetricTile label="Scheduled" value={String(schedule.slots.length)} />
        <MetricTile label="Conflicts" value={String(conflictCount)} />
        <MetricTile label="Unscheduled" value={String(schedule.unscheduled.length)} />
      </div>

      <StatusBanner
        description={`${startHour}:00-${endHour}:00 - ${schedule.overloadMinutes} overload minutes`}
        icon={conflictCount > 0 || schedule.overloadMinutes > 0 ? AlertTriangle : Clock3}
        title={`Today ${source.todayViewModel.currentTimeLabel}`}
        tone={conflictCount > 0 || schedule.overloadMinutes > 0 ? "warning" : "info"}
      />

      <SectionChrome
        title="Today"
        sidebar={
          <div className="grid gap-3">
            <Panel title="Focus queue" description="Open unscheduled tasks">
              <VirtualizedList
                ariaLabel="Today focus queue"
                estimateRowHeight={68}
                getKey={(task) => task.id}
                items={unscheduledTasks}
                performanceLabel="today.focus-tasks"
                renderRow={(task) => (
                  <TodayFocusTaskRow
                    nextStart={nextScheduleStart}
                    onSchedule={scheduleTaskAt}
                    onToggleTask={(taskId) => void source.completeTask(taskId)}
                    task={task}
                  />
                )}
                viewportHeight={220}
              />
            </Panel>
            <Panel
              title="Scheduled blocks"
              description={
                todayScheduledBlocks.length === 0
                  ? "No linked blocks today"
                  : `${todayScheduledBlocks.length} linked ${todayScheduledBlocks.length === 1 ? "block" : "blocks"}`
              }
            >
              <VirtualizedList
                ariaLabel="Scheduled task blocks"
                emptyState={
                  <EmptyState
                    description="Schedule a task from the focus queue or by dropping it on the timeline."
                    title="No scheduled blocks"
                  />
                }
                estimateRowHeight={64}
                getKey={(block) => block.id}
                items={todayScheduledBlocks}
                performanceLabel="today.scheduled-blocks"
                renderRow={(block) => (
                  <TodayScheduledBlockRow
                    block={block}
                    onMoveBlock={(candidate, minutes) => void moveScheduledBlockBy(candidate, minutes)}
                    onRepairBlock={(candidate) => void repairScheduledBlock(candidate)}
                    onResizeBlock={(candidate, minutes) => void resizeScheduledBlockBy(candidate, minutes)}
                    onUnscheduleBlock={(blockId) => void unscheduleBlock(blockId)}
                  />
                )}
                viewportHeight={180}
              />
            </Panel>
          </div>
        }
      >
        <Panel
          title="Timeline"
          description="Schedule suggestion from the local cache"
          action={
            <Badge tone={schedule.overloadMinutes > 0 ? "warning" : "success"}>
              {schedule.overloadMinutes > 0 ? `${schedule.overloadMinutes} min over` : "Within capacity"}
            </Badge>
          }
        >
          <div className="grid gap-3 p-3">
            <div className="h-2 overflow-hidden rounded-hcbSm bg-bg-tertiary">
              <div
                className={cx(
                  "h-full rounded-hcbSm",
                  schedule.overloadMinutes > 0 ? "bg-warning" : "bg-success"
                )}
                style={{ width: `${capacityPercent}%` }}
              />
            </div>
            {todayActionError ? (
              <StatusBanner description={todayActionError} title="Today action failed" tone="warning" />
            ) : null}
            {quickAddSlot ? (
              <div className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3" role="dialog" aria-label="Quick add">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-sm)] font-medium text-text-primary">
                    Quick add {timeLabel(quickAddSlot)}
                  </span>
                  <IconButton icon={X} label="Close quick add" onClick={() => setQuickAddSlot(null)} variant="ghost" />
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <Input
                    aria-label="Quick add title"
                    onChange={(event) => setQuickAddTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void createQuickAdd();
                      }
                    }}
                    placeholder="Title"
                    value={quickAddTitle}
                  />
                  <Button
                    aria-pressed={quickAddKind === "task"}
                    onClick={() => setQuickAddKind("task")}
                    size="sm"
                    variant={quickAddKind === "task" ? "secondary" : "ghost"}
                  >
                    Task
                  </Button>
                  <Button
                    aria-pressed={quickAddKind === "event"}
                    onClick={() => setQuickAddKind("event")}
                    size="sm"
                    variant={quickAddKind === "event" ? "secondary" : "ghost"}
                  >
                    Event
                  </Button>
                </div>
                <Button disabled={!quickAddTitle.trim()} onClick={() => void createQuickAdd()} size="sm" variant="primary">
                  <CalendarPlus aria-hidden="true" size={14} />
                  Add
                </Button>
              </div>
            ) : null}
          <VirtualizedList
            ariaLabel="Today timeline"
            estimateRowHeight={56}
            emptyState={
              <EmptyState
                description="No working-hour rows are available."
                title="No timeline rows"
              />
            }
            getKey={(row) => row.id}
            items={rows}
            performanceLabel="today.timeline"
            renderRow={(row) => {
              const rowSlots = slotsByRow.get(row.id) ?? [];
              const isCurrentRow = currentRowId === row.id && todayDate === dateOnlyFromLocalDate(new Date(nowIso));
              const currentTop = ((new Date(nowIso).getUTCMinutes() % 30) / 30) * 56;

              return (
                <div className="grid min-h-14 grid-cols-[64px_minmax(0,1fr)] border-b border-border">
                  <div className="border-r border-border px-2 py-2 font-mono text-[var(--text-xs)] text-text-muted">
                    {row.label}
                  </div>
                  <div
                    aria-label={`Quick add at ${row.label}`}
                    className="relative min-h-14 bg-bg-tertiary/40 px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    onClick={() => setQuickAddSlot(row.startsAt)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => dropTaskAt(row, event)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setQuickAddSlot(row.startsAt);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    {isCurrentRow ? (
                      <div
                        aria-hidden="true"
                        className="absolute inset-x-0 z-20 h-0.5 bg-danger"
                        style={{ top: currentTop }}
                      />
                    ) : null}
                    {rowSlots.map((slot) => {
                      const tone = slotTone(slot);
                      const slotTask = slot.taskId ? source.getTaskById(slot.taskId) : null;
                      const slotBlock = slot.taskId ? scheduledBlocksByTaskId.get(slot.taskId) : undefined;
                      const durationRows = scheduleSlotDurationMinutes(slot) / 30;
                      const top = ((scheduleSlotMinutesFromStart(slot, startHour) % 30) / 30) * 56;
                      const height = Math.max(34, durationRows * 56 - 4);
                      const draggable = Boolean(slot.taskId && !slot.locked);
                      const statusLabel = slotBlock
                        ? slotBlock.status === "orphaned" ? "Needs repair" : "Scheduled"
                        : tone.label;

                      return (
                        <button
                          className={cx(
                            "absolute left-2 right-2 z-10 overflow-hidden rounded-hcbMd border px-2 py-1 text-left shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                            tone.border
                          )}
                          draggable={draggable}
                          key={`${slot.taskId ?? slot.eventId}-${slot.startsAt}`}
                          onClick={(event) => event.stopPropagation()}
                          onDragStart={(event) => {
                            if (!slot.taskId || slot.locked) {
                              event.preventDefault();
                              return;
                            }

                            event.dataTransfer.setData("application/x-hcb-task", slot.taskId);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowUp") {
                              event.preventDefault();
                              void moveTaskSlotBy(slot, -15);
                            } else if (event.key === "ArrowDown") {
                              event.preventDefault();
                              void moveTaskSlotBy(slot, 15);
                            }
                          }}
                          style={{ top, height, background: tone.background }}
                          type="button"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-[var(--text-sm)] font-medium text-text-primary">
                              {slotTitle(slot, source)}
                            </span>
                            <Badge
                              tone={
                                slot.conflict
                                  ? "danger"
                                  : slotBlock?.status === "orphaned"
                                    ? "warning"
                                    : slotBlock
                                      ? "info"
                                      : slot.eventId
                                        ? "accent"
                                        : slot.locked
                                          ? "warning"
                                          : "success"
                              }
                            >
                              {statusLabel}
                            </Badge>
                            {slotTask ? (
                              <Badge className="gap-1" tone={priorityTone(slotTask.priority)}>
                                <Flag aria-hidden="true" size={10} />
                                {priorityLabel(slotTask.priority)}
                              </Badge>
                            ) : null}
                          </span>
                          <span className="block truncate text-[var(--text-xs)] text-text-muted">
                            {slotDetail(slot, source)}
                            {slotBlock ? ` - ${slotBlock.calendar}` : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            }}
            viewportHeight={342}
          />
          </div>
        </Panel>
      </SectionChrome>
    </div>
  );
}

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

function TasksView({ command }: { command?: TaskSurfaceCommand | null }): JSX.Element {
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

type CalendarRepeatFrequency = "none" | CalendarEventRecurrence["frequency"];

interface CalendarEventDraft {
  mode: "create" | "edit";
  id?: string;
  mutationState?: CalendarEventViewModel["mutationState"];
  title: string;
  calendarId: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string;
  notes: string;
  guests: string;
  reminderMinutes: string;
  repeatFrequency: CalendarRepeatFrequency;
  repeatInterval: string;
  repeatEndsOn: string;
  repeatCount: string;
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
    mutationState: undefined,
    title: "",
    calendarId: defaultCalendarId(source),
    startsAt,
    endsAt: allDay ? endsAt : timedEnd,
    allDay,
    location: "",
    notes: "",
    guests: "",
    reminderMinutes: "",
    repeatFrequency: "none",
    repeatInterval: "1",
    repeatEndsOn: "",
    repeatCount: ""
  };
}

function editCalendarDraft(event: CalendarEventViewModel): CalendarEventDraft {
  const recurrence = calendarDraftRecurrenceFromRule(event.recurrenceRule);

  return {
    mode: "edit",
    id: event.id,
    mutationState: event.mutationState,
    title: event.title,
    calendarId: event.calendarId,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    location: event.location === "Scheduled" || event.location === "All day" ? "" : event.location,
    notes: event.notes === "Calendar cache" ? "" : event.notes,
    guests: event.guestEmails.join(", "),
    reminderMinutes: event.reminderMinutes[0] === undefined ? "" : String(event.reminderMinutes[0]),
    repeatFrequency: recurrence?.frequency ?? "none",
    repeatInterval: recurrence ? String(recurrence.interval) : "1",
    repeatEndsOn: recurrence?.endsOn ?? "",
    repeatCount: recurrence?.count === null || recurrence?.count === undefined ? "" : String(recurrence.count)
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
    reminderMinutes,
    recurrence: calendarDraftRecurrence(draft)
  };
}

function calendarEventDraftsEqual(
  left: CalendarEventDraft | null,
  right: CalendarEventDraft | null
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.mode === right.mode &&
    left.id === right.id &&
    left.mutationState === right.mutationState &&
    left.title === right.title &&
    left.calendarId === right.calendarId &&
    left.startsAt === right.startsAt &&
    left.endsAt === right.endsAt &&
    left.allDay === right.allDay &&
    left.location === right.location &&
    left.notes === right.notes &&
    left.guests === right.guests &&
    left.reminderMinutes === right.reminderMinutes &&
    left.repeatFrequency === right.repeatFrequency &&
    left.repeatInterval === right.repeatInterval &&
    left.repeatEndsOn === right.repeatEndsOn &&
    left.repeatCount === right.repeatCount
  );
}

function calendarDraftRecurrence(draft: CalendarEventDraft): CalendarEventRecurrence | null {
  if (draft.repeatFrequency === "none") {
    return null;
  }

  const interval = Math.min(366, Math.max(1, Number.parseInt(draft.repeatInterval, 10) || 1));
  const count = draft.repeatCount.trim() === ""
    ? null
    : Math.min(366, Math.max(1, Number.parseInt(draft.repeatCount, 10) || 1));

  return {
    frequency: draft.repeatFrequency,
    interval,
    endsOn: draft.repeatEndsOn.trim() || null,
    count
  };
}

function calendarDraftRecurrenceFromRule(rule: string | null | undefined): CalendarEventRecurrence | null {
  const line = rule
    ?.split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith("RRULE:"));

  if (!line) {
    return null;
  }

  const parts = Object.fromEntries(
    line
      .slice("RRULE:".length)
      .split(";")
      .map((part) => part.split("=", 2))
      .filter((part): part is [string, string] => part.length === 2)
  );
  const frequency = parts.FREQ?.toLowerCase();

  if (
    frequency !== "daily" &&
    frequency !== "weekly" &&
    frequency !== "monthly" &&
    frequency !== "yearly"
  ) {
    return null;
  }

  return {
    frequency,
    interval: Math.min(366, Math.max(1, Number.parseInt(parts.INTERVAL ?? "1", 10) || 1)),
    endsOn: parts.UNTIL ? recurrenceDateInputValue(parts.UNTIL) : null,
    count: parts.COUNT ? Math.min(366, Math.max(1, Number.parseInt(parts.COUNT, 10) || 1)) : null
  };
}

function recurrenceDateInputValue(value: string): string | null {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})/.exec(value);

  return dateOnly ? `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}` : null;
}

function calendarRecurrenceSummary(draft: CalendarEventDraft): string {
  const recurrence = calendarDraftRecurrence(draft);

  if (!recurrence) {
    return "Does not repeat";
  }

  const unit =
    recurrence.frequency === "daily"
      ? "day"
      : recurrence.frequency === "weekly"
        ? "week"
        : recurrence.frequency === "monthly"
          ? "month"
          : "year";
  const cadence = recurrence.interval === 1
    ? `Every ${unit}`
    : `Every ${recurrence.interval} ${unit}s`;
  const qualifiers = [
    recurrence.endsOn ? `until ${recurrence.endsOn}` : null,
    recurrence.count ? `${recurrence.count} times` : null
  ].filter((part): part is string => part !== null);

  return qualifiers.length > 0 ? `${cadence}, ${qualifiers.join(", ")}` : cadence;
}

function allDayEndInputValue(endsAt: string): string {
  const end = new Date(endsAt);
  end.setUTCDate(end.getUTCDate() - 1);
  return dateInputValue(end.toISOString());
}

function calendarDraftRangeLabel(draft: CalendarEventDraft): string {
  if (draft.allDay) {
    return `${dateInputValue(draft.startsAt)} · All day`;
  }

  return `${dateInputValue(draft.startsAt)} · ${draft.startsAt.slice(11, 16)}-${draft.endsAt.slice(11, 16)}`;
}

function calendarDraftDurationLabel(draft: CalendarEventDraft): string {
  if (draft.allDay) {
    const days = Math.max(
      1,
      Math.round((Date.parse(draft.endsAt) - Date.parse(draft.startsAt)) / (24 * 60 * 60 * 1000))
    );

    return `${days} day${days === 1 ? "" : "s"}`;
  }

  const minutes = Math.max(0, Math.round((Date.parse(draft.endsAt) - Date.parse(draft.startsAt)) / 60_000));
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours} hr` : `${hours} hr ${remainingMinutes} min`;
}

function CalendarEventForm({
  calendars,
  defaultTimeZone,
  draft,
  error,
  setDraft
}: {
  calendars: ReturnType<typeof useCoreViewModelSource>["calendarSources"];
  defaultTimeZone: string;
  draft: CalendarEventDraft;
  error?: string;
  setDraft: (draft: CalendarEventDraft) => void;
}): JSX.Element {
  const selectedCalendar = calendars.find((calendar) => calendar.id === draft.calendarId);
  const sourceTimeZone = selectedCalendar?.timeZone ?? defaultTimeZone;

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
    <div className="grid gap-3">
      {error ? <ErrorState description={error} title="Event not saved" /> : null}
      <div
        aria-label="Event context"
        className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3"
        role="group"
      >
        <div className="flex min-w-0 items-center gap-2">
          <CalendarSourceSwatch calendarId={draft.calendarId} />
          <span className="min-w-0 flex-1 truncate text-[var(--text-sm)] font-semibold text-text-primary">
            {selectedCalendar?.title ?? "Calendar"}
          </span>
          {draft.mutationState && draft.mutationState !== "synced" ? (
            <Badge tone={draft.mutationState === "failed" ? "danger" : "warning"}>
              {draft.mutationState === "failed" ? "Failed" : "Queued"}
            </Badge>
          ) : (
            <Badge tone="success">Synced</Badge>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[var(--text-xs)] text-text-muted">
          <span className="inline-flex min-w-0 items-center gap-1">
            <Clock3 aria-hidden="true" size={13} />
            <span className="truncate">{calendarDraftRangeLabel(draft)}</span>
          </span>
          <Badge tone="neutral">{calendarDraftDurationLabel(draft)}</Badge>
          <Badge tone="neutral">{sourceTimeZone}</Badge>
        </div>
      </div>
      <Input
        aria-label="Event title"
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        placeholder="Title"
        value={draft.title}
      />
      <fieldset className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3">
        <legend className="px-1 text-[var(--text-sm)] font-medium text-text-secondary">Calendar</legend>
        <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
          <span>Source</span>
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
      </fieldset>
      <fieldset className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3">
        <legend className="px-1 text-[var(--text-sm)] font-medium text-text-secondary">Time</legend>
        <label className="flex min-h-8 items-center gap-2 text-[var(--text-sm)] text-text-secondary">
          <input
            checked={draft.allDay}
            className="accent-[var(--color-accent)]"
            onChange={(event) => setAllDay(event.target.checked)}
            type="checkbox"
          />
          All day
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
      </fieldset>
      <fieldset className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3">
        <legend className="px-1 text-[var(--text-sm)] font-medium text-text-secondary">Details</legend>
        <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
          <span className="inline-flex items-center gap-1">
            <MapPin aria-hidden="true" size={13} />
            Location
          </span>
          <Input
            aria-label="Event location"
            onChange={(event) => setDraft({ ...draft, location: event.target.value })}
            placeholder="Location"
            value={draft.location}
          />
        </label>
        <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
          <span className="inline-flex items-center gap-1">
            <Users aria-hidden="true" size={13} />
            Guests
          </span>
          <Input
            aria-label="Event guests"
            onChange={(event) => setDraft({ ...draft, guests: event.target.value })}
            placeholder="guest@example.com, team@example.com"
            value={draft.guests}
          />
        </label>
        <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
          <span className="inline-flex items-center gap-1">
            <Bell aria-hidden="true" size={13} />
            Reminder
          </span>
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
      </fieldset>
      <fieldset className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3">
        <legend className="px-1 text-[var(--text-sm)] font-medium text-text-secondary">
          <span className="inline-flex items-center gap-1">
            <RotateCcw aria-hidden="true" size={13} />
            Repeat
          </span>
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span>Frequency</span>
            <select
              aria-label="Event repeat frequency"
              className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onChange={(event) =>
                setDraft({ ...draft, repeatFrequency: event.target.value as CalendarRepeatFrequency })
              }
              value={draft.repeatFrequency}
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          <Input
            aria-label="Repeat interval"
            disabled={draft.repeatFrequency === "none"}
            min={1}
            max={366}
            onChange={(event) => setDraft({ ...draft, repeatInterval: event.target.value })}
            type="number"
            value={draft.repeatInterval}
          />
          <Input
            aria-label="Repeat end date"
            disabled={draft.repeatFrequency === "none"}
            onChange={(event) => setDraft({ ...draft, repeatEndsOn: event.target.value })}
            type="date"
            value={draft.repeatEndsOn}
          />
          <Input
            aria-label="Repeat count"
            disabled={draft.repeatFrequency === "none"}
            min={1}
            max={366}
            onChange={(event) => setDraft({ ...draft, repeatCount: event.target.value })}
            placeholder="Occurrences"
            type="number"
            value={draft.repeatCount}
          />
        </div>
        <div className="text-[var(--text-xs)] text-text-muted">{calendarRecurrenceSummary(draft)}</div>
      </fieldset>
      <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
        <span className="inline-flex items-center gap-1">
          <FileText aria-hidden="true" size={13} />
          Notes
        </span>
        <textarea
          aria-label="Event notes"
          className="min-h-24 w-full resize-none rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-base)] text-text-primary placeholder:text-text-muted transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          placeholder="Notes"
          value={draft.notes}
        />
      </label>
    </div>
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
const calendarDaySlotRowHeight = 64;
const calendarDayViewportHeight = 520;
const calendarWeekColumnWidth = 160;
const calendarMonthVisibleChipCount = 3;
const calendarWeekVisibleTimedCount = 4;
const calendarWeekVisibleAllDayCount = 2;

const calendarSourceTones = [
  {
    border: "border-l-accent",
    swatch: "bg-accent"
  },
  {
    border: "border-l-success",
    swatch: "bg-success"
  },
  {
    border: "border-l-warning",
    swatch: "bg-warning"
  },
  {
    border: "border-l-info",
    swatch: "bg-info"
  },
  {
    border: "border-l-danger",
    swatch: "bg-danger"
  }
] as const;

interface CalendarDaySlot {
  hour: number;
  label: string;
  startsAt: string;
  events: CalendarEventViewModel[];
}

interface VisibleCalendarDay {
  day: CalendarDayViewModel;
  visibleEvents: CalendarEventViewModel[];
  allDayEvents: CalendarEventViewModel[];
  timedEvents: CalendarEventViewModel[];
}

interface VisibleCalendarMonthDay {
  day: CalendarDayViewModel;
  visibleEventChips: CalendarEventViewModel[];
  overflowCount: number;
}

interface VisibleCalendarMonthWeek {
  id: string;
  days: VisibleCalendarMonthDay[];
}

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

function visibleCalendarDay(
  day: CalendarDayViewModel,
  visibleCalendarIds: ReadonlySet<string>
): VisibleCalendarDay {
  const visibleEvents = day.events.filter((event) => visibleCalendarEvent(event, visibleCalendarIds));
  const { allDayEvents, timedEvents } = splitAllDayEvents(visibleEvents);

  return {
    allDayEvents,
    day,
    timedEvents,
    visibleEvents
  };
}

function calendarDaySlots(day: string, timedEvents: CalendarEventViewModel[]): CalendarDaySlot[] {
  const eventsByHour = new Map<number, CalendarEventViewModel[]>();

  for (const event of timedEvents) {
    for (const hour of dayPlanningHours) {
      if (!eventOverlapsHour(event, day, hour)) {
        continue;
      }

      const hourEvents = eventsByHour.get(hour) ?? [];
      hourEvents.push(event);
      eventsByHour.set(hour, hourEvents);
    }
  }

  return dayPlanningHours.map((hour) => ({
    hour,
    label: hourSlotLabel(hour),
    startsAt: hourSlotIso(day, hour),
    events: eventsByHour.get(hour) ?? []
  }));
}

function visibleCalendarMonthWeeks(
  weeks: CalendarMonthWeekViewModel[],
  visibleCalendarIds: ReadonlySet<string>
): VisibleCalendarMonthWeek[] {
  return weeks.map((week) => ({
    id: week.id,
    days: week.days.map((day) => {
      const visibleEvents = day.events.filter((event) => visibleCalendarEvent(event, visibleCalendarIds));
      const visibleEventChips = visibleEvents.slice(0, calendarMonthVisibleChipCount);

      return {
        day,
        overflowCount: Math.max(0, visibleEvents.length - visibleEventChips.length),
        visibleEventChips
      };
    })
  }));
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

const calendarSourceToneCache = new Map<string, (typeof calendarSourceTones)[number]>();

function calendarSourceTone(calendarId: string): (typeof calendarSourceTones)[number] {
  const cached = calendarSourceToneCache.get(calendarId);

  if (cached) {
    return cached;
  }

  let hash = 0;

  for (let index = 0; index < calendarId.length; index += 1) {
    hash = (hash * 31 + calendarId.charCodeAt(index)) >>> 0;
  }

  const tone = calendarSourceTones[hash % calendarSourceTones.length];
  calendarSourceToneCache.set(calendarId, tone);
  return tone;
}

function calendarEventLabel(
  event: CalendarEventViewModel,
  variant: "range" | "time" | "title"
): string {
  if (variant === "range") {
    return `${event.rangeLabel} ${event.title}`;
  }

  if (variant === "time") {
    return event.allDay ? event.title : `${event.timeLabel} ${event.title}`;
  }

  return event.title;
}

function CalendarSourceSwatch({
  calendarId,
  className
}: {
  calendarId: string;
  className?: string;
}): JSX.Element {
  const tone = calendarSourceTone(calendarId);

  return (
    <span
      aria-hidden="true"
      className={cx("size-2.5 shrink-0 rounded-full", tone.swatch, className)}
    />
  );
}

function CalendarEventChip({
  className,
  draggable = false,
  event,
  labelVariant,
  onDragStart,
  onKeyDown,
  onOpen
}: {
  className?: string;
  draggable?: boolean;
  event: CalendarEventViewModel;
  labelVariant: "range" | "time" | "title";
  onDragStart?: (dragEvent: DragEvent<HTMLElement>) => void;
  onKeyDown?: (keyEvent: KeyboardEvent<HTMLElement>) => void;
  onOpen?: (event: CalendarEventViewModel) => void;
}): JSX.Element {
  const tone = calendarSourceTone(event.calendarId);
  const label = calendarEventLabel(event, labelVariant);

  return (
    <button
      aria-label={label}
      className={cx(
        "group flex min-h-6 w-full min-w-0 cursor-default items-center gap-1.5 rounded-hcbSm border border-border border-l-4 bg-surface-0 px-2 py-1 text-left text-[var(--text-xs)] text-text-secondary shadow-sm transition-colors duration-fast ease-hcb hover:bg-surface-1 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        draggable && "cursor-grab active:cursor-grabbing",
        event.allDay && "bg-bg-secondary font-medium",
        tone.border,
        className
      )}
      draggable={draggable}
      onClick={(clickEvent) => {
        clickEvent.stopPropagation();
        onOpen?.(event);
      }}
      onDragStart={onDragStart}
      onKeyDown={onKeyDown}
      title={`${label} - ${event.calendar}`}
      type="button"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {event.mutationState && event.mutationState !== "synced" ? (
        <span
          aria-hidden="true"
          className={cx(
            "shrink-0 rounded-hcbSm px-1 text-[10px] font-semibold",
            event.mutationState === "failed" ? "bg-danger text-bg-tertiary" : "bg-warning text-bg-tertiary"
          )}
        >
          {event.mutationState === "failed" ? "Failed" : "Queued"}
        </span>
      ) : null}
    </button>
  );
}

function CalendarOverflowChip({ count }: { count: number }): JSX.Element {
  return (
    <span className="inline-flex min-h-5 max-w-full items-center truncate rounded-hcbSm border border-dashed border-border px-2 text-[var(--text-xs)] text-text-muted">
      {count} more
    </span>
  );
}

function splitAllDayEvents(events: CalendarEventViewModel[]): {
  allDayEvents: CalendarEventViewModel[];
  timedEvents: CalendarEventViewModel[];
} {
  const allDayEvents: CalendarEventViewModel[] = [];
  const timedEvents: CalendarEventViewModel[] = [];

  for (const event of events) {
    if (event.allDay) {
      allDayEvents.push(event);
    } else {
      timedEvents.push(event);
    }
  }

  return { allDayEvents, timedEvents };
}

function CalendarAllDayLane({
  dayLabel,
  events,
  onCreate,
  onOpen,
  visibleCount = 4
}: {
  dayLabel: string;
  events: CalendarEventViewModel[];
  onCreate?: () => void;
  onOpen: (event: CalendarEventViewModel) => void;
  visibleCount?: number;
}): JSX.Element {
  const visibleEvents = events.slice(0, visibleCount);
  const overflowCount = Math.max(0, events.length - visibleEvents.length);

  return (
    <div
      aria-label={`All-day events for ${dayLabel}`}
      className="grid min-h-10 grid-cols-[72px_minmax(0,1fr)] border-b border-border bg-bg-secondary"
      role="group"
    >
      <div className="border-r border-border px-2 py-2 text-[var(--text-xs)] font-medium text-text-muted">
        All day
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1 px-2 py-1.5">
        {visibleEvents.map((event) => (
          <div className="min-w-0 basis-[180px] grow" key={event.id}>
            <CalendarEventChip event={event} labelVariant="title" onOpen={onOpen} />
          </div>
        ))}
        {overflowCount > 0 ? <CalendarOverflowChip count={overflowCount} /> : null}
        {events.length === 0 && onCreate ? (
          <button
            className="min-h-7 rounded-hcbSm border border-dashed border-border px-2 text-left text-[var(--text-xs)] text-text-muted transition-colors duration-fast ease-hcb hover:bg-surface-0 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            data-action-id="calendar.create"
            onClick={onCreate}
            type="button"
          >
            Add all-day event
          </button>
        ) : null}
      </div>
    </div>
  );
}

function calendarStatusSummary(source: ReturnType<typeof useCoreViewModelSource>): {
  detail: string;
  label: string;
  tone: CompactTone;
} {
  if (source.isOffline) {
    return {
      detail: source.errorMessage ?? "Local cache only",
      label: "Offline",
      tone: "warning"
    };
  }

  if (source.dataState === "error") {
    return {
      detail: source.errorMessage ?? "Refresh failed",
      label: "Cache error",
      tone: "danger"
    };
  }

  if (source.isStale || source.dataState === "stale" || source.syncStatus.stale) {
    return {
      detail: "Cached rows visible",
      label: "Refreshing",
      tone: "info"
    };
  }

  if (source.syncStatus.state === "running") {
    return {
      detail: "Sync in progress",
      label: "Syncing",
      tone: "info"
    };
  }

  if (source.syncStatus.pendingMutationCount > 0) {
    return {
      detail: `${source.syncStatus.pendingMutationCount} pending write${source.syncStatus.pendingMutationCount === 1 ? "" : "s"}`,
      label: "Pending",
      tone: "warning"
    };
  }

  return {
    detail: source.syncStatus.lastCompletedAt ? "Fresh local cache" : "Local cache",
    label: "Ready",
    tone: "success"
  };
}

function CalendarStatusStrip({
  source,
  visibleCalendarCount,
  visibleEventCount
}: {
  source: ReturnType<typeof useCoreViewModelSource>;
  visibleCalendarCount: number;
  visibleEventCount: number;
}): JSX.Element {
  const status = calendarStatusSummary(source);

  return (
    <div
      aria-label="Calendar status"
      className="flex min-w-0 flex-wrap items-center justify-end gap-2"
      role="status"
    >
      <Badge tone={status.tone}>{status.label}</Badge>
      <Badge tone="accent">Visible calendars: {visibleCalendarCount}</Badge>
      <Badge tone="neutral">{visibleEventCount} events</Badge>
      <Badge tone="neutral">Default timezone: {source.settings.defaultTimeZone}</Badge>
    </div>
  );
}

function CalendarSourceRow({
  calendar,
  defaultTimeZone,
  onToggle,
  visible
}: {
  calendar: CalendarSourceViewModel;
  defaultTimeZone: string;
  onToggle: (calendarId: string, visible: boolean) => void;
  visible: boolean;
}): JSX.Element {
  const VisibilityIcon = visible ? Eye : EyeOff;

  return (
    <label
      className={cx(
        "grid min-h-10 grid-cols-[18px_14px_minmax(0,1fr)_auto] items-center gap-2 rounded-hcbMd border px-2.5 text-[var(--text-sm)] transition-colors duration-fast ease-hcb",
        visible
          ? "border-border bg-bg-tertiary text-text-secondary"
          : "border-dashed border-border bg-transparent text-text-muted"
      )}
    >
      <input
        aria-label={`${visible ? "Hide" : "Show"} ${calendar.title}`}
        checked={visible}
        className="accent-[var(--color-accent)]"
        onChange={(event) => onToggle(calendar.id, event.target.checked)}
        type="checkbox"
      />
      <CalendarSourceSwatch calendarId={calendar.id} className={visible ? undefined : "opacity-50"} />
      <span className="min-w-0 truncate">{calendar.title}</span>
      <span className="flex shrink-0 items-center gap-1">
        <VisibilityIcon aria-hidden="true" className="text-text-muted" size={13} />
        <Badge tone="neutral">{calendar.timeZone ?? defaultTimeZone}</Badge>
      </span>
    </label>
  );
}

function CalendarSourceVisibilityList({
  calendars,
  defaultTimeZone,
  onToggle,
  visibleCalendarIds
}: {
  calendars: CalendarSourceViewModel[];
  defaultTimeZone: string;
  onToggle: (calendarId: string, visible: boolean) => void;
  visibleCalendarIds: ReadonlySet<string>;
}): JSX.Element {
  const shownCalendars = calendars.filter((calendar) => visibleCalendarIds.has(calendar.id));
  const hiddenCalendars = calendars.filter((calendar) => !visibleCalendarIds.has(calendar.id));

  return (
    <div className="grid gap-3 p-3" role="group" aria-label="Calendar visibility">
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2 text-[var(--text-xs)] font-medium text-text-muted">
          <span>Shown</span>
          <span>{shownCalendars.length}</span>
        </div>
        {shownCalendars.map((calendar) => (
          <CalendarSourceRow
            calendar={calendar}
            defaultTimeZone={defaultTimeZone}
            key={calendar.id}
            onToggle={onToggle}
            visible
          />
        ))}
      </div>
      {hiddenCalendars.length > 0 ? (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2 text-[var(--text-xs)] font-medium text-text-muted">
            <span>Hidden</span>
            <span>{hiddenCalendars.length}</span>
          </div>
          {hiddenCalendars.map((calendar) => (
            <CalendarSourceRow
              calendar={calendar}
              defaultTimeZone={defaultTimeZone}
              key={calendar.id}
              onToggle={onToggle}
              visible={false}
            />
          ))}
        </div>
      ) : null}
      {calendars.length === 0 ? (
        <EmptyState
          description="No calendars have been cached yet."
          title="No calendars"
        />
      ) : null}
    </div>
  );
}

function CalendarContextPanel({
  defaultTimeZone,
  event,
  onOpen
}: {
  defaultTimeZone: string;
  event: CalendarEventViewModel | null;
  onOpen: (event: CalendarEventViewModel) => void;
}): JSX.Element {
  return (
    <Panel
      title="Context"
      description={event ? event.rangeLabel : "No visible event"}
    >
      <div className="p-3" role="region" aria-label="Calendar context">
        {event ? (
          <button
            className="grid w-full gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3 text-left transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={() => onOpen(event)}
            type="button"
          >
            <span className="flex min-w-0 items-center gap-2">
              <CalendarSourceSwatch calendarId={event.calendarId} />
              <span className="min-w-0 flex-1 truncate text-[var(--text-sm)] font-semibold text-text-primary">
                {event.title}
              </span>
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-2 text-[var(--text-xs)] text-text-muted">
              <Badge tone="neutral">{event.allDay ? "All day" : event.rangeLabel}</Badge>
              <Badge tone="neutral">{event.calendar}</Badge>
              <Badge tone="neutral">{event.timeZone || defaultTimeZone}</Badge>
            </span>
            {event.location ? (
              <span className="inline-flex min-w-0 items-center gap-1 text-[var(--text-xs)] text-text-muted">
                <MapPin aria-hidden="true" size={13} />
                <span className="truncate">{event.location}</span>
              </span>
            ) : null}
          </button>
        ) : (
          <EmptyState description="No events match the visible calendar sources." title="No context" />
        )}
      </div>
    </Panel>
  );
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
  const visibleDay = useMemo(
    () => visibleCalendarDay(source.calendarDayView, visibleCalendarIds),
    [source.calendarDayView.events, visibleCalendarIds]
  );
  const slots = useMemo<CalendarDaySlot[]>(
    () => calendarDaySlots(day, visibleDay.timedEvents),
    [day, visibleDay.timedEvents]
  );

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
      <div className="overflow-hidden rounded-hcbMd border border-border" role="grid" aria-label="Calendar day view">
        <CalendarAllDayLane
          dayLabel={source.calendarDayView.dateLabel}
          events={visibleDay.allDayEvents}
          onCreate={() => onCreate({ startsAt: `${day}T00:00:00.000Z`, allDay: true })}
          onOpen={onOpen}
        />
        <VirtualizedList
          ariaLabel="Calendar day hour slots"
          estimateRowHeight={calendarDaySlotRowHeight}
          getKey={(slot) => slot.hour}
          items={slots}
          overscan={2}
          performanceLabel="calendar.day"
          viewportHeight={calendarDayViewportHeight}
          renderRow={(slot) => (
            <div
              aria-label={`${slot.label} ${slot.events.length === 0 ? "Open slot" : `${slot.events.length} events`}`}
              className="grid min-h-16 grid-cols-[72px_minmax(0,1fr)] border-b border-border bg-bg-tertiary last:border-b-0"
              onDragOver={allowCalendarDrop}
              onDrop={(dragEvent) => {
                dragEvent.preventDefault();
                const resizeEventId = calendarEventResizeDragId(dragEvent);

                if (resizeEventId) {
                  onResizeEvent(resizeEventId, slot.startsAt);
                  return;
                }

                const eventId = calendarEventDragId(dragEvent);

                if (eventId) {
                  onMoveEvent(eventId, slot.startsAt, false);
                }
              }}
              role="row"
            >
              <button
                aria-label={`Create event at ${slot.label}`}
                className="border-r border-border px-2 py-2 text-left font-mono text-[var(--text-xs)] text-text-muted hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                data-action-id="calendar.create"
                onClick={() => onCreate({ startsAt: slot.startsAt, allDay: false })}
                type="button"
              >
                {slot.label}
              </button>
              <div className="grid content-start gap-1 px-2 py-1.5" role="gridcell">
                {slot.events.length > 0 ? (
                  slot.events.map((event) => (
                    <div
                      className="grid grid-cols-[minmax(0,1fr)_24px] gap-1"
                      key={event.id}
                    >
                      <CalendarEventChip
                        draggable
                        event={event}
                        labelVariant="range"
                        onDragStart={(dragEvent) => startCalendarEventDrag(dragEvent, event.id)}
                        onKeyDown={(keyEvent) => {
                          if (keyEvent.key !== "ArrowDown" && keyEvent.key !== "ArrowUp") {
                            return;
                          }

                          keyEvent.preventDefault();
                          keyEvent.stopPropagation();
                          const direction = keyEvent.key === "ArrowDown" ? 1 : -1;
                          onMoveEvent(
                            event.id,
                            new Date(Date.parse(event.startsAt) + direction * 15 * 60 * 1000).toISOString(),
                            event.allDay
                          );
                        }}
                        onOpen={onOpen}
                      />
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
                    className="min-h-8 rounded-hcbSm border border-dashed border-border px-2 text-left text-[var(--text-xs)] text-text-muted transition-colors duration-fast ease-hcb hover:bg-surface-0 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    data-action-id="calendar.create"
                    onClick={() => onCreate({ startsAt: slot.startsAt, allDay: false })}
                    type="button"
                  >
                    Open slot
                  </button>
                )}
              </div>
            </div>
          )}
        />
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
  const [scrollLeft, setScrollLeft] = useState(0);
  const weekWindow = useMemo(() => {
    const viewportWidth = calendarWeekColumnWidth * 5;
    const overscan = 1;
    const visibleCount = Math.ceil(viewportWidth / calendarWeekColumnWidth);
    const startIndex = Math.max(0, Math.floor(scrollLeft / calendarWeekColumnWidth) - overscan);
    const endIndex = Math.min(source.calendarWeekDays.length, startIndex + visibleCount + overscan * 2);

    return {
      endIndex,
      offsetX: startIndex * calendarWeekColumnWidth,
      startIndex,
      totalWidth: source.calendarWeekDays.length * calendarWeekColumnWidth
    };
  }, [scrollLeft, source.calendarWeekDays.length]);
  const visibleWeekDays = useMemo(
    () =>
      source.calendarWeekDays
        .slice(weekWindow.startIndex, weekWindow.endIndex)
        .map((day) => visibleCalendarDay(day, visibleCalendarIds)),
    [source.calendarWeekDays, visibleCalendarIds, weekWindow.endIndex, weekWindow.startIndex]
  );

  function handleWeekScroll(event: UIEvent<HTMLDivElement>): void {
    setScrollLeft(event.currentTarget.scrollLeft);
  }

  return (
    <Panel title="Week view" description="Visible week from cached event range">
      <div
        aria-label="Calendar week view"
        className="overflow-x-auto p-3"
        onScroll={handleWeekScroll}
        role="grid"
      >
        <div className="relative min-h-48" style={{ width: weekWindow.totalWidth }}>
          <div
            className="absolute inset-y-0 top-0 flex gap-2"
            style={{ transform: `translateX(${weekWindow.offsetX}px)` }}
          >
            {visibleWeekDays.map(({ allDayEvents, day, timedEvents }) => {
              const dayKey = day.id.slice("week-".length);
              const visibleAllDayEvents = allDayEvents.slice(0, calendarWeekVisibleAllDayCount);
              const visibleTimedEvents = timedEvents.slice(0, calendarWeekVisibleTimedCount);
              const overflowCount = Math.max(
                0,
                allDayEvents.length -
                  visibleAllDayEvents.length +
                  timedEvents.length -
                  visibleTimedEvents.length
              );

              return (
                <div
                  className={cx(
                    "min-h-56 shrink-0 overflow-hidden rounded-hcbMd border border-border bg-bg-tertiary text-left transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    day.isToday && "border-accent"
                  )}
                  key={day.id}
                  onClick={() => onCreate({ startsAt: `${dayKey}T00:00:00.000Z`, allDay: true })}
                  onDragOver={allowCalendarDrop}
                  onDrop={(dragEvent) => {
                    dragEvent.preventDefault();
                    const eventId = calendarEventDragId(dragEvent);
                    const draggedEvent = eventId ? source.calendarEventsById[eventId] : undefined;

                    if (!draggedEvent) {
                      return;
                    }

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
                      onCreate({ startsAt: `${dayKey}T00:00:00.000Z`, allDay: true })
                    )
                  }
                  role="gridcell"
                  style={{ width: calendarWeekColumnWidth }}
                  tabIndex={0}
                >
                  <div className="flex min-h-10 items-center justify-between gap-2 border-b border-border px-2">
                    <span className="text-[var(--text-xs)] font-medium text-text-muted">
                      {day.weekday}
                    </span>
                    <span className="text-[var(--text-md)] font-semibold text-text-primary">
                      {day.dateLabel}
                    </span>
                  </div>
                  <div className="grid gap-1 border-b border-border bg-bg-secondary/60 px-2 py-1.5">
                    {visibleAllDayEvents.length > 0 ? (
                      visibleAllDayEvents.map((calendarEvent) => (
                        <CalendarEventChip
                          draggable
                          event={calendarEvent}
                          key={calendarEvent.id}
                          labelVariant="title"
                          onDragStart={(dragEvent) => startCalendarEventDrag(dragEvent, calendarEvent.id)}
                          onKeyDown={(keyEvent) => {
                            keyEvent.stopPropagation();
                            handleActivationKeyDown(keyEvent, () => onOpen(calendarEvent));
                          }}
                          onOpen={onOpen}
                        />
                      ))
                    ) : (
                      <span className="min-h-6 truncate text-[var(--text-xs)] text-text-muted">
                        All-day lane
                      </span>
                    )}
                  </div>
                  <div className="grid gap-1 px-2 py-2">
                    {visibleTimedEvents.map((calendarEvent) => (
                      <CalendarEventChip
                        draggable
                        event={calendarEvent}
                        key={calendarEvent.id}
                        labelVariant="time"
                        onDragStart={(dragEvent) => startCalendarEventDrag(dragEvent, calendarEvent.id)}
                        onKeyDown={(keyEvent) => {
                          keyEvent.stopPropagation();
                          handleActivationKeyDown(keyEvent, () => onOpen(calendarEvent));
                        }}
                        onOpen={onOpen}
                      />
                    ))}
                    {overflowCount > 0 ? <CalendarOverflowChip count={overflowCount} /> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
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
  const visibleWeeks = useMemo(
    () => visibleCalendarMonthWeeks(source.calendarMonthWeeks, visibleCalendarIds),
    [source.calendarMonthWeeks, visibleCalendarIds]
  );

  return (
    <Panel title="Month view" description="Cached event range by day">
      <div className="grid gap-1 p-3" role="grid" aria-label="Calendar month view">
        {visibleWeeks.map((week) => (
          <div className="grid grid-cols-7 gap-1" key={week.id} role="row">
            {week.days.map(({ day, overflowCount, visibleEventChips }) => {
              return (
                <div
                  className={cx(
                    "grid min-h-[104px] grid-rows-[auto_minmax(0,1fr)] rounded-hcbSm border border-border bg-bg-tertiary p-2 text-left transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
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
                  <div className="mt-2 grid min-h-0 content-start gap-1 overflow-hidden">
                    {visibleEventChips.map((calendarEvent) => (
                      <CalendarEventChip
                        className="min-h-5 px-1.5 py-0.5 text-[11px]"
                        event={calendarEvent}
                        key={calendarEvent.id}
                        labelVariant="title"
                        onKeyDown={(keyEvent) => {
                          keyEvent.stopPropagation();
                          handleActivationKeyDown(keyEvent, () => onOpen(calendarEvent));
                        }}
                        onOpen={onOpen}
                      />
                    ))}
                    {overflowCount > 0 ? <CalendarOverflowChip count={overflowCount} /> : null}
                  </div>
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
  const {
    close: closeInspector,
    current: currentInspector,
    open: openInspector,
    update: updateInspector
  } = useInspector();
  const [activeViewId, setActiveViewId] = useState<CalendarViewId>("agenda");
  const [draft, setDraftState] = useState<CalendarEventDraft | null>(null);
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
  const calendarDraftRef = useRef<CalendarEventDraft | null>(draft);
  const calendarDraftBaselineRef = useRef<CalendarEventDraft | null>(draft);
  const calendarInspectorDirtyRef = useRef(false);
  const calendarInspectorInstanceRef = useRef(0);
  const setDraft = useCallback<Dispatch<SetStateAction<CalendarEventDraft | null>>>((next) => {
    setDraftState((current) => {
      const resolved =
        typeof next === "function"
          ? (next as (value: CalendarEventDraft | null) => CalendarEventDraft | null)(current)
          : next;

      calendarDraftRef.current = resolved;
      calendarInspectorDirtyRef.current = !calendarEventDraftsEqual(
        resolved,
        calendarDraftBaselineRef.current
      );

      return resolved;
    });
  }, []);
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
  const visibleUpcomingEvent = useMemo(() => {
    const nowMs = Date.now();
    return (
      visibleCalendarEvents.find((event) => Date.parse(event.endsAt) >= nowMs) ??
      visibleCalendarEvents[0] ??
      null
    );
  }, [visibleCalendarEvents]);
  const calendarStatus = calendarStatusSummary(source);
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
        openCreate();
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

  useEffect(() => {
    if (currentInspector?.kind !== "event" || !draft) {
      return;
    }

    const dirty = !calendarEventDraftsEqual(draft, calendarDraftBaselineRef.current);
    calendarInspectorDirtyRef.current = dirty;
    updateInspector({
      actions: eventInspectorActions(draft),
      body: eventInspectorBody(draft),
      dirty,
      subtitle: eventInspectorSubtitle(draft),
      title: eventInspectorTitle(draft)
    });
  }, [
    currentInspector?.kind,
    draft,
    formError,
    source.calendarSources,
    source.settings.defaultTimeZone,
    updateInspector
  ]);

  if (
    (source.dataState === "loading" ||
      source.dataState === "offline" ||
      source.dataState === "error") &&
    !source.hasCachedData
  ) {
    return <CacheStatePanel title="Calendar" />;
  }

  function canReplaceEventInspector(): boolean {
    return currentInspector?.kind !== "event" || !calendarInspectorDirtyRef.current;
  }

  function eventInspectorTitle(nextDraft: CalendarEventDraft): string {
    return nextDraft.mode === "edit" ? nextDraft.title || "Event" : "New event";
  }

  function eventInspectorSubtitle(nextDraft: CalendarEventDraft): string {
    const calendar = source.calendarSources.find((calendarSource) => calendarSource.id === nextDraft.calendarId);
    return `${calendar?.title ?? "Calendar"} · ${calendarDraftRangeLabel(nextDraft)}`;
  }

  function eventInspectorBody(nextDraft: CalendarEventDraft): ReactNode {
    return (
      <CalendarEventForm
        calendars={source.calendarSources}
        defaultTimeZone={source.settings.defaultTimeZone}
        draft={nextDraft}
        error={formError}
        key={calendarInspectorInstanceRef.current}
        setDraft={(next) => setDraft(next)}
      />
    );
  }

  function eventInspectorActions(nextDraft: CalendarEventDraft): ReactNode {
    return (
      <>
        {nextDraft.mode === "edit" ? (
          <Button onClick={() => void deleteDraft()} size="sm" variant="danger">
            <Trash2 aria-hidden="true" size={14} />
            Delete event
          </Button>
        ) : null}
        <Button onClick={() => void cancelEventInspector()} size="sm" variant="ghost">
          <X aria-hidden="true" size={14} />
          Cancel
        </Button>
        <Button onClick={() => void saveDraft()} size="sm" variant="primary">
          <Save aria-hidden="true" size={14} />
          Save
        </Button>
      </>
    );
  }

  function openEventInspector(nextDraft: CalendarEventDraft): void {
    calendarInspectorInstanceRef.current += 1;
    calendarDraftBaselineRef.current = nextDraft;
    calendarDraftRef.current = nextDraft;
    calendarInspectorDirtyRef.current = false;
    setFormError(undefined);
    setDraft(nextDraft);
    openInspector({
      actions: eventInspectorActions(nextDraft),
      body: eventInspectorBody(nextDraft),
      dirty: false,
      id: nextDraft.id ?? "new",
      kind: "event",
      onConfirmClose: () => !calendarInspectorDirtyRef.current,
      subtitle: eventInspectorSubtitle(nextDraft),
      title: eventInspectorTitle(nextDraft)
    });
  }

  function openCreate(seed?: { startsAt?: string; allDay?: boolean }): void {
    if (!canReplaceEventInspector()) {
      return;
    }

    openEventInspector(newCalendarDraft(source, seed));
  }

  function openEdit(event: CalendarEventViewModel): void {
    if (!canReplaceEventInspector()) {
      return;
    }

    openEventInspector(editCalendarDraft(event));
  }

  async function closeEventInspectorAfterMutation(): Promise<void> {
    calendarDraftBaselineRef.current = null;
    calendarDraftRef.current = null;
    calendarInspectorDirtyRef.current = false;
    setDraft(null);
    setFormError(undefined);
    await closeInspector();
    source.refresh();
  }

  async function saveDraft(): Promise<void> {
    const currentDraft = calendarDraftRef.current;

    if (!currentDraft) {
      return;
    }

    const payload = calendarEventPayload(currentDraft);

    if (!payload.title) {
      setFormError("Title is required.");
      return;
    }

    if (!payload.calendarId) {
      setFormError("Choose a calendar.");
      return;
    }

    const result =
      currentDraft.mode === "create"
        ? await window.hcb?.calendar.create(payload)
        : await window.hcb?.calendar.update({
            id: currentDraft.id ?? "",
            ...payload
          } satisfies CalendarEventUpdateRequest);

    if (!result?.ok) {
      setFormError(result?.error.message ?? "Calendar event write failed.");
      return;
    }

    await closeEventInspectorAfterMutation();
  }

  async function deleteDraft(): Promise<void> {
    const currentDraft = calendarDraftRef.current;

    if (!currentDraft?.id) {
      return;
    }

    const result = await window.hcb?.calendar.delete({ id: currentDraft.id });

    if (!result?.ok) {
      setFormError(result?.error.message ?? "Calendar event delete failed.");
      return;
    }

    await closeEventInspectorAfterMutation();
  }

  async function cancelEventInspector(): Promise<void> {
    calendarDraftBaselineRef.current = null;
    calendarDraftRef.current = null;
    calendarInspectorDirtyRef.current = false;
    setDraft(null);
    setFormError(undefined);
    await closeInspector();
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Calendar views">
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
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
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
          <CalendarStatusStrip
            source={source}
            visibleCalendarCount={visibleCalendarIdSet.size}
            visibleEventCount={visibleCalendarEvents.length}
          />
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
            {source.isOffline ? (
              <Panel title="Offline state" description="Google sync">
                <OfflineState />
              </Panel>
            ) : null}
            <Panel title="Status" description={calendarStatus.detail}>
              <div className="grid gap-2 p-3">
                <div className="flex items-center justify-between gap-2 text-[var(--text-sm)] text-text-secondary">
                  <span>Cache</span>
                  <Badge tone={calendarStatus.tone}>{calendarStatus.label}</Badge>
                </div>
                <div className="flex items-center justify-between gap-2 text-[var(--text-sm)] text-text-secondary">
                  <span>Pending writes</span>
                  <Badge tone={source.syncStatus.pendingMutationCount > 0 ? "warning" : "neutral"}>
                    {source.syncStatus.pendingMutationCount}
                  </Badge>
                </div>
              </div>
            </Panel>
            <CalendarContextPanel
              defaultTimeZone={source.settings.defaultTimeZone}
              event={visibleUpcomingEvent}
              onOpen={openEdit}
            />
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
              description={`${visibleCalendarIdSet.size}/${source.calendarSources.length} shown`}
            >
              <CalendarSourceVisibilityList
                calendars={source.calendarSources}
                defaultTimeZone={source.settings.defaultTimeZone}
                onToggle={toggleVisibleCalendar}
                visibleCalendarIds={visibleCalendarIdSet}
              />
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
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                      <CalendarSourceSwatch calendarId={calendar.id} />
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

function NotesView(): JSX.Element {
  const source = useCoreViewModelSource();
  const {
    close: closeInspector,
    current: currentInspector,
    open: openInspector,
    update: updateInspector
  } = useInspector();
  const [notes, setNotes] = useState<NoteViewModel[]>(source.initialNotes);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    source.initialNotes[0]?.id ?? null
  );
  const [draftCounter, setDraftCounter] = useState(1);
  const requestedNoteDetails = useRef(new Set<string>());
  const lastNoteEditReportAt = useRef(0);
  const noteInspectorBodyRef = useRef<NoteInspectorBodyHandle | null>(null);
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

  useEffect(() => {
    if (currentInspector?.kind !== "note" || !selectedNote || currentInspector.id !== selectedNote.id) {
      return;
    }

    updateInspector({
      actions: noteInspectorActions(selectedNote),
      body: noteInspectorBody(selectedNote),
      subtitle: selectedNote.updatedLabel,
      title: selectedNote.title || "Untitled note"
    });
  }, [
    currentInspector?.id,
    currentInspector?.kind,
    notes,
    selectedNote,
    updateInspector
  ]);

  if (
    (source.dataState === "loading" ||
      source.dataState === "offline" ||
      source.dataState === "error") &&
    !source.hasCachedData
  ) {
    return <CacheStatePanel title="Notes" />;
  }

  function noteInspectorBody(note: NoteViewModel): ReactNode {
    return (
      <NoteInspectorBody
        key={note.id}
        note={note}
        notes={notes}
        onDraftChange={updateNoteDraft}
        onOpenNote={selectNote}
        onPersist={persistNoteDraft}
        ref={noteInspectorBodyRef}
      />
    );
  }

  function noteInspectorActions(note: NoteViewModel): ReactNode {
    return (
      <>
        <Button onClick={() => void deleteNote(note.id)} size="sm" variant="danger">
          <Trash2 aria-hidden="true" size={14} />
          Delete selected note
        </Button>
        <Button onClick={() => void closeInspector()} size="sm" variant="ghost">
          <X aria-hidden="true" size={14} />
          Close
        </Button>
      </>
    );
  }

  function openNoteInspector(note: NoteViewModel): void {
    openInspector({
      actions: noteInspectorActions(note),
      body: noteInspectorBody(note),
      dirty: false,
      id: note.id,
      kind: "note",
      onConfirmClose: async () => {
        await noteInspectorBodyRef.current?.flush();
        return true;
      },
      subtitle: note.updatedLabel,
      title: note.title || "Untitled note"
    });
  }

  async function selectNote(noteId: string): Promise<void> {
    const note = notes.find((candidate) => candidate.id === noteId);

    if (!note) {
      return;
    }

    await noteInspectorBodyRef.current?.flush();
    setSelectedNoteId(note.id);
    openNoteInspector(note);
  }

  async function createNote(): Promise<void> {
    await noteInspectorBodyRef.current?.flush();

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
    openNoteInspector(fallbackNote);

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
      openNoteInspector(persisted);
    }
  }

  async function createNoteWithTemplate(title: string, body: string): Promise<void> {
    await noteInspectorBodyRef.current?.flush();

    const fallbackId = `note-draft-${draftCounter}`;
    const fallbackNote: NoteViewModel = {
      id: fallbackId,
      title,
      body,
      preview: buildNotePreview(body),
      updatedLabel: "Just now"
    };

    setDraftCounter((current) => current + 1);
    setNotes((current) => [fallbackNote, ...current]);
    setSelectedNoteId(fallbackId);
    openNoteInspector(fallbackNote);

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
      openNoteInspector(persisted);
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

  function updateNoteDraft(noteId: string, draft: NoteDraftValue): void {
    const startedAt = rendererNow();
    setNotes((current) =>
      current.map((note) => {
        if (note.id !== noteId) {
          return note;
        }

        return {
          ...note,
          title: draft.title,
          body: draft.body,
          preview: buildNotePreview(draft.body),
          updatedLabel: "Edited locally"
        };
      })
    );

    if (startedAt !== null && startedAt - lastNoteEditReportAt.current > 250) {
      lastNoteEditReportAt.current = startedAt;
      scheduleRendererFrame(() => {
        reportRendererTimingSince("notes.edit.local", startedAt, {
          field: "body",
          noteCount: notes.length
        });
      });
    }
  }

  async function persistNoteDraft(noteId: string, draft: NoteDraftValue): Promise<boolean> {
    if (noteId.startsWith("note-draft-")) {
      return true;
    }

    const result = await window.hcb?.notes.update({
      id: noteId,
      title: draft.title,
      body: draft.body
    });

    return result?.ok ?? false;
  }

  async function deleteNote(noteId: string): Promise<void> {
    const note = notes.find((candidate) => candidate.id === noteId);

    if (!note) {
      return;
    }

    if (!note.id.startsWith("note-draft-")) {
      await window.hcb?.notes.delete({ id: note.id });
    }

    const nextNotes = notes.filter((candidate) => candidate.id !== note.id);
    const nextNote = nextNotes[0] ?? null;

    setNotes(nextNotes);
    setSelectedNoteId(nextNote?.id ?? null);

    if (nextNote) {
      openNoteInspector(nextNote);
      return;
    }

    await closeInspector();
  }

  return (
    <div className="grid h-full min-h-0">
      <Panel
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              data-action-id="note.create"
              onClick={() => void createNote()}
              size="sm"
              title={actionDescription("note.create")}
              variant="primary"
            >
              <Plus aria-hidden="true" size={14} />
              {actionLabel("note.create")}
            </Button>
            <Button onClick={createDailyNote} size="sm" variant="secondary">
              <CalendarPlus aria-hidden="true" size={14} />
              Daily note
            </Button>
            <Button onClick={createMeetingNote} size="sm" variant="ghost">
              <Pencil aria-hidden="true" size={14} />
              Meeting note
            </Button>
          </div>
        }
        title="Local notes"
        description="Select a note to open details in the Inspector"
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
                onClick={() => void selectNote(note.id)}
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
          viewportHeight={520}
        />
      </Panel>
    </div>
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

function sanitizeInspectorDetails(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeInspectorDetails);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLowerCase();

    if (
      normalized.includes("token") ||
      normalized.includes("secret") ||
      normalized.includes("credential") ||
      normalized.includes("password") ||
      normalized.includes("path") ||
      normalized.includes("payload") ||
      normalized.includes("body")
    ) {
      result[key] = "[redacted]";
      continue;
    }

    result[key] = sanitizeInspectorDetails(entry);
  }

  return result;
}

function sanitizedJson(value: unknown): string {
  return JSON.stringify(sanitizeInspectorDetails(value), null, 2);
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
  const { open: openInspector } = useInspector();
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
  const effectiveThemeMode = resolveAppThemeMode(settings.theme, currentSystemPrefersDark());
  const matchingColorThemes = appColorThemes.filter(
    (theme) => theme.isDark === (effectiveThemeMode === "dark")
  );
  const activeColorTheme = resolveAppColorTheme(settings.colorTheme, effectiveThemeMode);
  const defaultTimeZoneOptions = timeZoneOptions([
    settings.defaultTimeZone,
    googleStatus.account?.timeZone,
    ...source.calendarSources.map((calendar) => calendar.timeZone),
    ...source.calendarAgendaEvents.map((event) => event.timeZone)
  ]);
  const [googleClientId, setGoogleClientId] = useState(googleStatus.clientId ?? "");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [fontNameDraft, setFontNameDraft] = useState(settings.uiFontName ?? "");
  const [systemFontFamilies, setSystemFontFamilies] = useState<string[]>([]);
  const systemFontFamiliesRequested = useRef(false);
  const availableFontFamilies = useMemo(
    () => fontFamilyOptions(systemFontFamilies, settings.uiFontName),
    [settings.uiFontName, systemFontFamilies]
  );

  useEffect(() => {
    setGoogleClientId(googleStatus.clientId ?? "");
  }, [googleStatus.clientId]);

  useEffect(() => {
    setFontNameDraft(settings.uiFontName ?? "");
  }, [settings.uiFontName]);

  useEffect(() => {
    if (selectedSectionId !== "appearance" || systemFontFamiliesRequested.current || !window.hcb) {
      return;
    }

    systemFontFamiliesRequested.current = true;
    void window.hcb.native.listFontFamilies().then((result) => {
      if (result.ok) {
        setSystemFontFamilies(result.data.families);
      }
    });
  }, [selectedSectionId]);

  function updateSettings(request: SettingsUpdateRequest): void {
    setRecoveryMessage(null);
    void source.updateSettings(request);
  }

  function updateBaseTheme(theme: SettingsSnapshot["theme"]): void {
    const nextMode = resolveAppThemeMode(theme, currentSystemPrefersDark());
    const currentColorTheme = resolveAppColorTheme(settings.colorTheme, effectiveThemeMode);
    const nextColorTheme = currentColorTheme.isDark === (nextMode === "dark")
      ? currentColorTheme
      : defaultAppColorTheme(nextMode);

    updateSettings({
      theme,
      colorTheme: nextColorTheme.id
    });
  }

  function saveFontName(value: string): void {
    const trimmed = value.trim();

    updateSettings({ uiFontName: trimmed ? trimmed : null });
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

  function copyDiagnosticsPayload(payload: string): void {
    void navigator.clipboard?.writeText(payload);
    setRecoveryMessage("Diagnostics summary copied without credentials, raw Google payloads, MCP bearer tokens, or sensitive bodies.");
  }

  async function openDiagnosticsDetails(): Promise<void> {
    const summaryResult = diagnostics ? null : await window.hcb?.diagnostics.summary();
    const freshDiagnostics = diagnostics ?? (summaryResult?.ok ? summaryResult.data : null);
    const payload = sanitizedJson(freshDiagnostics ?? { rows: selectedSection.rows });

    openInspector({
      actions: (
        <Button onClick={() => copyDiagnosticsPayload(payload)} size="sm" variant="primary">
          <Copy aria-hidden="true" size={14} />
          Copy
        </Button>
      ),
      body: (
        <pre
          aria-label="Sanitized diagnostics JSON"
          className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-hcbMd border border-border bg-surface-0 p-3 font-mono text-[var(--text-xs)] text-text-primary"
        >
          {payload}
        </pre>
      ),
      id: "diagnostics-summary",
      kind: "diagnostics",
      subtitle: "Sanitized JSON",
      title: "Diagnostics details"
    });
  }

  function openCapabilityDetails(
    capability: NativeCapabilityDescriptor,
    report: DiagnosticsSummaryResponse["native"]
  ): void {
    const relatedDiagnostics = report.diagnostics.filter((diagnostic) => diagnostic.key === capability.key);
    const primaryDiagnostic = relatedDiagnostics[0] ?? null;
    const payload = sanitizedJson({
      capability,
      diagnostics: relatedDiagnostics,
      metadata: {
        platform: report.platform,
        adapterId: report.adapterId,
        packageFormat: report.packageFormat,
        flags: report.flags
      }
    });

    openInspector({
      body: (
        <div className="grid gap-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <MetricTile label="State" value={capability.state} />
            <MetricTile label="Severity" value={primaryDiagnostic?.severity ?? (capability.supported ? "info" : "warning")} />
          </div>
          <StatusBanner
            description={primaryDiagnostic?.message ?? capability.message ?? "No remediation required."}
            title="Remediation"
            tone={primaryDiagnostic?.severity === "blocker" ? "danger" : capability.supported ? "info" : "warning"}
          />
          <pre
            aria-label="Capability metadata"
            className="max-h-80 overflow-auto whitespace-pre-wrap rounded-hcbMd border border-border bg-surface-0 p-3 font-mono text-[var(--text-xs)] text-text-primary"
          >
            {payload}
          </pre>
        </div>
      ),
      id: `capability-${capability.key}`,
      kind: "settings",
      subtitle: capability.state,
      title: capability.label
    });
  }

  function openNativeDiagnosticDetails(
    diagnostic: NativeCapabilityDiagnostic,
    report: DiagnosticsSummaryResponse["native"]
  ): void {
    const payload = sanitizedJson({
      diagnostic,
      metadata: {
        platform: report.platform,
        adapterId: report.adapterId,
        packageFormat: report.packageFormat
      }
    });

    openInspector({
      body: (
        <div className="grid gap-3">
          <MetricTile label="Severity" value={diagnostic.severity} />
          <StatusBanner description={diagnostic.message} title="Diagnostic" tone={diagnostic.severity === "blocker" ? "danger" : "warning"} />
          <pre
            aria-label="Native diagnostic metadata"
            className="max-h-80 overflow-auto whitespace-pre-wrap rounded-hcbMd border border-border bg-surface-0 p-3 font-mono text-[var(--text-xs)] text-text-primary"
          >
            {payload}
          </pre>
        </div>
      ),
      id: `diagnostic-${diagnostic.key}`,
      kind: "diagnostics",
      subtitle: diagnostic.severity,
      title: diagnostic.key
    });
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
        <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary sm:col-span-2">
            <span>Default timezone</span>
            <select
              aria-label="Default timezone"
              className={settingsSelectClass}
              onChange={(event) => updateSettings({ defaultTimeZone: event.target.value })}
              value={settings.defaultTimeZone}
            >
              {defaultTimeZoneOptions.map((timeZone) => (
                <option key={timeZone} value={timeZone}>
                  {timeZone}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
            <span>Today capacity</span>
            <Input
              aria-label="Today capacity minutes"
              max={1440}
              min={5}
              onChange={(event) =>
                updateSettings({ todayCapacityMinutes: Number(event.target.value) })
              }
              type="number"
              value={settings.todayCapacityMinutes}
            />
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
              <span>Start hour</span>
              <Input
                aria-label="Today working hours start"
                max={23}
                min={0}
                onChange={(event) =>
                  updateSettings({ todayWorkingHoursStart: Number(event.target.value) })
                }
                type="number"
                value={settings.todayWorkingHoursStart}
              />
            </label>
            <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
              <span>End hour</span>
              <Input
                aria-label="Today working hours end"
                max={24}
                min={1}
                onChange={(event) =>
                  updateSettings({ todayWorkingHoursEnd: Number(event.target.value) })
                }
                type="number"
                value={settings.todayWorkingHoursEnd}
              />
            </label>
          </div>
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
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
              <span>Theme</span>
              <select
                aria-label="Theme"
                className={settingsSelectClass}
                onChange={(event) => updateBaseTheme(event.target.value as SettingsSnapshot["theme"])}
                value={settings.theme}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
              <span>Color theme</span>
              <select
                aria-label="Color theme"
                className={settingsSelectClass}
                onChange={(event) => updateSettings({ colorTheme: event.target.value as AppColorThemeId })}
                value={activeColorTheme.id}
              >
                {matchingColorThemes.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
              <span>Font family</span>
              <Input
                aria-label="Font family"
                list="ui-font-family-options"
                onBlur={(event) => saveFontName(event.currentTarget.value)}
                onChange={(event) => setFontNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
                placeholder="System"
                value={fontNameDraft}
              />
              <datalist id="ui-font-family-options">
                {availableFontFamilies.map((fontName) => (
                  <option key={fontName} value={fontName} />
                ))}
              </datalist>
            </label>
            <Button
              onClick={() => {
                setFontNameDraft("");
                updateSettings({ uiFontName: null });
              }}
              size="sm"
              variant="ghost"
            >
              Reset font
            </Button>
          </div>
          <div className="grid gap-2 rounded-hcbMd border border-border bg-bg-tertiary p-3">
            <div className="flex items-center justify-between gap-3">
              <label className="text-[var(--text-sm)] font-medium text-text-primary" htmlFor="ui-text-size">
                Text size
              </label>
              <span className="font-mono text-[var(--text-xs)] text-text-muted">
                {settings.uiTextSizePoints} pt
              </span>
            </div>
            <input
              aria-label="Text size"
              className="w-full accent-[var(--color-accent)]"
              id="ui-text-size"
              max={24}
              min={9}
              onChange={(event) => updateSettings({ uiTextSizePoints: Number(event.target.value) })}
              step={1}
              type="range"
              value={settings.uiTextSizePoints}
            />
            <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[96px_auto]">
              <Input
                aria-label="Text size points"
                max={24}
                min={9}
                onBlur={(event) =>
                  updateSettings({
                    uiTextSizePoints: Math.min(24, Math.max(9, Number(event.currentTarget.value) || 13))
                  })
                }
                onChange={(event) =>
                  updateSettings({
                    uiTextSizePoints: Math.min(24, Math.max(9, Number(event.target.value) || 13))
                  })
                }
                step={1}
                type="number"
                value={settings.uiTextSizePoints}
              />
              <Button onClick={() => updateSettings({ uiTextSizePoints: 13 })} size="sm" variant="ghost">
                Reset size
              </Button>
            </div>
          </div>
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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
      const nativeReport = diagnostics?.native ?? source.native.capabilityReport;

      return (
        <div className="grid gap-3 p-3">
          <SettingsRows rows={selectedSection.rows} status={selectedSection.status} />
          {nativeReport?.capabilities.length ? (
            <div className="grid gap-2" role="list" aria-label="Native capabilities">
              {nativeReport.capabilities.map((capability) => (
                <button
                  aria-label={`Open capability ${capability.label}`}
                  className="flex min-h-11 w-full items-center gap-3 rounded-hcbMd border border-border bg-bg-tertiary px-3 py-2 text-left transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  key={capability.key}
                  onClick={() => openCapabilityDetails(capability, nativeReport)}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[var(--text-md)] font-medium text-text-primary">
                      {capability.label}
                    </span>
                    <span className="block truncate text-[var(--text-sm)] text-text-muted">
                      {capability.message ?? (capability.supported ? "Available" : "Unavailable")}
                    </span>
                  </span>
                  <span className="shrink-0">
                    <Badge tone={capability.supported ? "success" : "warning"}>
                      {capability.state}
                    </Badge>
                  </span>
                </button>
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
                <button
                  aria-label={`Open native diagnostic ${diagnostic.key}`}
                  className="flex min-h-11 w-full items-center gap-3 rounded-hcbMd border border-border bg-bg-tertiary px-3 py-2 text-left transition-colors duration-fast ease-hcb hover:bg-surface-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  key={`${diagnostic.key}-${diagnostic.message}`}
                  onClick={() => openNativeDiagnosticDetails(diagnostic, nativeReport)}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[var(--text-md)] font-medium text-text-primary">
                      {diagnostic.key}
                    </span>
                    <span className="block truncate text-[var(--text-sm)] text-text-muted">
                      {diagnostic.message}
                    </span>
                  </span>
                  <Badge tone={diagnostic.severity === "blocker" ? "danger" : "warning"}>{diagnostic.severity}</Badge>
                </button>
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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
              onClick={() => void openDiagnosticsDetails()}
              size="sm"
              title={actionDescription("diagnostics.copy")}
              variant="ghost"
            >
              <Copy aria-hidden="true" size={14} />
              Copy details
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
          <div className="grid grid-cols-2 gap-2 p-3 lg:grid-cols-4">
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

function timeZoneOptions(values: Array<string | null | undefined>): string[] {
  const system = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const seen = new Set<string>();
  const options: string[] = [];

  for (const value of [...values, system, "UTC"]) {
    const trimmed = value?.trim();

    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    options.push(trimmed);
  }

  return options;
}

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

  if (activeSectionId === "settings") {
    return <SettingsView />;
  }

  return <TodayView />;
}
