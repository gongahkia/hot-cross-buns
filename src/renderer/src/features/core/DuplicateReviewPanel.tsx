import { AlertTriangle, CalendarDays, Check, FileText, GitMerge, ListChecks, RefreshCw, Trash2, X } from "lucide-react";
import { Badge, Button, IconButton, cx } from "../../components/primitives";
import type { CoreViewModelSource } from "./coreViewModelSource";
import type { CalendarEventViewModel, NoteViewModel, TaskViewModel } from "./coreViewModels";

type DuplicateKind = "task" | "event" | "note";

interface DuplicateItem {
  detail: string;
  id: string;
  kind: DuplicateKind;
  title: string;
}

export interface DuplicateGroup {
  id: string;
  items: DuplicateItem[];
  keyLabel: string;
  kind: DuplicateKind;
  reason: string;
  title: string;
}

interface DuplicateReviewPanelProps {
  onOpenTask: (taskId: string) => void;
  source: CoreViewModelSource;
}

const iconByKind = {
  task: ListChecks,
  event: CalendarDays,
  note: FileText
};

export function DuplicateReviewPanel({ onOpenTask, source }: DuplicateReviewPanelProps): JSX.Element | null {
  const groups = duplicateGroups(source);

  if (groups.length === 0) {
    return null;
  }

  async function dismissGroup(groupId: string): Promise<void> {
    await source.updateSettings({
      dismissedDuplicateGroupIds: [...new Set([...source.settings.dismissedDuplicateGroupIds, groupId])]
    });
  }

  async function deleteItem(item: DuplicateItem): Promise<void> {
    if (!window.confirm(`Delete "${item.title}"?`)) {
      return;
    }

    if (item.kind === "task") {
      await source.deleteTask(item.id);
      return;
    }

    const result = item.kind === "event"
      ? await window.hcb?.calendar.delete({ id: item.id })
      : await window.hcb?.notes.delete({ id: item.id });

    if (!result?.ok) {
      window.alert(result?.error.message ?? "Delete failed.");
      return;
    }

    source.refreshUndoStatus();
    source.refresh();
  }

  function openItem(item: DuplicateItem): void {
    if (item.kind === "task") {
      onOpenTask(item.id);
      return;
    }

    window.dispatchEvent(new CustomEvent("hcb:open-entity", {
      detail: { id: item.id, kind: item.kind }
    }));
  }

  async function mergeGroup(group: DuplicateGroup): Promise<void> {
    if (group.items.length < 2 || !window.confirm(`Merge ${group.items.length} duplicate ${group.kind}s into the first item?`)) {
      return;
    }

    const [winnerItem, ...loserItems] = group.items;

    if (!winnerItem) {
      return;
    }

    const merged = await window.hcb?.duplicates.cleanup({
      kind: group.kind,
      winnerId: winnerItem.id,
      loserIds: loserItems.map((item) => item.id)
    });

    if (!merged?.ok) {
      window.alert(merged?.error.message ?? "Merge failed.");
      return;
    }

    await dismissGroup(group.id);
    source.refreshUndoStatus();
    source.refresh();
  }

  return (
    <section className="overflow-hidden rounded-hcbLg border border-border bg-bg-secondary">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <AlertTriangle aria-hidden="true" className="text-warning" size={16} />
        <h2 className="text-[var(--text-md)] font-semibold text-text-primary">Duplicate review</h2>
        <Badge tone="warning">{groups.length}</Badge>
        <div className="flex-1" />
        <Button onClick={() => source.refresh()} size="sm" variant="ghost">
          <RefreshCw aria-hidden="true" size={14} />
          Refresh
        </Button>
      </div>
      <div className="grid max-h-80 overflow-auto">
        {groups.map((group) => {
          const Icon = iconByKind[group.kind];

          return (
            <div className="grid gap-2 border-b border-border p-3 last:border-b-0" key={group.id}>
              <div className="flex min-w-0 items-start gap-2">
                <Icon aria-hidden="true" className="mt-0.5 shrink-0 text-text-muted" size={16} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[var(--text-sm)] font-semibold text-text-primary">{group.title}</div>
                  <div className="truncate text-[var(--text-xs)] text-text-muted">{group.reason} · {group.keyLabel}</div>
                </div>
                <IconButton icon={GitMerge} label="Merge duplicate group" onClick={() => void mergeGroup(group)} variant="ghost" />
                <IconButton icon={X} label="Dismiss duplicate group" onClick={() => void dismissGroup(group.id)} variant="ghost" />
              </div>
              <div className="grid gap-1.5">
                {group.items.map((item) => (
                  <div
                    className={cx(
                      "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-hcbMd border border-border bg-bg-primary px-2 py-1.5"
                    )}
                    key={item.id}
                  >
                    <button className="min-w-0 text-left" onClick={() => openItem(item)} type="button">
                      <div className="truncate text-[var(--text-sm)] font-medium text-text-primary">{item.title}</div>
                      <div className="truncate text-[var(--text-xs)] text-text-muted">{item.detail}</div>
                    </button>
                    <div className="flex items-center gap-1">
                      <IconButton icon={Check} label="Open duplicate item" onClick={() => openItem(item)} variant="ghost" />
                      <IconButton icon={Trash2} label="Delete duplicate item" onClick={() => void deleteItem(item)} variant="ghost" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* kept for duplicate grouping tests; cleanup is applied by the domain service. */
async function mergeTaskDuplicates(
  winnerId: string,
  loserIds: string[],
  source: CoreViewModelSource
): Promise<boolean> {
  const tasks = [winnerId, ...loserIds]
    .map((id) => source.largeTaskWindow.find((task) => task.id === id))
    .filter((task): task is TaskViewModel => task !== undefined);
  const winner = tasks[0];

  if (!winner || tasks.length < 2) {
    window.alert("Merge failed: duplicate tasks are no longer loaded.");
    return false;
  }

  const ok = await source.updateTask({
    id: winner.id,
    notes: mergeText(tasks.map((task) => task.detail), 10_000),
    priority: highestPriority(tasks.map((task) => task.priority)),
    tags: uniqueText(tasks.flatMap((task) => task.tags ?? [])),
    durationMinutes: maxNullable(tasks.map((task) => task.durationMinutes ?? null)),
    snoozeUntil: minIso(tasks.map((task) => task.snoozeUntil ?? null))
  });

  if (!ok) {
    window.alert("Merge failed: winner task update did not apply.");
    return false;
  }

  for (const loserId of loserIds) {
    if (!await source.deleteTask(loserId)) {
      window.alert(`Merge partially applied: could not delete duplicate task ${loserId}.`);
      return false;
    }
  }

  return true;
}

async function mergeEventDuplicates(
  winnerId: string,
  loserIds: string[],
  source: CoreViewModelSource
): Promise<boolean> {
  const events = [winnerId, ...loserIds]
    .map((id) => source.calendarAgendaEvents.find((event) => event.id === id))
    .filter((event): event is CalendarEventViewModel => event !== undefined);
  const winner = events[0];

  if (!winner || events.length < 2) {
    window.alert("Merge failed: duplicate events are no longer loaded.");
    return false;
  }

  const update = await window.hcb?.calendar.update({
    id: winner.id,
    notes: mergeText(events.map((event) => event.notes), 20_000),
    guestEmails: uniqueText(events.flatMap((event) => event.guestEmails)),
    reminderMinutes: uniqueNumbers(events.flatMap((event) => event.reminderMinutes)),
    tags: uniqueText(events.flatMap((event) => event.tags ?? [])),
    colorId: winner.colorId ?? events.find((event) => event.colorId)?.colorId ?? null
  });

  if (!update?.ok) {
    window.alert(update?.error.message ?? "Merge failed: winner event update did not apply.");
    return false;
  }

  for (const loserId of loserIds) {
    const deleted = await window.hcb?.calendar.delete({ id: loserId });

    if (!deleted?.ok) {
      window.alert(deleted?.error.message ?? `Merge partially applied: could not delete duplicate event ${loserId}.`);
      return false;
    }
  }

  return true;
}

async function mergeNoteDuplicates(
  winnerId: string,
  loserIds: string[],
  source: CoreViewModelSource
): Promise<boolean> {
  const notes = [winnerId, ...loserIds]
    .map((id) => source.initialNotes.find((note) => note.id === id))
    .filter((note): note is NoteViewModel => note !== undefined);
  const winner = notes[0];

  if (!winner || notes.length < 2) {
    window.alert("Merge failed: duplicate notes are no longer loaded.");
    return false;
  }

  const update = await window.hcb?.notes.update({
    id: winner.id,
    body: mergeText(notes.map((note) => note.body), 50_000),
    tags: uniqueText(notes.flatMap((note) => note.tags ?? []))
  });

  if (!update?.ok) {
    window.alert(update?.error.message ?? "Merge failed: winner note update did not apply.");
    return false;
  }

  for (const loserId of loserIds) {
    const deleted = await window.hcb?.notes.delete({ id: loserId });

    if (!deleted?.ok) {
      window.alert(deleted?.error.message ?? `Merge partially applied: could not delete duplicate note ${loserId}.`);
      return false;
    }
  }

  return true;
}

function mergeText(values: readonly string[], maxLength: number): string {
  const merged = values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join("\n\n--- merged duplicate ---\n\n");

  return merged.length <= maxLength ? merged : merged.slice(0, maxLength);
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function maxNullable(values: ReadonlyArray<number | null>): number | null {
  const numbers = values.filter((value): value is number => typeof value === "number" && value >= 0);
  return numbers.length === 0 ? null : Math.max(...numbers);
}

function minIso(values: ReadonlyArray<string | null>): string | null {
  const dates = values.filter((value): value is string => Boolean(value));
  return dates.length === 0 ? null : dates.sort()[0] ?? null;
}

function highestPriority(values: readonly TaskViewModel["priority"][]): TaskViewModel["priority"] {
  const order: Record<TaskViewModel["priority"], number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3
  };
  return values.reduce((best, value) => order[value] > order[best] ? value : best, "none");
}

export function duplicateGroups(source: CoreViewModelSource): DuplicateGroup[] {
  const dismissed = new Set(source.settings.dismissedDuplicateGroupIds);
  return [
    ...groupTaskDuplicates(source.largeTaskWindow),
    ...groupEventDuplicates(source.calendarAgendaEvents.filter((event) => event.sourceKind !== "task")),
    ...groupNoteDuplicates(source.initialNotes)
  ].filter((group) => !dismissed.has(group.id));
}

function groupTaskDuplicates(tasks: readonly TaskViewModel[]): DuplicateGroup[] {
  return duplicateGroupsFromItems(
    tasks.filter((task) => task.status === "open"),
    (task) => ["task", normalizeTitle(task.title), task.listId, task.dueDate ?? "no-due"].join("|"),
    (task) => ({
      detail: `${task.list} · ${task.dueLabel}${task.snoozeUntil ? " · snoozed" : ""}`,
      id: task.id,
      kind: "task",
      title: task.title
    }),
    "task",
    "same title, list, due date, and active status"
  );
}

function groupNoteDuplicates(notes: readonly NoteViewModel[]): DuplicateGroup[] {
  return duplicateGroupsFromItems(
    notes,
    (note) => ["note", normalizeTitle(note.title), note.listId].join("|"),
    (note) => ({
      detail: `${note.listTitle} · ${note.updatedLabel}`,
      id: note.id,
      kind: "note",
      title: note.title
    }),
    "note",
    "same title and note list"
  );
}

function groupEventDuplicates(events: readonly CalendarEventViewModel[]): DuplicateGroup[] {
  return duplicateGroupsFromItems(
    events.filter((event) => event.status !== "cancelled"),
    (event) => [
      "event",
      normalizeTitle(event.title),
      event.calendarId,
      event.startsAt,
      event.endsAt,
      event.allDay ? "all-day" : "timed"
    ].join("|"),
    (event) => ({
      detail: `${event.calendar} · ${event.rangeLabel}`,
      id: event.id,
      kind: "event",
      title: event.title
    }),
    "event",
    "same title, calendar, start, end, and all-day state"
  );
}

function duplicateGroupsFromItems<T>(
  items: readonly T[],
  keyFor: (item: T) => string,
  itemFor: (item: T) => DuplicateItem,
  kind: DuplicateKind,
  reason: string
): DuplicateGroup[] {
  const grouped = new Map<string, T[]>();

  for (const item of items) {
    const key = keyFor(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  return Array.from(grouped.entries())
    .filter(([, groupItems]) => groupItems.length > 1)
    .map(([key, groupItems]) => {
      const duplicateItems = groupItems.map(itemFor);
      const title = duplicateItems[0]?.title || "Untitled";
      return {
        id: `dup-${hashString(key)}`,
        items: duplicateItems,
        keyLabel: title,
        kind,
        reason,
        title
      };
    });
}

function normalizeTitle(value: string): string {
  return value.normalize("NFKD").trim().toLowerCase().replace(/\s+/g, " ");
}

function hashString(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}
