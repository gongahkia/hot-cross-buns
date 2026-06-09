import {
  defaultHistoryCategoryVisibility,
  googleCalendarEventColors
} from "@shared/ipc/contracts";
import {
  previewAutoTagRules,
  validateAutoTagRule
} from "@shared/ipc/autoTags";
import type { AutoTagTargetKind } from "@shared/ipc/autoTags";
import type {
  AutoTagRule,
  CalendarListSummary,
  PortableImportPreview,
  SettingsRecoveryActionRequest,
  SettingsSnapshot,
  SettingsUpdateRequest,
  TagCreateRequest,
  TagDeleteRequest,
  TagMergeRequest,
  TagMutationResponse,
  TagSummary,
  TagUpdateRequest,
  TaskListSummary
} from "@shared/ipc/contracts";
import {
  ArrowDown,
  ArrowUp,
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
  Pin,
  RotateCcw,
  Save,
  Tag,
  Trash2,
  Upload
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Input } from "../../../../components/primitives";
import { EmptyState } from "../../../../components/states";
import { parseTagText } from "../../TagInput";
import {
  SettingsControlRow,
  SettingsGroup,
  SettingsSwitch,
  settingsSelectClass
} from "./SettingsPrimitives";

interface AdvancedSettingsTabProps {
  autoTagBulkCounts: Record<AutoTagTargetKind, number>;
  beginRecoveryAction: (action: SettingsRecoveryActionRequest["action"]) => void;
  calendarSources: CalendarListSummary[];
  settings: SettingsSnapshot;
  tags: TagSummary[];
  taskLists: TaskListSummary[];
  createTag: (request: TagCreateRequest) => Promise<TagMutationResponse | null>;
  updateTag: (request: TagUpdateRequest) => Promise<TagMutationResponse | null>;
  deleteTag: (request: TagDeleteRequest) => Promise<TagMutationResponse | null>;
  mergeTags: (request: TagMergeRequest) => Promise<TagMutationResponse | null>;
  onReapplyAutoTags: (kind: AutoTagTargetKind) => void;
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

const autoTagTargetKinds: AutoTagTargetKind[] = ["task", "event", "note"];
type AutoTagPreviewLocalKind = "normal" | "birthday";

function autoTagRuleHasError(rule: AutoTagRule): boolean {
  return validateAutoTagRule(rule).some((issue) => issue.severity === "error");
}

function autoDisableInvalidAutoTagRules(rules: AutoTagRule[], now: string): AutoTagRule[] {
  let changed = false;
  const nextRules = rules.map((rule) => {
    if (!rule.enabled || !autoTagRuleHasError(rule)) {
      return rule;
    }

    changed = true;
    return { ...rule, enabled: false, updatedAt: now };
  });

  return changed ? nextRules : rules;
}

export function AdvancedSettingsTab({
  autoTagBulkCounts,
  beginRecoveryAction,
  calendarSources,
  createTag,
  deleteTag,
  mergeTags,
  onReapplyAutoTags,
  settings,
  tags,
  taskLists,
  updateTag,
  updateSelectedCalendar,
  updateSelectedTaskList,
  updateSettings
}: AdvancedSettingsTabProps): JSX.Element {
  const selectedTaskLists = new Set(settings.selectedTaskListIds);
  const selectedCalendars = new Set(settings.selectedCalendarIds);
  const noteTemplates = settings.noteTemplates ?? [];
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#7C3AED");
  const [tagDrafts, setTagDrafts] = useState<Record<string, { color: string; name: string }>>({});
  const [tagMergeSourceId, setTagMergeSourceId] = useState("");
  const [tagMergeTargetId, setTagMergeTargetId] = useState("");
  const [autoTagPreviewKind, setAutoTagPreviewKind] = useState<AutoTagTargetKind>("task");
  const [autoTagPreviewTitle, setAutoTagPreviewTitle] = useState("CODING: Ship planner polish");
  const [autoTagPreviewBody, setAutoTagPreviewBody] = useState("");
  const [autoTagPreviewExistingTags, setAutoTagPreviewExistingTags] = useState("");
  const [autoTagPreviewExplicitTags, setAutoTagPreviewExplicitTags] = useState("");
  const [autoTagPreviewExistingColorId, setAutoTagPreviewExistingColorId] = useState("");
  const [autoTagPreviewRequestedColorId, setAutoTagPreviewRequestedColorId] = useState("");
  const [autoTagPreviewLocalKind, setAutoTagPreviewLocalKind] = useState<AutoTagPreviewLocalKind>("normal");
  const [portableArchivePath, setPortableArchivePath] = useState("");
  const [portableImportPreview, setPortableImportPreview] = useState<PortableImportPreview | null>(null);
  const [portableStatus, setPortableStatus] = useState<string | null>(null);
  const autoTagAutoDisableRequestRef = useRef<string | null>(null);
  const autoTagPreviewExistingTagValues = useMemo(
    () => parseTagText(autoTagPreviewExistingTags),
    [autoTagPreviewExistingTags]
  );
  const autoTagPreviewExplicitTagValues = useMemo(
    () => parseTagText(autoTagPreviewExplicitTags),
    [autoTagPreviewExplicitTags]
  );
  const autoTagPreview = useMemo(
    () =>
      previewAutoTagRules(settings.autoTagRules, {
        kind: autoTagPreviewKind,
        title: autoTagPreviewTitle,
        body: autoTagPreviewBody,
        explicitTags: autoTagPreviewExplicitTagValues,
        existingTags: autoTagPreviewExistingTagValues,
        existingEventColorId: autoTagPreviewExistingColorId || null,
        requestedEventColorId: autoTagPreviewRequestedColorId || null,
        hcbKind: autoTagPreviewLocalKind === "birthday" ? "birthday" : null
      }),
    [
      autoTagPreviewBody,
      autoTagPreviewExistingColorId,
      autoTagPreviewExistingTagValues,
      autoTagPreviewExplicitTagValues,
      autoTagPreviewKind,
      autoTagPreviewLocalKind,
      autoTagPreviewRequestedColorId,
      autoTagPreviewTitle,
      settings.autoTagRules
    ]
  );
  const autoTagRuleIssues = useMemo(
    () => settings.autoTagRules.flatMap((rule) => validateAutoTagRule(rule)),
    [settings.autoTagRules]
  );
  const autoTagErrors = autoTagRuleIssues.filter((issue) => issue.severity === "error");
  const autoTagWarnings = autoTagRuleIssues.filter((issue) => issue.severity === "warning");

  useEffect(() => {
    const invalidEnabledRuleKey = settings.autoTagRules
      .filter((rule) => rule.enabled && autoTagRuleHasError(rule))
      .map((rule) => rule.id)
      .join(",");

    if (!invalidEnabledRuleKey) {
      autoTagAutoDisableRequestRef.current = null;
      return;
    }

    if (autoTagAutoDisableRequestRef.current === invalidEnabledRuleKey) {
      return;
    }

    autoTagAutoDisableRequestRef.current = invalidEnabledRuleKey;
    const nextRules = autoDisableInvalidAutoTagRules(settings.autoTagRules, new Date().toISOString());

    if (nextRules !== settings.autoTagRules) {
      updateSettings({ autoTagRules: nextRules });
    }
  }, [settings.autoTagRules, updateSettings]);

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

  function updateSavedFilter(
    filterId: string,
    patch: Partial<SettingsSnapshot["savedSearchViews"][number]>
  ): void {
    const now = new Date().toISOString();
    updateSettings({
      savedSearchViews: settings.savedSearchViews.map((filter) =>
        filter.id === filterId ? { ...filter, ...patch, updatedAt: now } : filter
      )
    });
  }

  function removeSavedFilter(filterId: string): void {
    updateSettings({
      savedSearchViews: settings.savedSearchViews.filter((candidate) => candidate.id !== filterId),
      pinnedSavedSearchViewIds: settings.pinnedSavedSearchViewIds.filter((candidate) => candidate !== filterId)
    });
  }

  function togglePinnedSavedFilter(filterId: string): void {
    const pinned = new Set(settings.pinnedSavedSearchViewIds);

    if (pinned.has(filterId)) {
      pinned.delete(filterId);
    } else {
      pinned.add(filterId);
    }

    updateSettings({ pinnedSavedSearchViewIds: [...pinned].slice(0, 20) });
  }

  async function addTag(): Promise<void> {
    const name = newTagName.trim();

    if (!name) {
      return;
    }

    const result = await createTag({ name, color: newTagColor || null });

    if (result) {
      setNewTagName("");
    }
  }

  function tagDraft(tag: TagSummary): { color: string; name: string } {
    return tagDrafts[tag.id] ?? { color: tag.color ?? "#7C3AED", name: tag.name };
  }

  function setTagDraft(tag: TagSummary, patch: Partial<{ color: string; name: string }>): void {
    const current = tagDraft(tag);
    setTagDrafts({
      ...tagDrafts,
      [tag.id]: { ...current, ...patch }
    });
  }

  async function saveTag(tag: TagSummary): Promise<void> {
    const draft = tagDraft(tag);
    const name = draft.name.trim();
    const color = draft.color || null;

    if (!name) {
      return;
    }

    if (name === tag.name && color === tag.color) {
      return;
    }

    const result = await updateTag({
      id: tag.id,
      ...(name === tag.name ? {} : { name }),
      ...(color === tag.color ? {} : { color })
    });

    if (result) {
      const { [tag.id]: _removed, ...rest } = tagDrafts;
      setTagDrafts(rest);
    }
  }

  async function removeTag(tag: TagSummary): Promise<void> {
    if (!window.confirm(`Delete tag "${tag.name}"? Existing entity tag values are removed locally.`)) {
      return;
    }

    await deleteTag({ id: tag.id });
  }

  async function mergeSelectedTags(): Promise<void> {
    if (!tagMergeSourceId || !tagMergeTargetId || tagMergeSourceId === tagMergeTargetId) {
      return;
    }

    const result = await mergeTags({ sourceId: tagMergeSourceId, targetId: tagMergeTargetId });

    if (result) {
      setTagMergeSourceId("");
      setTagMergeTargetId("");
    }
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

  function saveAutoTagRules(autoTagRules: AutoTagRule[]): void {
    updateSettings({
      autoTagRules: autoDisableInvalidAutoTagRules(autoTagRules, new Date().toISOString())
    });
  }

  function addAutoTagRule(): void {
    const now = new Date().toISOString();
    saveAutoTagRules([
      ...settings.autoTagRules,
      {
        id: crypto.randomUUID(),
        name: `Auto tag ${settings.autoTagRules.length + 1}`,
        enabled: true,
        targetKinds: ["task", "event", "note"],
        matchField: "title",
        matchType: "prefix",
        pattern: "TODO",
        tags: ["todo"],
        stripMatchedPrefix: false,
        eventColorId: null,
        overrideExistingEventColor: false,
        createdAt: now,
        updatedAt: now
      }
    ]);
  }

  function moveAutoTagRule(fromIndex: number, toIndex: number): void {
    if (toIndex < 0 || toIndex >= settings.autoTagRules.length || fromIndex === toIndex) {
      return;
    }

    const nextRules = [...settings.autoTagRules];
    const [rule] = nextRules.splice(fromIndex, 1);

    if (!rule) {
      return;
    }

    nextRules.splice(toIndex, 0, rule);
    saveAutoTagRules(nextRules);
  }

  function updateAutoTagRule(ruleId: string, patch: Partial<AutoTagRule>): void {
    const now = new Date().toISOString();
    saveAutoTagRules(
      settings.autoTagRules.map((rule) =>
        rule.id === ruleId ? { ...rule, ...patch, updatedAt: now } : rule
      )
    );
  }

  function toggleAutoTagTarget(rule: AutoTagRule, kind: AutoTagTargetKind, checked: boolean): void {
    const targetKinds = checked
      ? [...new Set([...rule.targetKinds, kind])]
      : rule.targetKinds.filter((candidate) => candidate !== kind);

    updateAutoTagRule(rule.id, { targetKinds: targetKinds.length > 0 ? targetKinds : [kind] });
  }

  async function exportPortableArchive(): Promise<void> {
    setPortableStatus("Exporting portable archive.");
    const result = await window.hcb?.settings.exportPortableArchive();

    if (!result?.ok) {
      setPortableStatus(result?.error.message ?? "Portable export failed.");
      return;
    }

    setPortableArchivePath(result.data.path);
    setPortableStatus(`Exported ${result.data.path}`);
  }

  async function previewPortableArchive(): Promise<void> {
    if (!portableArchivePath.trim()) {
      setPortableStatus("Enter a .hcbexport path.");
      return;
    }

    const result = await window.hcb?.settings.previewPortableImport({ path: portableArchivePath.trim() });

    if (!result?.ok) {
      setPortableImportPreview(null);
      setPortableStatus(result?.error.message ?? "Portable import preview failed.");
      return;
    }

    setPortableImportPreview(result.data);
    setPortableStatus("Import preview ready.");
  }

  async function importPortableArchive(): Promise<void> {
    if (!portableImportPreview) {
      await previewPortableArchive();
      return;
    }

    const result = await window.hcb?.settings.importPortableArchive({
      path: portableImportPreview.path,
      confirm: true
    });

    if (!result?.ok) {
      setPortableStatus(result?.error.message ?? "Portable import failed.");
      return;
    }

    setPortableStatus(`Imported archive. Backup: ${result.data.backupPath}`);
    setPortableImportPreview(result.data.preview);
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
          <Button onClick={() => void exportPortableArchive()} variant="secondary">
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
        <SettingsControlRow
          description={portableStatus ?? undefined}
          label="Import portable archive"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Input
              aria-label="Portable archive path"
              className="min-w-64"
              onChange={(event) => {
                setPortableArchivePath(event.currentTarget.value);
                setPortableImportPreview(null);
              }}
              placeholder="/path/to/archive.hcbexport"
              value={portableArchivePath}
            />
            <Button onClick={() => void previewPortableArchive()} variant="secondary">
              <Upload aria-hidden="true" size={14} />
              Preview import
            </Button>
            <Button
              disabled={!portableImportPreview}
              onClick={() => void importPortableArchive()}
              variant="danger"
            >
              <Upload aria-hidden="true" size={14} />
              Import
            </Button>
          </div>
        </SettingsControlRow>
        {portableImportPreview ? (
          <SettingsControlRow label="Import preview">
            <div className="flex flex-wrap gap-2 text-[var(--text-sm)] text-text-secondary">
              <Badge>Tasks {portableImportPreview.tasks.added}/{portableImportPreview.tasks.changed}/{portableImportPreview.tasks.removed}</Badge>
              <Badge>Events {portableImportPreview.events.added}/{portableImportPreview.events.changed}/{portableImportPreview.events.removed}</Badge>
              <Badge>Calendars {portableImportPreview.calendars.added}/{portableImportPreview.calendars.changed}/{portableImportPreview.calendars.removed}</Badge>
              <Badge>Task lists {portableImportPreview.taskLists.added}/{portableImportPreview.taskLists.changed}/{portableImportPreview.taskLists.removed}</Badge>
              <Badge>Queued {portableImportPreview.queuedMutationCount}</Badge>
              <Badge>Attachments {portableImportPreview.attachments.bundled}</Badge>
            </div>
          </SettingsControlRow>
        ) : null}
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
          <div className="grid gap-2 border-b border-border px-3 py-3 last:border-b-0" key={filter.id}>
            <div className="grid gap-2 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto_auto]">
              <Input
                aria-label={`Saved filter name ${filter.name}`}
                onChange={(event) => updateSavedFilter(filter.id, { name: event.currentTarget.value })}
                value={filter.name}
              />
              <Input
                aria-label={`Saved filter query ${filter.name}`}
                onChange={(event) => updateSavedFilter(filter.id, { query: event.currentTarget.value })}
                value={filter.query}
              />
              <Button
                onClick={() => togglePinnedSavedFilter(filter.id)}
                size="sm"
                variant={settings.pinnedSavedSearchViewIds.includes(filter.id) ? "primary" : "secondary"}
              >
                <Pin aria-hidden="true" size={14} />
                {settings.pinnedSavedSearchViewIds.includes(filter.id) ? "Pinned" : "Pin"}
              </Button>
              <Button onClick={() => removeSavedFilter(filter.id)} size="sm" variant="ghost">
                <Trash2 aria-hidden="true" size={14} />
                Remove
              </Button>
            </div>
          </div>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Tags">
        <SettingsControlRow
          description={`${tags.length} tag${tags.length === 1 ? "" : "s"} in the local catalog.`}
          icon={Tag}
          label="Tag catalog"
        >
          <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_3rem_auto]">
            <Input
              aria-label="New tag name"
              onChange={(event) => setNewTagName(event.currentTarget.value)}
              placeholder="tag"
              value={newTagName}
            />
            <input
              aria-label="New tag color"
              className="h-8 w-12 rounded-hcbMd border border-border bg-surface-0 p-1"
              onChange={(event) => setNewTagColor(event.currentTarget.value)}
              type="color"
              value={newTagColor}
            />
            <Button disabled={!newTagName.trim()} onClick={() => void addTag()} variant="secondary">
              <FilePlus2 aria-hidden="true" size={14} />
              Add
            </Button>
          </div>
        </SettingsControlRow>
        {tags.length > 1 ? (
          <SettingsControlRow description="Moves entity links from the source tag into the target tag." label="Merge tags">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <select
                aria-label="Merge source tag"
                className={settingsSelectClass}
                onChange={(event) => setTagMergeSourceId(event.target.value)}
                value={tagMergeSourceId}
              >
                <option value="">Source</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>{tag.name}</option>
                ))}
              </select>
              <select
                aria-label="Merge target tag"
                className={settingsSelectClass}
                onChange={(event) => setTagMergeTargetId(event.target.value)}
                value={tagMergeTargetId}
              >
                <option value="">Target</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>{tag.name}</option>
                ))}
              </select>
              <Button
                disabled={!tagMergeSourceId || !tagMergeTargetId || tagMergeSourceId === tagMergeTargetId}
                onClick={() => void mergeSelectedTags()}
                variant="secondary"
              >
                Merge
              </Button>
            </div>
          </SettingsControlRow>
        ) : null}
        {tags.length === 0 ? (
          <EmptyState description="No tags have been created or backfilled yet." title="No tags" />
        ) : tags.map((tag) => {
          const draft = tagDraft(tag);
          const unchanged = draft.name.trim() === tag.name && (draft.color || null) === tag.color;

          return (
            <div className="grid gap-2 border-b border-border px-3 py-3 last:border-b-0" key={tag.id}>
              <div className="grid gap-2 lg:grid-cols-[minmax(0,12rem)_3rem_auto_auto]">
                <Input
                  aria-label={`Tag name ${tag.name}`}
                  onChange={(event) => setTagDraft(tag, { name: event.currentTarget.value })}
                  value={draft.name}
                />
                <input
                  aria-label={`Tag color ${tag.name}`}
                  className="h-8 w-12 rounded-hcbMd border border-border bg-surface-0 p-1"
                  onChange={(event) => setTagDraft(tag, { color: event.currentTarget.value })}
                  type="color"
                  value={draft.color}
                />
                <Button
                  disabled={unchanged || !draft.name.trim()}
                  onClick={() => void saveTag(tag)}
                  size="sm"
                  variant="secondary"
                >
                  <Save aria-hidden="true" size={14} />
                  Save
                </Button>
                <Button onClick={() => void removeTag(tag)} size="sm" variant="ghost">
                  <Trash2 aria-hidden="true" size={14} />
                  Delete
                </Button>
              </div>
              <div className="flex flex-wrap gap-1 text-[var(--text-xs)] text-text-muted">
                <Badge>tasks {tag.taskCount}</Badge>
                <Badge>events {tag.eventCount}</Badge>
                <Badge>notes {tag.noteCount}</Badge>
                <Badge tone="accent">total {tag.totalCount}</Badge>
              </div>
            </div>
          );
        })}
      </SettingsGroup>

      <SettingsGroup title="Auto tags">
        <SettingsControlRow
          description="Apply local HCB tags and optional event colors when titles or bodies match."
          icon={Tag}
          label="Rules"
        >
          <Button onClick={addAutoTagRule} variant="secondary">
            <FilePlus2 aria-hidden="true" size={14} />
            New Rule
          </Button>
        </SettingsControlRow>
        <SettingsControlRow
          description="Reapply enabled rules to currently loaded planner data."
          icon={RotateCcw}
          label="Bulk reapply"
        >
          <div className="flex flex-wrap gap-2">
            {autoTagTargetKinds.map((kind) => (
              <Button
                disabled={autoTagBulkCounts[kind] === 0 || autoTagErrors.length > 0}
                key={kind}
                onClick={() => onReapplyAutoTags(kind)}
                size="sm"
                variant="secondary"
              >
                {kind} <Badge>{autoTagBulkCounts[kind]}</Badge>
              </Button>
            ))}
          </div>
        </SettingsControlRow>
        {autoTagErrors.length > 0 || autoTagWarnings.length > 0 ? (
          <div className="grid gap-1 border-b border-border px-3 py-2 text-[var(--text-sm)]">
            {autoTagErrors.length > 0 ? (
              <p className="font-medium text-danger" role="alert">
                {autoTagErrors.length} auto-tag rule {autoTagErrors.length === 1 ? "error" : "errors"} need review.
              </p>
            ) : null}
            {autoTagWarnings.length > 0 ? (
              <p className="text-warning">
                {autoTagWarnings.length} auto-tag rule {autoTagWarnings.length === 1 ? "warning" : "warnings"}.
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-3 border-b border-border px-3 py-3">
          <div>
            <div className="text-[var(--text-base)] font-medium text-text-primary">Rule preview</div>
            <p className="mt-0.5 text-[var(--text-sm)] text-text-muted">
              Test title/body text against enabled rules in order before saving new CRUD items.
            </p>
          </div>
          <div className="grid gap-2 lg:grid-cols-[10rem_minmax(0,1fr)]">
            <select
              aria-label="Auto tag preview target"
              className={settingsSelectClass}
              onChange={(event) => setAutoTagPreviewKind(event.target.value as AutoTagTargetKind)}
              value={autoTagPreviewKind}
            >
              {autoTagTargetKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
            <Input
              aria-label="Auto tag preview title"
              onChange={(event) => setAutoTagPreviewTitle(event.currentTarget.value)}
              value={autoTagPreviewTitle}
            />
          </div>
          <textarea
            aria-label="Auto tag preview body"
            className="min-h-16 rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-base)] text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onChange={(event) => setAutoTagPreviewBody(event.currentTarget.value)}
            placeholder="Body preview"
            value={autoTagPreviewBody}
          />
          <div className="grid gap-2 lg:grid-cols-3">
            <Input
              aria-label="Auto tag preview existing tags"
              label="Existing tags"
              onChange={(event) => setAutoTagPreviewExistingTags(event.currentTarget.value)}
              placeholder="ops, coding"
              value={autoTagPreviewExistingTags}
            />
            <Input
              aria-label="Auto tag preview explicit tags"
              label="Explicit tags"
              onChange={(event) => setAutoTagPreviewExplicitTags(event.currentTarget.value)}
              placeholder="manual, launch"
              value={autoTagPreviewExplicitTags}
            />
            <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
              <span>Local kind</span>
              <select
                aria-label="Auto tag preview local kind"
                className={settingsSelectClass}
                onChange={(event) => setAutoTagPreviewLocalKind(event.target.value as AutoTagPreviewLocalKind)}
                value={autoTagPreviewLocalKind}
              >
                <option value="normal">Normal</option>
                <option value="birthday">Birthday</option>
              </select>
            </label>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
              <span>Requested event color</span>
              <select
                aria-label="Auto tag preview requested event color"
                className={settingsSelectClass}
                onChange={(event) => setAutoTagPreviewRequestedColorId(event.target.value)}
                value={autoTagPreviewRequestedColorId}
              >
                <option value="">No requested color</option>
                {googleCalendarEventColors.map((color) => (
                  <option key={color.id} value={color.id}>
                    {color.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[var(--text-sm)] text-text-secondary">
              <span>Existing event color</span>
              <select
                aria-label="Auto tag preview existing event color"
                className={settingsSelectClass}
                onChange={(event) => setAutoTagPreviewExistingColorId(event.target.value)}
                value={autoTagPreviewExistingColorId}
              >
                <option value="">No existing color</option>
                {googleCalendarEventColors.map((color) => (
                  <option key={color.id} value={color.id}>
                    {color.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-2 rounded-hcbMd border border-border bg-surface-0 px-3 py-2 text-[var(--text-sm)] text-text-secondary">
            <div className="flex flex-wrap gap-2">
              <Badge tone={autoTagPreview.matchedRuleCount > 0 ? "success" : "neutral"}>
                {autoTagPreview.matchedRuleCount} matched
              </Badge>
              <Badge tone={autoTagPreview.hasConflicts ? "warning" : "neutral"}>
                {autoTagPreview.hasConflicts ? "multiple rules" : "single pass"}
              </Badge>
              {autoTagPreview.eventColorId ? <Badge tone="info">color {autoTagPreview.eventColorId}</Badge> : null}
            </div>
            <div className="truncate text-text-primary">Title: {autoTagPreview.title || "Untitled"}</div>
            <div>Tags: {autoTagPreview.tags.length > 0 ? autoTagPreview.tags.join(", ") : "none"}</div>
            {autoTagPreview.hasConflicts ? (
              <p className="text-warning" role="status">
                Multiple rules match this preview. Later rules apply after earlier rules.
              </p>
            ) : null}
            <ol className="grid gap-1">
              {autoTagPreviewLocalKind === "birthday" ? (
                <li>Rules skipped for birthday preview.</li>
              ) : autoTagPreview.traces.length === 0 ? (
                <li>No rules configured.</li>
              ) : autoTagPreview.traces.map((trace) => (
                <li className="flex min-w-0 flex-wrap items-center gap-2" key={trace.ruleId}>
                  <Badge>#{trace.order}</Badge>
                  <span className="min-w-0 max-w-48 truncate font-medium text-text-primary">{trace.ruleName}</span>
                  <Badge
                    tone={
                      trace.status === "matched"
                        ? "success"
                        : trace.status === "invalid"
                          ? "danger"
                          : trace.status === "no-output"
                            ? "warning"
                            : "neutral"
                    }
                  >
                    {trace.status.replace("-", " ")}
                  </Badge>
                  {trace.matchedField ? <Badge>{trace.matchedField}</Badge> : null}
                  {trace.tagsAdded.length > 0 ? <span>+{trace.tagsAdded.join(", ")}</span> : null}
                  {trace.strippedField ? <Badge tone="info">strip {trace.strippedField}</Badge> : null}
                  {trace.eventColorStatus === "applied" ? <Badge tone="info">color applied</Badge> : null}
                  {trace.eventColorStatus === "skipped-explicit" ? <Badge tone="warning">color kept</Badge> : null}
                  {trace.eventColorStatus === "skipped-existing" ? <Badge tone="warning">existing color kept</Badge> : null}
                </li>
              ))}
            </ol>
          </div>
        </div>
        {settings.autoTagRules.length === 0 ? (
          <EmptyState description="No auto tag rules yet." title="No auto tags" />
        ) : settings.autoTagRules.map((rule, index) => {
          const ruleIssues = validateAutoTagRule(rule);
          const patternIssue = ruleIssues.find((issue) => issue.field === "pattern");
          const outputIssue = ruleIssues.find((issue) => issue.field === "output");
          const trace = autoTagPreview.traces.find((candidate) => candidate.ruleId === rule.id);

          return (
            <div className="grid gap-2 border-b border-border px-3 py-3 last:border-b-0" key={rule.id}>
              <div className="flex flex-wrap items-center gap-2 text-[var(--text-sm)] text-text-secondary">
                <Badge>Rule #{index + 1}</Badge>
                {trace ? (
                  <Badge
                    tone={
                      trace.status === "matched"
                        ? "success"
                        : trace.status === "invalid"
                          ? "danger"
                          : trace.status === "no-output"
                            ? "warning"
                            : "neutral"
                    }
                  >
                    preview {trace.status.replace("-", " ")}
                  </Badge>
                ) : null}
                {patternIssue ? <Badge tone="danger">invalid regex</Badge> : null}
                {outputIssue ? <Badge tone="warning">no output</Badge> : null}
                <div className="ml-auto flex gap-1">
                  <Button
                    aria-label={`Move auto tag rule ${rule.name} up`}
                    disabled={index === 0}
                    onClick={() => moveAutoTagRule(index, index - 1)}
                    size="sm"
                    variant="ghost"
                  >
                    <ArrowUp aria-hidden="true" size={14} />
                    Up
                  </Button>
                  <Button
                    aria-label={`Move auto tag rule ${rule.name} down`}
                    disabled={index === settings.autoTagRules.length - 1}
                    onClick={() => moveAutoTagRule(index, index + 1)}
                    size="sm"
                    variant="ghost"
                  >
                    <ArrowDown aria-hidden="true" size={14} />
                    Down
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto]">
                <Input
                  aria-label={`Auto tag rule name ${rule.name}`}
                  onChange={(event) => updateAutoTagRule(rule.id, { name: event.currentTarget.value || "Auto tag" })}
                  value={rule.name}
                />
                <div className="grid gap-1">
                  <Input
                    aria-label={`Auto tag pattern ${rule.name}`}
                    onChange={(event) => updateAutoTagRule(rule.id, { pattern: event.currentTarget.value || "TODO" })}
                    value={rule.pattern}
                  />
                  {patternIssue ? (
                    <p className="text-[var(--text-sm)] text-danger" role="alert">
                      {patternIssue.message}
                    </p>
                  ) : null}
                </div>
                <Button
                  onClick={() =>
                    saveAutoTagRules(settings.autoTagRules.filter((candidate) => candidate.id !== rule.id))
                  }
                  variant="ghost"
                >
                  Remove
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <select
                  aria-label={`Auto tag match field ${rule.name}`}
                  className={settingsSelectClass}
                  onChange={(event) =>
                    updateAutoTagRule(rule.id, { matchField: event.target.value as AutoTagRule["matchField"] })
                  }
                  value={rule.matchField}
                >
                  <option value="title">Title</option>
                  <option value="body">Body</option>
                  <option value="anyText">Title or body</option>
                </select>
                <select
                  aria-label={`Auto tag match type ${rule.name}`}
                  className={settingsSelectClass}
                  onChange={(event) =>
                    updateAutoTagRule(rule.id, { matchType: event.target.value as AutoTagRule["matchType"] })
                  }
                  value={rule.matchType}
                >
                  <option value="prefix">Prefix</option>
                  <option value="contains">Contains</option>
                  <option value="regex">Regex</option>
                </select>
                <select
                  aria-label={`Auto tag event color ${rule.name}`}
                  className={settingsSelectClass}
                  onChange={(event) =>
                    updateAutoTagRule(rule.id, {
                      eventColorId: event.target.value === "" ? null : event.target.value as AutoTagRule["eventColorId"]
                    })
                  }
                  value={rule.eventColorId ?? ""}
                >
                  <option value="">No event color</option>
                  {googleCalendarEventColors.map((color) => (
                    <option key={color.id} value={color.id}>
                      {color.label}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                aria-label={`Auto tag output tags ${rule.name}`}
                label="Tags"
                onChange={(event) => updateAutoTagRule(rule.id, { tags: parseTagText(event.currentTarget.value) })}
                value={rule.tags.join(", ")}
              />
              {outputIssue ? (
                <p className="text-[var(--text-sm)] text-warning">
                  {outputIssue.message}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-4 text-[var(--text-sm)] text-text-secondary">
                <label className="inline-flex min-h-8 items-center gap-2">
                  <input
                    aria-label={`Auto tag enabled ${rule.name}`}
                    checked={rule.enabled && !autoTagRuleHasError(rule)}
                    className="accent-[var(--color-accent)]"
                    onChange={(event) => updateAutoTagRule(rule.id, { enabled: event.target.checked })}
                    type="checkbox"
                  />
                  Enabled
                </label>
                <label className="inline-flex min-h-8 items-center gap-2">
                  <input
                    checked={rule.stripMatchedPrefix}
                    className="accent-[var(--color-accent)]"
                    onChange={(event) => updateAutoTagRule(rule.id, { stripMatchedPrefix: event.target.checked })}
                    type="checkbox"
                  />
                  Strip prefix
                </label>
                <label className="inline-flex min-h-8 items-center gap-2">
                  <input
                    checked={rule.overrideExistingEventColor}
                    className="accent-[var(--color-accent)]"
                    onChange={(event) => updateAutoTagRule(rule.id, { overrideExistingEventColor: event.target.checked })}
                    type="checkbox"
                  />
                  Override event color
                </label>
              </div>
              <div className="flex flex-wrap gap-4 text-[var(--text-sm)] text-text-secondary">
                {autoTagTargetKinds.map((kind) => (
                  <label className="inline-flex min-h-8 items-center gap-2" key={kind}>
                    <input
                      checked={rule.targetKinds.includes(kind)}
                      className="accent-[var(--color-accent)]"
                      onChange={(event) => toggleAutoTagTarget(rule, kind, event.target.checked)}
                      type="checkbox"
                    />
                    {kind}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
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
