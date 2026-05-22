import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  Copy,
  Filter,
  Plus,
  Search,
  Settings2,
  Trash2
} from "lucide-react";
import { Badge, Button, IconButton, Input, ListRow, Panel, cx } from "../../components/primitives";
import { EmptyState, ErrorState, LoadingState, OfflineState } from "../../components/states";
import { VirtualizedList } from "../../components/VirtualizedList";
import type { SectionId } from "../../data/mockPlanner";
import { useCoreViewModelSource } from "./coreViewModelSource";
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

  if (status === "Conflict" || status === "Not requested") {
    return "warning";
  }

  if (status === "Mock only" || status === "Enabled shell") {
    return "info";
  }

  return "neutral";
}

function MetricTile({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0 rounded-hcbMd border border-border bg-bg-secondary px-3 py-2">
      <div className="truncate text-[var(--text-xs)] text-text-muted">{label}</div>
      <div className="mt-1 truncate text-[var(--text-lg)] font-semibold text-text-primary">{value}</div>
    </div>
  );
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
  onToggle,
  task
}: {
  completed: boolean;
  onToggle: (taskId: string) => void;
  task: TaskViewModel;
}): JSX.Element {
  return (
    <div
      className="min-h-[76px] border-b border-border bg-transparent px-3 py-2 last:border-b-0"
      role="listitem"
    >
      <div className="flex min-w-0 items-start gap-3">
        <TaskCompletionButton completed={completed} onToggle={onToggle} task={task} />
        <div className="min-w-0 flex-1">
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
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={priorityTone(task.priority)}>{priorityLabel(task.priority)}</Badge>
          <Badge>{task.list}</Badge>
        </div>
      </div>
    </div>
  );
}

function TaskGroupPanel({
  completionById,
  group,
  onToggleTask
}: {
  completionById: Record<string, boolean>;
  group: TaskGroupViewModel;
  onToggleTask: (taskId: string) => void;
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
        renderRow={(task) => (
          <TaskRow
            completed={completionById[task.id] ?? task.status === "completed"}
            onToggle={onToggleTask}
            task={task}
          />
        )}
        viewportHeight={Math.min(250, Math.max(106, group.tasks.length * 88))}
      />
    </Panel>
  );
}

function EventRow({ event }: { event: CalendarEventViewModel }): JSX.Element {
  return (
    <ListRow
      description={`${event.calendar} - ${event.location} - ${event.notes}`}
      leading={
        <span className="flex h-7 w-16 shrink-0 items-center justify-center rounded-hcbSm border border-border bg-surface-0 font-mono text-[var(--text-xs)] text-text-secondary">
          {event.timeLabel}
        </span>
      }
      meta={event.rangeLabel}
      title={event.title}
      trailing={<Badge tone="accent">Event</Badge>}
    />
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
        <Panel title="Timeline" description="Tasks and calendar agenda from mock preload data">
          <VirtualizedList
            ariaLabel="Today timeline"
            estimateRowHeight={58}
            getKey={(row, index) => `${row.kind}-${index}`}
            items={timelineRows}
            renderRow={(row) => <TodayTimelineRow row={row} />}
            viewportHeight={306}
          />
        </Panel>
      </SectionChrome>
    </div>
  );
}

function TasksView(): JSX.Element {
  const source = useCoreViewModelSource();
  const [activeFilterId, setActiveFilterId] = useState<TaskFilterId>("open");
  const [completionById, setCompletionById] = useState<Record<string, boolean>>({});
  const activeFilter = source.getTaskFilterViewModel(activeFilterId);

  function toggleTask(taskId: string): void {
    const task = source.getTaskById(taskId);
    setCompletionById((current) => ({
      ...current,
      [taskId]: !(current[taskId] ?? task.status === "completed")
    }));
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2" role="toolbar" aria-label="Task actions">
          <Button variant="primary">
            <Plus aria-hidden="true" size={15} />
            New task
          </Button>
          <Button variant="ghost">Move</Button>
          <Button variant="ghost">Delete</Button>
        </div>
        <Badge tone="success">Mutation queue idle</Badge>
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

      <SectionChrome
        title="Tasks"
        sidebar={
          <div className="grid gap-3">
            <Panel title="Large task window" description="Virtualized placeholder list">
              <VirtualizedList
                ariaLabel="Large task placeholder"
                estimateRowHeight={52}
                getKey={(task) => task.id}
                items={source.largeTaskWindow}
                renderRow={(task) => (
                  <ListRow
                    description={task.detail}
                    meta={task.dueLabel}
                    title={task.title}
                    trailing={<Badge tone={priorityTone(task.priority)}>{priorityLabel(task.priority)}</Badge>}
                  />
                )}
                viewportHeight={210}
              />
            </Panel>
            <Panel title="Loading state" description="Future cache read placeholder">
              <LoadingState />
            </Panel>
          </div>
        }
      >
        {activeFilter.state === "empty" ? (
          <Panel title="Task list" description="Empty filtered state">
            <EmptyState
              description="No tasks match this mock filter. Future cache results can render here without changing layout."
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
                completionById={completionById}
                group={group}
                key={group.id}
                onToggleTask={toggleTask}
              />
            ))}
          </div>
        )}
      </SectionChrome>
    </div>
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

function DayView(): JSX.Element {
  const source = useCoreViewModelSource();

  return (
    <Panel title="Day view shell" description={`${source.calendarDayView.weekday}, ${source.calendarDayView.dateLabel}`}>
      <div className="grid gap-2 p-3" role="grid" aria-label="Calendar day view">
        {source.calendarDayView.events.map((event) => (
          <div
            className="grid min-h-14 grid-cols-[74px_minmax(0,1fr)] gap-3 rounded-hcbMd border border-border bg-bg-tertiary p-2"
            key={event.id}
            role="row"
          >
            <div className="font-mono text-[var(--text-xs)] text-text-muted" role="gridcell">
              {event.rangeLabel}
            </div>
            <div className="min-w-0" role="gridcell">
              <div className="truncate text-[var(--text-md)] font-medium text-text-primary">{event.title}</div>
              <div className="truncate text-[var(--text-xs)] text-text-muted">{event.location}</div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function WeekView(): JSX.Element {
  const source = useCoreViewModelSource();

  return (
    <Panel title="Week view shell" description="Visible week is pre-expanded by mock view model">
      <div className="grid grid-cols-7 gap-2 p-3" role="grid" aria-label="Calendar week view">
        {source.calendarWeekDays.map((day) => (
          <div
            className={cx(
              "min-h-44 rounded-hcbMd border border-border bg-bg-tertiary p-2",
              day.isToday && "border-accent"
            )}
            key={day.id}
            role="gridcell"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--text-xs)] font-medium text-text-muted">{day.weekday}</span>
              <span className="text-[var(--text-md)] font-semibold text-text-primary">{day.dateLabel}</span>
            </div>
            <div className="mt-2 grid gap-1">
              {day.events.slice(0, 3).map((event) => (
                <div
                  className="truncate rounded-hcbSm border border-border bg-surface-0 px-2 py-1 text-[var(--text-xs)] text-text-secondary"
                  key={event.id}
                >
                  {event.timeLabel} {event.title}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function MonthView(): JSX.Element {
  const source = useCoreViewModelSource();

  return (
    <Panel title="Month view shell" description="May 2026 mock month grid">
      <div className="grid gap-1 p-3" role="grid" aria-label="Calendar month view">
        {source.calendarMonthWeeks.map((week) => (
          <div className="grid grid-cols-7 gap-1" key={week.id} role="row">
            {week.days.map((day) => (
              <div
                className={cx(
                  "min-h-20 rounded-hcbSm border border-border bg-bg-tertiary p-2",
                  day.isToday && "border-accent",
                  day.isOutsideMonth && "opacity-55"
                )}
                key={day.id}
                role="gridcell"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--text-xs)] text-text-muted">{day.weekday}</span>
                  <span className="text-[var(--text-sm)] font-semibold text-text-primary">{day.dateLabel}</span>
                </div>
                {day.events[0] ? (
                  <div className="mt-2 truncate rounded-hcbSm bg-surface-0 px-2 py-1 text-[var(--text-xs)] text-text-secondary">
                    {day.events[0].title}
                  </div>
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2" role="tablist" aria-label="Calendar views">
          {(["agenda", "day", "week", "month"] as CalendarViewId[]).map((viewId) => (
            <CalendarTabButton
              active={viewId === activeViewId}
              key={viewId}
              onClick={() => setActiveViewId(viewId)}
            >
              {viewId[0].toUpperCase()}
              {viewId.slice(1)}
            </CalendarTabButton>
          ))}
        </div>
        <Badge tone="accent">Selected calendars: Product, Engineering, QA</Badge>
      </div>

      <SectionChrome
        title="Calendar"
        sidebar={
          <div className="grid gap-3">
            <Panel title="Offline state" description="No Google Calendar call is made">
              <OfflineState />
            </Panel>
            <Panel title="Calendar sources" description="Mock selected calendars">
              <div role="list">
                {["Product", "Engineering", "QA"].map((calendar) => (
                  <ListRow
                    key={calendar}
                    leading={<CalendarDays aria-hidden="true" className="text-accent" size={16} />}
                    title={calendar}
                    trailing={<Badge tone="success">On</Badge>}
                  />
                ))}
              </div>
            </Panel>
          </div>
        }
      >
        {activeViewId === "agenda" ? (
          <Panel title="Agenda view shell" description="Windowed rows for future event ranges">
            <VirtualizedList
              ariaLabel="Calendar agenda"
              estimateRowHeight={58}
              getKey={(event) => event.id}
              items={source.calendarAgendaEvents}
              renderRow={(event) => <EventRow event={event} />}
              viewportHeight={352}
            />
          </Panel>
        ) : null}
        {activeViewId === "day" ? <DayView /> : null}
        {activeViewId === "week" ? <WeekView /> : null}
        {activeViewId === "month" ? <MonthView /> : null}
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
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;

  function createNote(): void {
    const nextNote: NoteViewModel = {
      id: `note-draft-${draftCounter}`,
      title: "Untitled note",
      body: "",
      preview: "Empty local note",
      updatedLabel: "Just now"
    };

    setDraftCounter((current) => current + 1);
    setNotes((current) => [nextNote, ...current]);
    setSelectedNoteId(nextNote.id);
  }

  function updateSelectedNote(updates: Partial<Pick<NoteViewModel, "title" | "body">>): void {
    if (!selectedNote) {
      return;
    }

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
  }

  function deleteSelectedNote(): void {
    if (!selectedNote) {
      return;
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
          description="Renderer state only"
        >
          <VirtualizedList
            ariaLabel="Local notes"
            emptyState={
              <EmptyState
                description="Create a local mock note to repopulate this renderer state."
                title="No local notes"
              />
            }
            estimateRowHeight={66}
            getKey={(note) => note.id}
            items={notes}
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
        description="Create, edit, and delete stay in local mock state"
      >
        {selectedNote ? (
          <div className="grid gap-3 p-3">
            <Input
              aria-label="Note title"
              onChange={(event) => updateSelectedNote({ title: event.target.value })}
              value={selectedNote.title}
            />
            <textarea
              aria-label="Note body"
              className="min-h-[260px] w-full resize-none rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-base)] text-text-primary placeholder:text-text-muted transition-colors duration-fast ease-hcb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
  const source = useCoreViewModelSource();
  const searchViewModel = useMemo(() => source.getSearchViewModel(query), [query, source]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          size={15}
        />
        <Input
          aria-label="Search local mock data"
          className="pl-9"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tasks, events, and notes"
          value={query}
        />
      </div>

      <Panel
        action={<Badge tone={searchViewModel.state === "results" ? "success" : "neutral"}>{searchViewModel.summary}</Badge>}
        title="Search results"
        description="Capped local result buckets; no Google requests per keystroke"
      >
        {searchViewModel.state === "idle" ? (
          <EmptyState
            description="Type a local query to preview task, event, and note result buckets."
            title="Search waits for a local query"
          />
        ) : searchViewModel.state === "empty" ? (
          <EmptyState
            description="Try a mock task, event, agenda, cache, command, or note query."
            title="No matching mock results"
          />
        ) : (
          <VirtualizedList
            ariaLabel="Search results"
            estimateRowHeight={60}
            getKey={(result) => result.id}
            items={searchViewModel.results}
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
  const selectedSection =
    source.settingsSections.find((section) => section.id === selectedSectionId) ??
    source.settingsSections[0];

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
            <Button size="sm" variant="ghost">
              <Copy aria-hidden="true" size={14} />
              Copy diagnostics
            </Button>
          }
          title={selectedSection.title}
          description={selectedSection.detail}
        >
          <div className="grid gap-3 p-3">
            <div role="list">
              {selectedSection.rows.map((row) => (
                <ListRow
                  description={row.value}
                  key={row.id}
                  title={row.label}
                  trailing={<Badge tone={settingTone(selectedSection.status)}>{selectedSection.status}</Badge>}
                />
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex min-h-9 items-center gap-2 rounded-hcbMd border border-border bg-bg-tertiary px-3 text-[var(--text-sm)] text-text-secondary">
                <input
                  aria-label={`${selectedSection.title} enabled`}
                  className="accent-[var(--color-accent)]"
                  defaultChecked={selectedSection.id !== "mcp"}
                  type="checkbox"
                />
                Enabled in mock settings
              </label>
              <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
                <span>Mode</span>
                <select
                  aria-label={`${selectedSection.title} mode`}
                  className="h-8 rounded-hcbMd border border-border bg-surface-0 px-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  defaultValue="mock"
                >
                  <option value="mock">Mock</option>
                  <option value="later">Wire later</option>
                </select>
              </label>
            </div>
          </div>
        </Panel>

        <Panel title="Diagnostics state" description="Sanitized status and recoverable errors">
          {selectedSection.id === "hotkeys" ? (
            <ErrorState />
          ) : (
            <div className="grid grid-cols-3 gap-2 p-3">
              <div className="rounded-hcbMd border border-border bg-bg-tertiary p-3">
                <div className="text-[var(--text-xs)] text-text-muted">Secret exposure</div>
                <div className="mt-1 text-[var(--text-md)] font-semibold text-success">Redacted</div>
              </div>
              <div className="rounded-hcbMd border border-border bg-bg-tertiary p-3">
                <div className="text-[var(--text-xs)] text-text-muted">IPC contract</div>
                <div className="mt-1 text-[var(--text-md)] font-semibold text-warning">Missing</div>
              </div>
              <div className="rounded-hcbMd border border-border bg-bg-tertiary p-3">
                <div className="text-[var(--text-xs)] text-text-muted">Renderer mode</div>
                <div className="mt-1 text-[var(--text-md)] font-semibold text-info">Mock</div>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </SectionChrome>
  );
}

export function SectionContent({
  activeSectionId,
  searchQuery,
  setSearchQuery
}: {
  activeSectionId: SectionId;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}): JSX.Element {
  if (activeSectionId === "tasks") {
    return <TasksView />;
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
