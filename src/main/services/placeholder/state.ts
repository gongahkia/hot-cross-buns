import type {
  CalendarEventSummary,
  McpStatusResponse,
  NoteDetail,
  ScheduledTaskBlockSummary,
  SettingsSnapshot,
  SyncStatusResponse,
  TaskDetail
} from "@shared/ipc/contracts";
import {
  defaultHistoryCategoryVisibility,
  defaultKeybindings,
  defaultLeaderKey,
  defaultLeaderKeybindings
} from "@shared/settingsCatalog";
import { defaultSemanticSearchModels } from "@shared/ipc/contracts";

export type TaskRecord = TaskDetail & {
  listTitle: string;
};

export type CalendarRecord = CalendarEventSummary & {
  calendarTitle: string;
  location?: string;
  notes?: string;
  guestEmails?: string[];
  reminderMinutes?: number[];
};

export interface PlaceholderState {
  tasks: TaskRecord[];
  taskLists: Array<{ id: string; title: string }>;
  calendarEvents: CalendarRecord[];
  calendars: Array<{ id: string; title: string; selected: boolean }>;
  scheduledTaskBlocks: ScheduledTaskBlockSummary[];
  notes: NoteDetail[];
  settings: SettingsSnapshot;
  sync: SyncStatusResponse;
  mcp: McpStatusResponse;
}

export const nowIso = "2026-05-22T02:00:00.000Z";

export function createPlaceholderState(): PlaceholderState {
  return {
    taskLists: [
      { id: "list-inbox", title: "Inbox" },
      { id: "list-planning", title: "Planning" }
    ],
    tasks: [
      {
        id: "task-inbox-rules",
        listId: "list-inbox",
        listTitle: "Inbox",
        title: "Draft inbox triage rules",
        status: "active",
        dueAt: "2026-05-22T00:00:00.000Z",
        updatedAt: nowIso,
        notes: "Define keyboard-first review states before sync writes exist.",
        parentId: null,
        priority: "high"
      },
      {
        id: "task-calendar-fixtures",
        listId: "list-inbox",
        listTitle: "Inbox",
        title: "Review calendar fixture shape",
        status: "active",
        dueAt: "2026-05-22T00:00:00.000Z",
        updatedAt: nowIso,
        notes: "Keep visible rows stable for future agenda virtualization.",
        parentId: null,
        priority: "medium"
      },
      {
        id: "task-shell-visible",
        listId: "list-planning",
        listTitle: "Planning",
        title: "Report shell-visible timing",
        status: "completed",
        dueAt: null,
        updatedAt: "2026-05-21T08:00:00.000Z",
        notes: "Mock-only diagnostics call is already available through preload.",
        parentId: null,
        priority: "low"
      },
      ...Array.from({ length: 140 }, (_, index): TaskRecord => ({
        id: `task-window-${index + 1}`,
        listId: index % 2 === 0 ? "list-inbox" : "list-planning",
        listTitle: index % 2 === 0 ? "Inbox" : "Planning",
        title: `Generated cache task ${String(index + 1).padStart(3, "0")}`,
        status: "active",
        dueAt: index % 3 === 0 ? "2026-05-23T00:00:00.000Z" : null,
        updatedAt: nowIso,
        notes: "Placeholder row for paginated preload calls.",
        parentId: null,
        priority: "none"
      }))
    ],
    calendars: [
      { id: "cal-product", title: "Product", selected: true },
      { id: "cal-engineering", title: "Engineering", selected: true },
      { id: "cal-qa", title: "QA", selected: true }
    ],
    calendarEvents: [
      {
        id: "event-standup",
        calendarId: "cal-product",
        calendarTitle: "Product",
        title: "Planner shell standup",
        startsAt: "2026-05-22T01:30:00.000Z",
        endsAt: "2026-05-22T01:50:00.000Z",
        allDay: false,
        updatedAt: nowIso,
        location: "Local cache",
        notes: "Review Today and Tasks shape."
      },
      {
        id: "event-focus",
        calendarId: "cal-engineering",
        calendarTitle: "Engineering",
        title: "Focused implementation block",
        startsAt: "2026-05-22T03:00:00.000Z",
        endsAt: "2026-05-22T05:00:00.000Z",
        allDay: false,
        updatedAt: nowIso,
        location: "Desk",
        notes: "Renderer-only feature work."
      },
      ...Array.from({ length: 90 }, (_, index): CalendarRecord => {
        const hour = 8 + (index % 10);
        const day = 22 + Math.floor(index / 10);

        return {
          id: `event-window-${index + 1}`,
          calendarId: index % 2 === 0 ? "cal-product" : "cal-engineering",
          calendarTitle: index % 2 === 0 ? "Product" : "Engineering",
          title: `Generated cache event ${String(index + 1).padStart(3, "0")}`,
          startsAt: `2026-05-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:15:00.000Z`,
          endsAt: `2026-05-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:45:00.000Z`,
          allDay: false,
          updatedAt: nowIso,
          location: "Local cache",
          notes: "Placeholder event for range-windowed preload calls."
        };
      })
    ],
    scheduledTaskBlocks: [],
    notes: [
      {
        id: "note-cache-first",
        listId: "list-inbox",
        listTitle: "Inbox",
        title: "Cache-first startup",
        preview: "Renderer should paint a useful shell before Google, SQLite, or MCP work is wired.",
        updatedAt: nowIso,
        body: "Renderer should paint a useful shell before Google, SQLite, or MCP work is wired."
      },
      {
        id: "note-command-surface",
        listId: "list-inbox",
        listTitle: "Inbox",
        title: "Command palette surface",
        preview: "Commands stay in memory and execute future services as visible controls.",
        updatedAt: "2026-05-22T01:39:00.000Z",
        body: "Commands stay in memory and execute future services as visible controls."
      },
      ...Array.from({ length: 60 }, (_, index): NoteDetail => ({
        id: `note-window-${index + 1}`,
        listId: "list-inbox",
        listTitle: "Inbox",
        title: `Generated note ${String(index + 1).padStart(2, "0")}`,
        preview: "Placeholder note for paginated preload calls.",
        updatedAt: nowIso,
        body: "Placeholder note body for task-backed note data."
      }))
    ],
    settings: {
      theme: "system",
      colorTheme: "notion",
      appLanguage: "system",
      uiFontName: null,
      uiTextSizePoints: 13,
      perSurfaceFontOverrides: {},
      calendarEventColorOverrides: {},
      autoTagRules: [],
      autoTagBackgroundReapplyMode: "preview",
      disableAnimations: false,
      uiLayoutScale: 1,
      navigationPlacement: "left",
      hiddenNavigationTabs: [],
      navigationTabOrder: ["calendar", "tasks", "notes"],
      toolbarActionOrder: ["commandPalette", "notifications", "diagnostics", "splitPane", "refresh", "settings"],
      hiddenCalendarViewModes: [],
      showCompletedInCalendarViews: true,
      eventCompletionDefaultScope: "occurrence",
      calendarTimelineDensity: "compact",
      monthScrollPastMonths: 0,
      monthScrollFutureMonths: 1,
      quickCreateExpandedByDefault: false,
      restoreWindowStateEnabled: true,
      startOnLogin: false,
      keybindings: defaultKeybindings,
      leaderKey: defaultLeaderKey,
      leaderKeybindings: defaultLeaderKeybindings,
      selectedTaskListIds: ["list-inbox", "list-planning"],
      selectedCalendarIds: ["cal-product", "cal-engineering", "cal-qa"],
      setupCompletedAt: nowIso,
      syncMode: "balanced",
      syncTasksEnabled: true,
      syncCalendarEventsEnabled: true,
      eventRetentionDaysBack: 0,
      completedTaskRetentionDaysBack: 365,
      showTrayIcon: true,
      trayClickAction: "open-menu",
      menuBarPanelStyle: "adaptive",
      menuBarIconName: "calendar",
      menuBarCalendarIconId: "calendar",
      menuBarCalendarDoneMode: "visibleTodayDone",
      customMenuBarIcons: [],
      showMenuBarBadge: true,
      showDockBadge: true,
      notificationsEnabled: false,
      notificationLeadMinutes: 10,
      taskCompletionSoundEnabled: true,
      taskCompletionSoundId: "glass",
      eventCompletionSoundEnabled: true,
      eventCompletionSoundId: "pop",
      importedSoundCount: 0,
      perTabListFilters: {
        tasks: {
          useCustomFilter: false,
          selectedTaskListIds: []
        },
        notes: {
          useCustomFilter: false,
          selectedTaskListIds: []
        }
      },
      portableExportOnlySelectedTaskLists: false,
      portableExportOnlySelectedCalendars: false,
      portableExportOnlyFutureCurrentEvents: false,
      dailyLocalBackupEnabled: false,
      localBackupRetentionCount: 14,
      lastLocalBackupAt: null,
      visibleHistoryEntryCount: 50,
      historyStorageCap: 5_000,
      historyCategoryVisibility: defaultHistoryCategoryVisibility,
      dismissedDuplicateGroupIds: [],
      taskTemplates: [],
      eventTemplates: [],
      noteTemplates: [],
      lastUpdateCheckAt: null,
      mcpEnabled: false,
      mcpPermissionMode: "confirm-writes",
      mcpPort: 0,
      defaultTimeZone: "UTC",
      todayCapacityMinutes: 480,
      todayWorkingHoursStart: 6,
      todayWorkingHoursEnd: 22,
      diagnosticsIncludePerformance: true,
      rawGoogleDiagnosticsEnabled: false,
      savedSearchViews: [],
      pinnedSavedSearchViewIds: [],
      savedTaskViews: [],
      semanticSearchEnabled: false,
      semanticSearchMode: "lexical",
      embeddingModelId: "hcb-local-hash-384",
      semanticSearchModels: defaultSemanticSearchModels,
      agentActionTrayEnabled: true,
      webhooksEnabled: false
    },
    sync: {
      state: "idle",
      pendingMutationCount: 0
    },
    mcp: {
      enabled: false,
      running: false,
      readOnly: false,
      confirmationRequired: true,
      permissionMode: "confirm-writes",
      port: 0,
      tokenState: "not_configured",
      url: "http://127.0.0.1"
    }
  };
}
