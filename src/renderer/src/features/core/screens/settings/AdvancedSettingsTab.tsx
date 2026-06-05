import { defaultHistoryCategoryVisibility } from "@shared/ipc/contracts";
import type {
  CalendarListSummary,
  SettingsRecoveryActionRequest,
  SettingsSnapshot,
  SettingsUpdateRequest,
  TaskListSummary
} from "@shared/ipc/contracts";
import {
  Archive,
  CalendarDays,
  ChevronRight,
  Database,
  FileDown,
  FilePlus2,
  Filter,
  History,
  Layers3,
  ListChecks,
  RotateCcw,
  Upload
} from "lucide-react";
import { Badge, Button, Input } from "../../../../components/primitives";
import { EmptyState } from "../../../../components/states";
import {
  SettingsControlRow,
  SettingsGroup,
  SettingsSwitch,
  settingsSelectClass
} from "./SettingsPrimitives";

interface AdvancedSettingsTabProps {
  beginRecoveryAction: (action: SettingsRecoveryActionRequest["action"]) => void;
  calendarSources: CalendarListSummary[];
  settings: SettingsSnapshot;
  taskLists: TaskListSummary[];
  updateSelectedCalendar: (calendarId: string, selected: boolean) => void;
  updateSelectedTaskList: (taskListId: string, selected: boolean) => void;
  updateSettings: (request: SettingsUpdateRequest) => void;
}

const historyCategoryLabels: Record<keyof SettingsSnapshot["historyCategoryVisibility"], string> = {
  created: "Created",
  edited: "Edited",
  deleted: "Deleted",
  completedReopened: "Completed / reopened",
  duplicated: "Duplicated",
  movedBetweenLists: "Moved between lists",
  clipboard: "Clipboard (copy / paste / cut)",
  restored: "Restored",
  bulkActions: "Bulk actions",
  syncDiffs: "Sync diffs",
  other: "Other"
};

export function AdvancedSettingsTab({
  beginRecoveryAction,
  calendarSources,
  settings,
  taskLists,
  updateSelectedCalendar,
  updateSelectedTaskList,
  updateSettings
}: AdvancedSettingsTabProps): JSX.Element {
  const selectedTaskLists = new Set(settings.selectedTaskListIds);
  const selectedCalendars = new Set(settings.selectedCalendarIds);
  const noteTemplates = settings.noteTemplates ?? [];

  function updatePerTabFilter(
    tab: keyof SettingsSnapshot["perTabListFilters"],
    patch: Partial<SettingsSnapshot["perTabListFilters"][typeof tab]>
  ): void {
    updateSettings({
      perTabListFilters: {
        ...settings.perTabListFilters,
        [tab]: {
          ...settings.perTabListFilters[tab],
          ...patch
        }
      }
    });
  }

  function togglePerTabList(tab: keyof SettingsSnapshot["perTabListFilters"], taskListId: string, selected: boolean): void {
    const current = new Set(settings.perTabListFilters[tab].selectedTaskListIds);

    if (selected) {
      current.add(taskListId);
    } else {
      current.delete(taskListId);
    }

    updatePerTabFilter(tab, { selectedTaskListIds: [...current] });
  }

  function addSavedFilter(): void {
    const now = new Date().toISOString();
    updateSettings({
      savedSearchViews: [
        ...settings.savedSearchViews,
        {
          id: crypto.randomUUID(),
          name: `Filter ${settings.savedSearchViews.length + 1}`,
          query: "source:tasks status:active",
          createdAt: now,
          updatedAt: now
        }
      ]
    });
  }

  function addTaskTemplate(): void {
    const now = new Date().toISOString();
    updateSettings({
      taskTemplates: [
        ...settings.taskTemplates,
        {
          id: crypto.randomUUID(),
          name: `Task Template ${settings.taskTemplates.length + 1}`,
          title: "{{prompt:Title}}",
          notes: null,
          dueExpression: "{{today}}",
          listId: null,
          createdAt: now,
          updatedAt: now
        }
      ]
    });
  }

  function addEventTemplate(): void {
    const now = new Date().toISOString();
    updateSettings({
      eventTemplates: [
        ...settings.eventTemplates,
        {
          id: crypto.randomUUID(),
          name: `Event Template ${settings.eventTemplates.length + 1}`,
          title: "{{prompt:Topic}}",
          notes: null,
          location: null,
          calendarId: null,
          startExpression: "{{today}} 09:00",
          endExpression: "{{today}} 10:00",
          attendeeEmails: [],
          createdAt: now,
          updatedAt: now
        }
      ]
    });
  }

  function addNoteTemplate(): void {
    const now = new Date().toISOString();
    updateSettings({
      noteTemplates: [
        ...noteTemplates,
        {
          id: crypto.randomUUID(),
          name: `Note Template ${noteTemplates.length + 1}`,
          title: "Untitled note",
          body: "",
          createdAt: now,
          updatedAt: now
        }
      ]
    });
  }

  function updateNoteTemplate(
    templateId: string,
    patch: Partial<SettingsSnapshot["noteTemplates"][number]>
  ): void {
    const now = new Date().toISOString();
    updateSettings({
      noteTemplates: noteTemplates.map((template) =>
        template.id === templateId ? { ...template, ...patch, updatedAt: now } : template
      )
    });
  }

  async function importPortableSettings(file: File): Promise<void> {
    const text = await file.text();
    const parsed = JSON.parse(text) as Partial<SettingsSnapshot>;

    updateSettings({
      ...(parsed.theme ? { theme: parsed.theme } : {}),
      ...(parsed.colorTheme ? { colorTheme: parsed.colorTheme } : {}),
      ...(parsed.keybindings ? { keybindings: parsed.keybindings } : {}),
      ...(parsed.selectedTaskListIds ? { selectedTaskListIds: parsed.selectedTaskListIds } : {}),
      ...(parsed.selectedCalendarIds ? { selectedCalendarIds: parsed.selectedCalendarIds } : {}),
      ...(parsed.savedSearchViews ? { savedSearchViews: parsed.savedSearchViews } : {}),
      ...(parsed.savedTaskViews ? { savedTaskViews: parsed.savedTaskViews } : {}),
      ...(parsed.taskTemplates ? { taskTemplates: parsed.taskTemplates } : {}),
      ...(parsed.eventTemplates ? { eventTemplates: parsed.eventTemplates } : {}),
      ...(parsed.noteTemplates ? { noteTemplates: parsed.noteTemplates } : {})
    });
  }

  return (
    <div className="grid gap-5">
      <SettingsGroup title="Calendars">
        <SettingsSwitch
          checked={settings.showCompletedInCalendarViews}
          icon={CalendarDays}
          label="Show completed tasks and events in calendar views"
          onChange={(checked) => updateSettings({ showCompletedInCalendarViews: checked })}
        />
        <SettingsControlRow
          description="Default scope when marking a repeating event complete or open again."
          icon={CalendarDays}
          label="Event completion scope"
        >
          <select
            aria-label="Event completion scope"
            className={settingsSelectClass}
            onChange={(event) =>
              updateSettings({
                eventCompletionDefaultScope: event.target.value as SettingsSnapshot["eventCompletionDefaultScope"]
              })
            }
            value={settings.eventCompletionDefaultScope}
          >
            <option value="occurrence">This occurrence</option>
            <option value="seriesFuture">Future series</option>
            <option value="seriesAll">Whole series</option>
            <option value="ask">Ask each time</option>
          </select>
        </SettingsControlRow>
        {calendarSources.length === 0 ? (
          <EmptyState description="No calendars are available yet." title="No calendars" />
        ) : calendarSources.map((calendar) => (
          <SettingsSwitch
            checked={selectedCalendars.size === 0 ? calendar.selected : selectedCalendars.has(calendar.id)}
            key={calendar.id}
            label={calendar.title}
            onChange={(checked) => updateSelectedCalendar(calendar.id, checked)}
            trailing={<Badge>{calendar.eventCount ?? 0}</Badge>}
          />
        ))}
      </SettingsGroup>

      <SettingsGroup title="Task lists">
        {taskLists.length === 0 ? (
          <EmptyState description="No Google Tasks lists are available yet." title="No task lists" />
        ) : taskLists.map((taskList) => (
          <SettingsSwitch
            checked={selectedTaskLists.size === 0 || selectedTaskLists.has(taskList.id)}
            icon={ListChecks}
            key={taskList.id}
            label={taskList.title}
            onChange={(checked) => updateSelectedTaskList(taskList.id, checked)}
            trailing={<Badge>{taskList.activeTaskCount ?? taskList.taskCount ?? 0}</Badge>}
          />
        ))}
      </SettingsGroup>

      <SettingsGroup title="Per-tab list filters">
        <SettingsControlRow
          description="Each tab can hide lists independently of the global Task Lists selection."
          icon={Filter}
          label="Tasks tab"
        >
          <Button
            onClick={() =>
              updatePerTabFilter("tasks", {
                useCustomFilter: !settings.perTabListFilters.tasks.useCustomFilter
              })
            }
            variant={settings.perTabListFilters.tasks.useCustomFilter ? "primary" : "secondary"}
          >
            Use custom filter
          </Button>
        </SettingsControlRow>
        {settings.perTabListFilters.tasks.useCustomFilter ? taskLists.map((taskList) => (
          <SettingsSwitch
            checked={settings.perTabListFilters.tasks.selectedTaskListIds.includes(taskList.id)}
            key={`tasks-${taskList.id}`}
            label={taskList.title}
            onChange={(checked) => togglePerTabList("tasks", taskList.id, checked)}
          />
        )) : null}
        <SettingsControlRow icon={ChevronRight} label="Notes tab">
          <Button
            onClick={() =>
              updatePerTabFilter("notes", {
                useCustomFilter: !settings.perTabListFilters.notes.useCustomFilter
              })
            }
            variant={settings.perTabListFilters.notes.useCustomFilter ? "primary" : "secondary"}
          >
            Use custom filter
          </Button>
        </SettingsControlRow>
        {settings.perTabListFilters.notes.useCustomFilter ? taskLists.map((taskList) => (
          <SettingsSwitch
            checked={settings.perTabListFilters.notes.selectedTaskListIds.includes(taskList.id)}
            key={`notes-${taskList.id}`}
            label={taskList.title}
            onChange={(checked) => togglePerTabList("notes", taskList.id, checked)}
          />
        )) : null}
      </SettingsGroup>

      <SettingsGroup title="Data control">
        <SettingsSwitch
          checked={settings.syncTasksEnabled}
          icon={Database}
          label="Tasks and notes"
          description="Google Tasks lists, tasks, notes, and queued task writes."
          onChange={(checked) => updateSettings({ syncTasksEnabled: checked })}
        />
        <SettingsSwitch
          checked={settings.syncCalendarEventsEnabled}
          icon={CalendarDays}
          label="Calendar events"
          description="Google Calendar lists, events, and queued event writes."
          onChange={(checked) => updateSettings({ syncCalendarEventsEnabled: checked })}
        />
      </SettingsGroup>

      <SettingsGroup title="Portable export">
        <SettingsControlRow
          description="Exports settings and planner data into a folder package."
          icon={Archive}
          label="Portable archive"
        >
          <Button onClick={() => beginRecoveryAction("exportPortableArchive")} variant="secondary">
            <FileDown aria-hidden="true" size={14} />
            Export portable archive
          </Button>
        </SettingsControlRow>
        <SettingsSwitch
          checked={settings.portableExportOnlySelectedTaskLists}
          label="Only selected task lists"
          onChange={(checked) => updateSettings({ portableExportOnlySelectedTaskLists: checked })}
        />
        <SettingsSwitch
          checked={settings.portableExportOnlySelectedCalendars}
          label="Only selected calendars"
          onChange={(checked) => updateSettings({ portableExportOnlySelectedCalendars: checked })}
        />
        <SettingsSwitch
          checked={settings.portableExportOnlyFutureCurrentEvents}
          label="Only future/current events"
          onChange={(checked) => updateSettings({ portableExportOnlyFutureCurrentEvents: checked })}
        />
        <SettingsControlRow label="Import portable archive">
          <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-hcbMd border border-border bg-surface-0 px-3 text-[var(--text-base)] font-medium text-text-primary hover:bg-surface-1">
            <Upload aria-hidden="true" size={14} />
            Import settings JSON
            <input
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) {
                  void importPortableSettings(file);
                }
              }}
              type="file"
            />
          </label>
        </SettingsControlRow>
      </SettingsGroup>

      <SettingsGroup title="Local backups">
        <SettingsSwitch
          checked={settings.dailyLocalBackupEnabled}
          label="Daily local backup"
          onChange={(checked) => updateSettings({ dailyLocalBackupEnabled: checked })}
        />
        <SettingsControlRow label="Keep backups">
          <Input
            aria-label="Keep backups"
            className="w-24"
            max={365}
            min={1}
            onChange={(event) =>
              updateSettings({ localBackupRetentionCount: Number(event.currentTarget.value) || 14 })
            }
            type="number"
            value={settings.localBackupRetentionCount}
          />
        </SettingsControlRow>
        <SettingsControlRow
          description={settings.lastLocalBackupAt ? `Last backup ${settings.lastLocalBackupAt}` : "No backups yet"}
          label="Manual backup"
        >
          <Button onClick={() => beginRecoveryAction("backupNow")} variant="secondary">
            <Archive aria-hidden="true" size={14} />
            Back up now
          </Button>
        </SettingsControlRow>
      </SettingsGroup>

      <SettingsGroup title="History">
        <SettingsControlRow icon={History} label="Visible entries">
          <input
            aria-label="Visible history entries"
            className="w-56 accent-[var(--color-accent)]"
            max={500}
            min={10}
            onChange={(event) => updateSettings({ visibleHistoryEntryCount: Number(event.target.value) })}
            step={10}
            type="range"
            value={settings.visibleHistoryEntryCount}
          />
        </SettingsControlRow>
        <SettingsControlRow label="Storage cap">
          <input
            aria-label="History storage cap"
            className="w-56 accent-[var(--color-accent)]"
            max={50_000}
            min={100}
            onChange={(event) => updateSettings({ historyStorageCap: Number(event.target.value) })}
            step={100}
            type="range"
            value={settings.historyStorageCap}
          />
        </SettingsControlRow>
      </SettingsGroup>

      <SettingsGroup title="History categories">
        {(Object.keys(defaultHistoryCategoryVisibility) as Array<keyof SettingsSnapshot["historyCategoryVisibility"]>).map((category) => (
          <SettingsSwitch
            checked={settings.historyCategoryVisibility[category] ?? defaultHistoryCategoryVisibility[category]}
            key={category}
            label={historyCategoryLabels[category]}
            onChange={(checked) =>
              updateSettings({
                historyCategoryVisibility: {
                  ...settings.historyCategoryVisibility,
                  [category]: checked
                }
              })
            }
          />
        ))}
      </SettingsGroup>

      <SettingsGroup title="Duplicate detection">
        <SettingsControlRow
          description={`${settings.dismissedDuplicateGroupIds.length} duplicate group dismissal${settings.dismissedDuplicateGroupIds.length === 1 ? "" : "s"} saved.`}
          icon={Layers3}
          label="Dismissed duplicate groups"
        >
          <Button onClick={() => beginRecoveryAction("resetDuplicateDismissals")} variant="secondary">
            <RotateCcw aria-hidden="true" size={14} />
            Reset dismissals
          </Button>
        </SettingsControlRow>
      </SettingsGroup>

      <SettingsGroup title="Custom filters">
        <SettingsControlRow
          description="Save reusable local search queries for tasks, calendar, notes, and tags."
          icon={Filter}
          label="Saved filters"
        >
          <Button onClick={addSavedFilter} variant="secondary">
            <FilePlus2 aria-hidden="true" size={14} />
            New Filter
          </Button>
        </SettingsControlRow>
        {settings.savedSearchViews.length === 0 ? (
          <EmptyState description="No custom filters yet." title="No filters" />
        ) : settings.savedSearchViews.map((filter) => (
          <SettingsControlRow key={filter.id} label={filter.name} description={filter.query}>
            <Button
              onClick={() =>
                updateSettings({
                  savedSearchViews: settings.savedSearchViews.filter((candidate) => candidate.id !== filter.id)
                })
              }
              variant="ghost"
            >
              Remove
            </Button>
          </SettingsControlRow>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Task templates">
        <SettingsControlRow
          description="Define reusable title, notes, due date, and list fields."
          icon={FilePlus2}
          label="Task blueprint"
        >
          <Button onClick={addTaskTemplate} variant="secondary">
            New Task Template
          </Button>
        </SettingsControlRow>
        {settings.taskTemplates.map((template) => (
          <SettingsControlRow key={template.id} label={template.name} description={template.title} />
        ))}
      </SettingsGroup>

      <SettingsGroup title="Event templates">
        <SettingsControlRow
          description="Define reusable event title, time, location, attendees, and recurrence fields."
          icon={FilePlus2}
          label="Event blueprint"
        >
          <Button onClick={addEventTemplate} variant="secondary">
            New Event Template
          </Button>
        </SettingsControlRow>
        {settings.eventTemplates.map((template) => (
          <SettingsControlRow key={template.id} label={template.name} description={template.title} />
        ))}
      </SettingsGroup>

      <SettingsGroup title="Note templates">
        <SettingsControlRow
          description="Define reusable note title and body fields."
          icon={FilePlus2}
          label="Note blueprint"
        >
          <Button onClick={addNoteTemplate} variant="secondary">
            New Note Template
          </Button>
        </SettingsControlRow>
        {noteTemplates.length === 0 ? (
          <EmptyState description="No custom note templates yet." title="No note templates" />
        ) : noteTemplates.map((template) => (
          <div className="grid gap-2 border-b border-border px-3 py-3 last:border-b-0" key={template.id}>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]">
              <Input
                aria-label={`Note template name ${template.name}`}
                onChange={(event) => updateNoteTemplate(template.id, { name: event.currentTarget.value || "Note Template" })}
                value={template.name}
              />
              <Input
                aria-label={`Note template title ${template.name}`}
                onChange={(event) => updateNoteTemplate(template.id, { title: event.currentTarget.value || "Untitled note" })}
                value={template.title}
              />
              <Button
                onClick={() =>
                  updateSettings({
                    noteTemplates: noteTemplates.filter((candidate) => candidate.id !== template.id)
                  })
                }
                variant="ghost"
              >
                Remove
              </Button>
            </div>
            <textarea
              aria-label={`Note template body ${template.name}`}
              className="min-h-24 rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onChange={(event) => updateNoteTemplate(template.id, { body: event.currentTarget.value })}
              value={template.body}
            />
          </div>
        ))}
      </SettingsGroup>
    </div>
  );
}
