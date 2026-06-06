import { afterEach, describe, expect, it } from "vitest";
import { defaultKeybindings } from "@shared/settingsCatalog";
import { runLocalDataMigrations } from "../data/migrations";
import {
  LocalPerformanceRepository,
  LocalPlannerRepository,
  LocalSettingsRepository,
  LocalUndoRepository
} from "../data/localRepositories";
import {
  createTemporarySqliteConnection,
  type TemporarySqliteConnection
} from "../data/sqliteConnection";
import { GoogleSyncRepository } from "../sync/readSyncRepository";
import { createSqliteDomainServices } from "./sqliteDomainServices";

const now = "2026-05-22T00:00:00.000Z";

let temp: TemporarySqliteConnection | undefined;

afterEach(() => {
  temp?.cleanup();
  temp = undefined;
});

function createTestServices() {
  temp = createTemporarySqliteConnection("hcb2-domain-services-");
  runLocalDataMigrations(temp.connection);

  const performanceRepository = new LocalPerformanceRepository(temp.connection);
  const plannerRepository = new LocalPlannerRepository(temp.connection, performanceRepository);
  const settingsRepository = new LocalSettingsRepository(temp.connection);
  const undoRepository = new LocalUndoRepository(temp.connection);
  const syncRepository = new GoogleSyncRepository(temp.connection);
  const domain = createSqliteDomainServices({
    plannerRepository,
    settingsRepository,
    undoRepository,
    syncRepository
  });

  return {
    domain,
    plannerRepository,
    settingsRepository,
    undoRepository,
    syncRepository,
    performanceRepository
  };
}

function testConnection() {
  if (!temp) {
    throw new Error("Missing test database.");
  }

  return temp.connection;
}

function seedGoogleMirrors(syncRepository: GoogleSyncRepository): void {
  syncRepository.writeTaskLists(
    "acct-1",
    [
      {
        id: "inbox",
        title: "Inbox",
        updatedAt: now
      }
    ],
    now
  );
  syncRepository.writeTasks(
    "acct-1",
    "inbox",
    [
      {
        id: "task-1",
        taskListId: "inbox",
        title: "Draft inbox triage rules",
        notes: "Local search should find task notes.",
        status: "needsAction",
        dueAt: now,
        deleted: false,
        hidden: false,
        updatedAt: now
      },
      {
        id: "task-2",
        taskListId: "inbox",
        title: "Completed task",
        status: "completed",
        completedAt: now,
        deleted: false,
        hidden: false,
        updatedAt: now
      }
    ],
    {
      fullSync: true,
      now
    }
  );
  syncRepository.writeCalendarLists(
    "acct-1",
    [
      {
        id: "product",
        summary: "Product",
        timeZone: "UTC",
        isSelected: true,
        isHidden: false,
        isPrimary: true,
        updatedAt: now
      }
    ],
    now
  );
  syncRepository.writeCalendarEvents(
    "acct-1",
    "product",
    [
      {
        id: "event-1",
        calendarId: "product",
        status: "confirmed",
        summary: "Planner shell standup",
        description: "Review cache-first startup.",
        location: "Desk",
        startAt: "2026-05-22T09:30:00.000Z",
        endAt: "2026-05-22T09:50:00.000Z",
        isAllDay: false,
        updatedAt: now
      }
    ],
    {
      fullSync: true,
      now,
      defaultTimeZone: "UTC"
    }
  );
}

describe("SQLite-backed domain services", () => {
  it("renders empty bounded responses from a fresh migrated database", async () => {
    const { domain } = createTestServices();

    expect(await domain.planner.listTaskLists({ limit: 10 })).toEqual({
      items: [],
      page: {
        limit: 10,
        totalKnown: 0
      }
    });
    expect(await domain.planner.listTasks({ status: "all", limit: 10 })).toEqual({
      items: [],
      page: {
        limit: 10,
        totalKnown: 0
      }
    });
    expect(await domain.planner.listNotes({ limit: 10 })).toEqual({
      items: [],
      lists: [],
      page: {
        limit: 10,
        totalKnown: 0
      }
    });
  });

  it("reads seeded task, calendar, note, settings, search, and timing data from SQLite", async () => {
    const { domain, syncRepository, performanceRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);

    const createdNote = await domain.planner.createNote({
      title: "Cache-first startup",
      body: "Renderer should paint from SQLite before fresh sync completes."
    });
    const updatedSettings = await domain.settings.update({
      theme: "dark",
      colorTheme: "dracula",
      uiFontName: "Inter",
      uiTextSizePoints: 15,
      mcpEnabled: true
    });
    const tasks = await domain.planner.listTasks({ status: "all", limit: 10 });
    const events = await domain.planner.listCalendarEvents({
      start: "2026-05-22T00:00:00.000Z",
      end: "2026-05-23T00:00:00.000Z",
      limit: 10
    });
    const search = await domain.planner.search({
      query: "startup",
      domains: ["calendar", "notes"],
      limit: 10
    });

    expect(updatedSettings).toMatchObject({
      theme: "dark",
      colorTheme: "dracula",
      uiFontName: "Inter",
      uiTextSizePoints: 15,
      mcpEnabled: true
    });
    expect(tasks.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "acct-1:task:inbox:task-1",
          title: "Draft inbox triage rules"
        })
      ])
    );
    expect(events.items).toEqual([
      expect.objectContaining({
        id: "acct-1:event:product:event-1",
        title: "Planner shell standup",
        timeZone: "UTC"
      })
    ]);
    expect(search.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: "calendar",
          title: "Planner shell standup"
        }),
        expect.objectContaining({
          domain: "notes",
          title: "Cache-first startup"
        })
      ])
    );

    const updatedNote = await domain.planner.updateNote({
      id: createdNote.id,
      body: "Updated body"
    });
    const deleted = await domain.planner.deleteNote({ id: createdNote.id });

    expect(updatedNote.body).toBe("Updated body");
    expect(deleted).toMatchObject({
      id: createdNote.id,
      queued: true
    });
    expect(performanceRepository.listRecent(20)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "sqlite_query" }),
        expect.objectContaining({ kind: "search" })
      ])
    );
  });

  it("migrates the old Cmd+T pane shortcut to web tabs", async () => {
    const { domain } = createTestServices();
    const migrated = await domain.settings.update({
      keybindings: {
        ...defaultKeybindings,
        "pane.create": "CmdOrCtrl+T",
        "web.tab.create": undefined
      } as unknown as typeof defaultKeybindings
    });

    expect(migrated.keybindings["pane.create"]).toBeNull();
    expect(migrated.keybindings["web.tab.create"]).toBe("CmdOrCtrl+T");
  });

  it("loads only calendar-visible tasks for light bootstrap", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    await domain.planner.createTask({
      title: "Future dated task",
      listId: "acct-1:task-list:inbox",
      dueDate: "2026-06-22"
    });
    await domain.planner.createNote({
      title: "Undated note",
      body: "Should hydrate after first paint."
    });

    const tasks = await domain.planner.listCalendarBootstrapTasks?.({
      start: "2026-05-22T00:00:00.000Z",
      end: "2026-05-23T00:00:00.000Z",
      listIds: ["acct-1:task-list:inbox"],
      limit: 10
    });

    expect(tasks?.items).toEqual([
      expect.objectContaining({
        id: "acct-1:task:inbox:task-1",
        title: "Draft inbox triage rules"
      })
    ]);
  });

  it("undoes and redoes task edits through inverse pending mutations", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const id = "acct-1:task:inbox:task-1";

    await domain.planner.updateTask({
      id,
      title: "Updated task title"
    });

    expect(await domain.undo.status()).toMatchObject({
      canUndo: true,
      canRedo: false,
      undoLabel: "Edit task"
    });

    await domain.undo.undo();
    expect(await domain.planner.getTask({ id })).toMatchObject({
      title: "Draft inbox triage rules"
    });
    expect(await domain.undo.status()).toMatchObject({
      canUndo: false,
      canRedo: true,
      redoLabel: "Edit task"
    });

    await domain.undo.redo();
    expect(await domain.planner.getTask({ id })).toMatchObject({
      title: "Updated task title"
    });
    const taskMutations = temp?.connection.query<{ operation: string }>(
        `SELECT operation
         FROM google_pending_mutations
         WHERE resource_id = ?;`,
        [id]
      ) ?? [];

    expect(taskMutations).toHaveLength(3);
    expect(taskMutations).toEqual([
      { operation: "task.update" },
      { operation: "task.update" },
      { operation: "task.update" }
    ]);
  });

  it("blocks undo when the task changed after the undoable write", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const id = "acct-1:task:inbox:task-1";

    await domain.planner.updateTask({
      id,
      title: "Updated task title"
    });
    testConnection().run(
      "UPDATE google_tasks SET title = ?, updated_at = ? WHERE id = ?;",
      ["Edited elsewhere", "2026-05-22T00:01:00.000Z", id]
    );

    try {
      await domain.undo.undo();
      throw new Error("Expected undo to conflict.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "CONFLICT",
        recoverable: true
      });
    }

    expect(await domain.planner.getTask({ id })).toMatchObject({
      title: "Edited elsewhere"
    });
    expect(await domain.undo.status()).toMatchObject({
      canUndo: true,
      canRedo: false
    });
  });

  it("blocks redo when the task changed after undo", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const id = "acct-1:task:inbox:task-1";

    await domain.planner.updateTask({
      id,
      title: "Updated task title"
    });
    await domain.undo.undo();
    testConnection().run(
      "UPDATE google_tasks SET title = ?, updated_at = ? WHERE id = ?;",
      ["Edited elsewhere", "2026-05-22T00:02:00.000Z", id]
    );

    try {
      await domain.undo.redo();
      throw new Error("Expected redo to conflict.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "CONFLICT",
        recoverable: true
      });
    }

    expect(await domain.planner.getTask({ id })).toMatchObject({
      title: "Edited elsewhere"
    });
    expect(await domain.undo.status()).toMatchObject({
      canUndo: false,
      canRedo: true
    });
  });

  it("cleans stale undo entries without clearing the current session", async () => {
    const { domain, syncRepository, undoRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const payload = JSON.stringify({
      version: 1,
      actionKind: "task.update",
      resourceKind: "task",
      resourceId: "stale-task",
      target: null,
      opposite: null
    });

    testConnection().run(
      `INSERT INTO local_undo_entries (
         id, session_id, stack, action_kind, label, resource_kind, resource_id,
         undo_payload_json, redo_payload_json, created_at, applied_at
       ) VALUES (?, ?, 'undo', 'task.update', 'Edit task', 'task', ?, ?, ?, ?, NULL);`,
      [
        "stale-old-session",
        "session:old",
        "stale-task",
        payload,
        payload,
        "1970-01-01T00:00:00.000Z"
      ]
    );
    testConnection().run(
      `INSERT INTO local_undo_entries (
         id, session_id, stack, action_kind, label, resource_kind, resource_id,
         undo_payload_json, redo_payload_json, created_at, applied_at
       ) VALUES (?, ?, 'undo', 'task.update', 'Edit task', ?, ?, ?, ?, ?, NULL);`,
      [
        "current-session-old",
        undoRepository.sessionId,
        "task",
        "current-task",
        payload,
        payload,
        "1970-01-01T00:00:00.000Z"
      ]
    );

    await domain.planner.updateTask({
      id: "acct-1:task:inbox:task-1",
      title: "Updated task title"
    });

    const rows = testConnection().query<{ id: string; sessionId: string }>(
      `SELECT id, session_id AS sessionId
       FROM local_undo_entries
       ORDER BY id ASC;`
    );
    expect(rows.some((row) => row.id === "stale-old-session")).toBe(false);
    expect(rows.some((row) => row.id === "current-session-old")).toBe(true);
    expect(rows.some((row) => row.sessionId === undoRepository.sessionId)).toBe(true);
  });

  it("undoes calendar event creation by appending a delete mutation", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);

    const created = await domain.planner.createCalendarEvent({
      calendarId: "acct-1:calendar:product",
      title: "Undoable event",
      startsAt: "2026-05-22T11:00:00.000Z",
      endsAt: "2026-05-22T12:00:00.000Z"
    });

    await domain.undo.undo();

    expect(() => domain.planner.getCalendarEvent({ id: created.id })).toThrow("Calendar event was not found.");
    const eventMutations = temp?.connection.query<{ operation: string }>(
        `SELECT operation
         FROM google_pending_mutations
         WHERE resource_id = ?;`,
        [created.id]
      ) ?? [];

    expect(eventMutations).toHaveLength(2);
    expect(eventMutations).toEqual(
      expect.arrayContaining([
        { operation: "calendar.events.create" },
        { operation: "calendar.events.delete" }
      ])
    );
  });

  it("persists v1 settings sections in SQLite", async () => {
    const { domain } = createTestServices();

    const updated = await domain.settings.update({
      setupCompletedAt: "2026-05-22T00:00:00.000Z",
      theme: "dark",
      colorTheme: "githubDark",
      uiFontName: "JetBrains Mono",
      uiTextSizePoints: 16,
      appLanguage: "ja",
      navigationTabOrder: ["notes", "calendar", "tasks"],
      toolbarActionOrder: ["settings", "refresh", "splitPane", "diagnostics", "notifications", "commandPalette"],
      selectedTaskListIds: ["list-a", "list-b", "list-a"],
      selectedCalendarIds: ["cal-a"],
      syncMode: "near-real-time",
      showTrayIcon: false,
      trayClickAction: "open-menu",
      menuBarPanelStyle: "calendar",
      showMenuBarBadge: false,
      notificationsEnabled: true,
      notificationLeadMinutes: 30,
      mcpEnabled: true,
      mcpPermissionMode: "allow-writes",
      mcpPort: 4777,
      defaultTimeZone: "Asia/Singapore",
      todayCapacityMinutes: 360,
      todayWorkingHoursStart: 7,
      todayWorkingHoursEnd: 18,
      diagnosticsIncludePerformance: false
    });
    const reread = await domain.settings.get();

    expect(updated).toMatchObject({
      setupCompletedAt: "2026-05-22T00:00:00.000Z",
      theme: "dark",
      colorTheme: "githubDark",
      uiFontName: "JetBrains Mono",
      uiTextSizePoints: 16,
      appLanguage: "ja",
      navigationTabOrder: ["notes", "calendar", "tasks"],
      toolbarActionOrder: ["settings", "refresh", "splitPane", "diagnostics", "notifications", "commandPalette"],
      selectedTaskListIds: ["list-a", "list-b"],
      selectedCalendarIds: ["cal-a"],
      syncMode: "near-real-time",
      showTrayIcon: false,
      trayClickAction: "open-menu",
      menuBarPanelStyle: "calendar",
      showMenuBarBadge: false,
      notificationsEnabled: true,
      notificationLeadMinutes: 30,
      mcpEnabled: true,
      mcpPermissionMode: "allow-writes",
      mcpPort: 4777,
      defaultTimeZone: "Asia/Singapore",
      todayCapacityMinutes: 360,
      todayWorkingHoursStart: 7,
      todayWorkingHoursEnd: 18,
      diagnosticsIncludePerformance: false
    });
    expect(reread).toEqual(updated);
  });

  it("resets onboarding without deleting planner data", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);

    await domain.settings.update({
      setupCompletedAt: "2026-05-22T00:00:00.000Z"
    });
    const note = await domain.planner.createNote({
      title: "Local note survives onboarding reset",
      body: "No planner rows should be deleted."
    });
    const reset = await domain.settings.recoveryAction({ action: "resetOnboarding" });

    expect(reset).toMatchObject({
      accepted: true,
      destructive: false,
      requiresReload: false
    });
    expect((await domain.settings.get()).setupCompletedAt).toBeNull();
    expect(await domain.planner.getNote({ id: note.id })).toMatchObject({
      title: "Local note survives onboarding reset"
    });
  });

  it("deletes note lists by deleting the backing task list", async () => {
    const { domain } = createTestServices();
    const list = await domain.planner.createNoteList({ title: "Side notes" });
    const note = await domain.planner.createNote({
      listId: list.id,
      title: "List note",
      body: "Move me."
    });

    const deleted = await domain.planner.deleteNoteList({ id: list.id });
    const lists = await domain.planner.listNotes({ limit: 10 });

    expect(deleted).toMatchObject({ id: list.id, queued: true });
    expect(() => domain.planner.getNote({ id: note.id })).toThrow("Note was not found.");
    expect(lists.lists.some((candidate) => candidate.id === list.id)).toBe(false);
  });

  it("rejects destructive recovery actions without confirmation", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);

    await expect(
      domain.settings.recoveryAction({
        action: "clearGoogleCache"
      })
    ).rejects.toThrow("Type CLEAR CACHE");

    const accepted = await domain.settings.recoveryAction({
      action: "clearGoogleCache",
      confirmation: {
        accepted: true,
        phrase: "CLEAR CACHE"
      }
    });

    expect(accepted).toMatchObject({
      accepted: true,
      destructive: true,
      requiresReload: true
    });
    expect((await domain.planner.listTasks({ status: "all", limit: 10 })).items).toEqual([]);
  });

  it("uses the same task-backed note service through MCP and planner search", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);

    const created = await domain.mcpTools.notes.createNote({
      title: "MCP shared note",
      body: "Created through the shared domain service."
    });
    const search = await domain.planner.search({
      query: "shared domain",
      domains: ["notes"],
      limit: 10
    });

    expect(created).toMatchObject({
      kind: "note",
      title: "MCP shared note"
    });
    expect(search.items).toContainEqual(
      expect.objectContaining({
        domain: "notes",
        title: "MCP shared note"
      })
    );
  });

  it("applies structured local search filters in SQLite", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    await domain.planner.updateTask({
      id: "acct-1:task:inbox:task-1",
      priority: "high"
    });
    await domain.planner.createNote({
      title: "Empty scratchpad",
      body: ""
    });

    const taskSearch = await domain.planner.search({
      query: "source:tasks status:open due:2026-05-22 priority:high list:Inbox notes:yes triage",
      limit: 10
    });
    const eventSearch = await domain.planner.search({
      query: "source:calendar start:2026-05-22 calendar:Product body:yes startup",
      limit: 10
    });
    const emptyNoteSearch = await domain.planner.search({
      query: "source:notes body:no",
      limit: 10
    });

    expect(taskSearch.items).toEqual([
      expect.objectContaining({
        domain: "tasks",
        title: "Draft inbox triage rules"
      })
    ]);
    expect(eventSearch.items).toEqual([
      expect.objectContaining({
        domain: "calendar",
        title: "Planner shell standup"
      })
    ]);
    expect(emptyNoteSearch.items).toEqual([
      expect.objectContaining({
        domain: "notes",
        title: "Empty scratchpad"
      })
    ]);
    expect(() =>
      domain.planner.search({
        query: "status:blocked",
        limit: 10
      })
    ).toThrow("Unsupported task status");
  });

  it("links Google Calendar task projections to synced Google tasks", async () => {
    const { domain, syncRepository } = createTestServices();
    const taskUrlToken = "1u__Kt1mliHUFzMf";
    const taskGoogleId = "MXVfX0t0MW1saUhVRnpNZg";
    const taskId = `acct-1:task:inbox:${taskGoogleId}`;

    syncRepository.writeTaskLists(
      "acct-1",
      [{ id: "inbox", title: "Inbox", updatedAt: now }],
      now
    );
    syncRepository.writeTasks(
      "acct-1",
      "inbox",
      [{
        id: taskGoogleId,
        taskListId: "inbox",
        title: "WHATSAPP: Give Ian Chai a whatsapp message update on LawNet scraping",
        notes: "Task body",
        status: "completed",
        dueAt: "2026-05-31T00:00:00.000Z",
        deleted: false,
        hidden: false,
        updatedAt: now
      }],
      { fullSync: true, now }
    );
    syncRepository.writeCalendarLists(
      "acct-1",
      [{
        id: "primary",
        summary: "Primary",
        timeZone: "UTC",
        isSelected: true,
        isHidden: false,
        isPrimary: true,
        updatedAt: now
      }],
      now
    );
    syncRepository.writeCalendarEvents(
      "acct-1",
      "primary",
      [{
        id: "projection-event",
        calendarId: "primary",
        status: "confirmed",
        summary: "WHATSAPP: Give Ian Chai a whatsapp message update on LawNet scraping",
        description: `Changes made to the title, description or attachments will not be saved. To make edits, please go to: https://tasks.google.com/task/${taskUrlToken}`,
        startAt: "2026-05-31T07:00:00.000Z",
        endAt: "2026-05-31T07:30:00.000Z",
        isAllDay: false,
        updatedAt: now
      }],
      { fullSync: true, now }
    );

    const events = await domain.planner.listCalendarEvents({
      start: "2026-05-31T00:00:00.000Z",
      end: "2026-06-01T00:00:00.000Z",
      limit: 10
    });
    const event = events.items[0];
    const detail = await domain.planner.getCalendarEvent({ id: event?.id ?? "" });
    const calendarSearch = await domain.planner.search({
      query: "source:calendar LawNet",
      limit: 10
    });
    const taskSearch = await domain.planner.search({
      query: "source:tasks LawNet",
      limit: 10
    });

    expect(event).toMatchObject({
      linkedTaskId: taskId,
      startsAt: "2026-05-31T07:00:00.000Z",
      endsAt: "2026-05-31T07:30:00.000Z"
    });
    expect(detail.linkedTaskId).toBe(taskId);
    expect(calendarSearch.items).toEqual([]);
    expect(taskSearch.items).toEqual([
      expect.objectContaining({
        domain: "tasks",
        id: taskId
      })
    ]);
  });

  it("optimistically mutates tasks, subtasks, lists, and queue-backed task writes", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const listId = "acct-1:task-list:inbox";
    const parentId = "acct-1:task:inbox:task-1";

    const created = await domain.planner.createTask({
      title: "Write task queue tests",
      notes: "Covers local optimistic task writes.",
      dueDate: "2026-05-23",
      listId,
      parentId,
      priority: "high"
    });

    expect(created).toMatchObject({
      title: "Write task queue tests",
      status: "active",
      dueAt: "2026-05-23T00:00:00.000Z",
      parentId,
      priority: "high",
      mutationState: "queued"
    });
    expect((await domain.sync.status()).pendingMutationCount).toBe(1);

    const updated = await domain.planner.updateTask({
      id: created.id,
      title: "Write task mutation tests",
      notes: "Updated notes.",
      dueDate: null,
      priority: "low"
    });
    const completed = await domain.planner.completeTask({ id: created.id });
    const reopened = await domain.planner.reopenTask({ id: created.id });
    const moved = await domain.planner.moveTask({ id: created.id, parentId: null });
    const deleted = await domain.planner.deleteTask({ id: created.id });

    expect(updated).toMatchObject({
      title: "Write task mutation tests",
      dueAt: null,
      priority: "low"
    });
    expect(completed.status).toBe("completed");
    expect(reopened.status).toBe("active");
    expect(moved.parentId).toBeNull();
    expect(deleted).toMatchObject({ id: created.id, queued: true });

    const taskList = await domain.planner.createTaskList({ title: "Errands" });
    const renamedList = await domain.planner.renameTaskList({
      id: taskList.id,
      title: "Errands renamed"
    });
    const deletedList = await domain.planner.deleteTaskList({ id: taskList.id });

    expect(renamedList.title).toBe("Errands renamed");
    expect(deletedList).toMatchObject({ id: taskList.id, queued: true });
    expect((await domain.sync.status()).pendingMutationCount).toBe(9);

    const operations = temp!.connection.query<{ resourceType: string; operation: string }>(
      `SELECT resource_type AS resourceType, operation
       FROM google_pending_mutations
       ORDER BY rowid ASC;`
    );

    expect(operations).toEqual([
      { resourceType: "task", operation: "task.create" },
      { resourceType: "task", operation: "task.update" },
      { resourceType: "task", operation: "task.complete" },
      { resourceType: "task", operation: "task.reopen" },
      { resourceType: "task", operation: "task.move" },
      { resourceType: "task", operation: "task.delete" },
      { resourceType: "task_list", operation: "task_list.create" },
      { resourceType: "task_list", operation: "task_list.rename" },
      { resourceType: "task_list", operation: "task_list.delete" }
    ]);
  });

  it("uses task indexes for list, status, due date, parent, and sort-order paths", () => {
    const { syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const details = (sql: string, params: readonly (string | number | boolean | null)[]) =>
      temp!.connection.query<{ detail: string }>(sql, params).map((row) => row.detail).join("\n");

    const listStatusDuePlan = details(
      `EXPLAIN QUERY PLAN
       SELECT id
       FROM google_tasks
       WHERE account_id = ?
         AND task_list_id = ?
         AND status = ?
         AND due_at >= ?
       ORDER BY due_at ASC, sort_order ASC
       LIMIT ?;`,
      ["acct-1", "acct-1:task-list:inbox", "needsAction", "2026-05-22T00:00:00.000Z", 20]
    );
    const visibleSortPlan = details(
      `EXPLAIN QUERY PLAN
       SELECT id
       FROM google_tasks
       WHERE task_list_id = ?
         AND deleted_at IS NULL
         AND is_hidden = 0
         AND status = ?
       ORDER BY due_at ASC, sort_order ASC, updated_at DESC, id ASC
       LIMIT ?;`,
      ["acct-1:task-list:inbox", "needsAction", 20]
    );
    const parentPlan = details(
      `EXPLAIN QUERY PLAN
       SELECT id
       FROM google_tasks
       WHERE parent_task_id = ?
         AND deleted_at IS NULL
       ORDER BY sort_order ASC, id ASC
       LIMIT ?;`,
      ["acct-1:task:inbox:task-1", 20]
    );

    expect(listStatusDuePlan).toContain("idx_google_tasks_list_status_due");
    expect(visibleSortPlan).toContain("idx_google_tasks_visible_list_due");
    expect(parentPlan).toContain("idx_google_tasks_parent_visible");
  });

  it("uses FTS-backed indexes for task, event, and note search", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    await domain.planner.createNote({
      title: "Cache-first startup",
      body: "Renderer local search should find note body text."
    });

    const search = await domain.planner.search({
      query: "local search",
      limit: 10
    });
    const planDetails = (sql: string, params: readonly (string | number | boolean | null)[]) =>
      temp!.connection.query<{ detail: string }>(sql, params).map((row) => row.detail).join("\n");

    const taskFtsPlan = planDetails(
      `EXPLAIN QUERY PLAN
       SELECT tasks.id
       FROM google_tasks_fts
       INNER JOIN google_tasks tasks ON tasks.rowid = google_tasks_fts.rowid
       WHERE google_tasks_fts MATCH ?
         AND tasks.deleted_at IS NULL
       LIMIT ?;`,
      ["local*", 10]
    );
    const eventFtsPlan = planDetails(
      `EXPLAIN QUERY PLAN
       SELECT events.id
       FROM google_calendar_events_fts
       INNER JOIN google_calendar_events events ON events.rowid = google_calendar_events_fts.rowid
       WHERE google_calendar_events_fts MATCH ?
         AND events.deleted_at IS NULL
       LIMIT ?;`,
      ["startup*", 10]
    );
    const noteFtsPlan = planDetails(
      `EXPLAIN QUERY PLAN
       SELECT tasks.id
       FROM google_tasks_fts
       INNER JOIN google_tasks tasks ON tasks.rowid = google_tasks_fts.rowid
       INNER JOIN google_task_lists lists ON lists.id = tasks.task_list_id
       WHERE google_tasks_fts MATCH ?
         AND tasks.deleted_at IS NULL
         AND tasks.is_hidden = 0
         AND tasks.status != 'completed'
         AND tasks.parent_task_id IS NULL
         AND tasks.due_at IS NULL
         AND lists.deleted_at IS NULL
       LIMIT ?;`,
      ["search*", 10]
    );

    expect(search.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: "tasks",
          title: "Draft inbox triage rules"
        }),
        expect.objectContaining({
          domain: "notes",
          title: "Cache-first startup"
        })
      ])
    );
    expect(taskFtsPlan).toContain("VIRTUAL TABLE INDEX");
    expect(eventFtsPlan).toContain("VIRTUAL TABLE INDEX");
    expect(noteFtsPlan).toContain("VIRTUAL TABLE INDEX");
  });

  it("creates, updates, deletes, and queues all-day calendar event mutations", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);

    const created = await domain.planner.createCalendarEvent({
      title: "Release blackout",
      calendarId: "acct-1:calendar:product",
      startsAt: "2026-05-22T15:30:00.000Z",
      endsAt: "2026-05-22T15:30:00.000Z",
      allDay: true,
      location: "Remote",
      notes: "No deploys.",
      guestEmails: ["ADA@example.com", "ada@example.com", "bad-paste"],
      reminderMinutes: [30, 10, 10]
    });

    expect(created).toMatchObject({
      title: "Release blackout",
      allDay: true,
      startsAt: "2026-05-22T00:00:00.000Z",
      endsAt: "2026-05-23T00:00:00.000Z",
      guestEmails: ["ada@example.com"],
      reminderMinutes: [10, 30]
    });
    expect((await domain.sync.status()).pendingMutationCount).toBe(1);

    const updated = await domain.planner.updateCalendarEvent({
      id: created.id,
      title: "Release freeze",
      allDay: false,
      startsAt: "2026-05-22T09:00:00.000Z",
      endsAt: "2026-05-22T10:00:00.000Z",
      reminderMinutes: [15]
    });

    expect(updated).toMatchObject({
      title: "Release freeze",
      allDay: false,
      startsAt: "2026-05-22T09:00:00.000Z",
      endsAt: "2026-05-22T10:00:00.000Z",
      reminderMinutes: [15]
    });
    expect((await domain.sync.status()).pendingMutationCount).toBe(2);

    const visible = await domain.planner.listCalendarEvents({
      calendarIds: ["acct-1:calendar:product"],
      start: "2026-05-22T00:00:00.000Z",
      end: "2026-05-23T00:00:00.000Z",
      limit: 20
    });

    expect(visible.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.eventId,
          title: "Release freeze"
        })
      ])
    );

    const deleted = await domain.planner.deleteCalendarEvent({ id: created.id });
    const afterDelete = await domain.planner.listCalendarEvents({
      calendarIds: ["acct-1:calendar:product"],
      start: "2026-05-22T00:00:00.000Z",
      end: "2026-05-23T00:00:00.000Z",
      limit: 20
    });

    expect(deleted).toMatchObject({ id: created.eventId, queued: true });
    expect(afterDelete.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.eventId
        })
      ])
    );
    expect((await domain.sync.status()).pendingMutationCount).toBe(3);
  });

  it("maps pending mutation status onto calendar events", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);

    const created = await domain.planner.createCalendarEvent({
      title: "Queued event",
      calendarId: "acct-1:calendar:product",
      startsAt: "2026-05-22T11:00:00.000Z",
      endsAt: "2026-05-22T12:00:00.000Z"
    });

    expect(created.mutationState).toBe("queued");

    temp!.connection.run(
      `UPDATE google_pending_mutations
       SET status = 'failed'
       WHERE resource_id = ?;`,
      [created.eventId ?? created.id]
    );

    const listed = await domain.planner.listCalendarEvents({
      calendarIds: ["acct-1:calendar:product"],
      start: "2026-05-22T00:00:00.000Z",
      end: "2026-05-23T00:00:00.000Z",
      limit: 20
    });
    const failed = listed.items.find((event) => event.eventId === (created.eventId ?? created.id));
    const detail = await domain.planner.getCalendarEvent({ id: created.id });

    expect(failed?.mutationState).toBe("failed");
    expect(detail.mutationState).toBe("failed");
  });

  it("schedules task blocks as linked calendar events and supports static availability export", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);

    const block = await domain.planner.scheduleTaskBlock({
      taskId: "acct-1:task:inbox:task-1",
      calendarId: "acct-1:calendar:product",
      startsAt: "2026-05-22T10:00:00.000Z",
      durationMinutes: 45
    });

    expect(block).toMatchObject({
      taskId: "acct-1:task:inbox:task-1",
      calendarId: "acct-1:calendar:product",
      title: "Draft inbox triage rules",
      startsAt: "2026-05-22T10:00:00.000Z",
      endsAt: "2026-05-22T10:45:00.000Z",
      durationMinutes: 45,
      mutationState: "queued"
    });

    const blocks = await domain.planner.listScheduledTaskBlocks({
      start: "2026-05-22T00:00:00.000Z",
      end: "2026-05-23T00:00:00.000Z",
      limit: 20
    });

    expect(blocks.items).toEqual([
      expect.objectContaining({
        id: block.id,
        calendarEventId: block.calendarEventId,
        status: "scheduled"
      })
    ]);
    expect(
      (await domain.planner.getCalendarEvent({ id: block.calendarEventId })).title
    ).toBe("Draft inbox triage rules");

    const moved = await domain.planner.moveScheduledTaskBlock({
      id: block.id,
      startsAt: "2026-05-22T11:00:00.000Z",
      durationMinutes: 30
    });

    expect(moved).toMatchObject({
      startsAt: "2026-05-22T11:00:00.000Z",
      endsAt: "2026-05-22T11:30:00.000Z",
      durationMinutes: 30,
      mutationState: "queued"
    });

    const availability = await domain.planner.exportAvailability({
      start: "2026-05-22T00:00:00.000Z",
      end: "2026-05-23T00:00:00.000Z"
    });

    expect(availability).toMatchObject({
      format: "text",
      busyBlockCount: 2
    });
    expect(availability.text).toContain("Planner shell standup");
    expect(availability.text).toContain("Draft inbox triage rules");

    const unscheduled = await domain.planner.unscheduleTaskBlock({
      id: block.id,
      deleteCalendarEvent: true
    });
    const afterUnschedule = await domain.planner.listScheduledTaskBlocks({
      start: "2026-05-22T00:00:00.000Z",
      end: "2026-05-23T00:00:00.000Z",
      limit: 20
    });

    expect(unscheduled).toMatchObject({ id: block.id, queued: true });
    expect(afterUnschedule.items).toEqual([]);
    expect((await domain.sync.status()).pendingMutationCount).toBe(3);
  });

  it("prevents duplicate scheduled task blocks and repairs orphaned blocks", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);

    const block = await domain.planner.scheduleTaskBlock({
      taskId: "acct-1:task:inbox:task-1",
      calendarId: "acct-1:calendar:product",
      startsAt: "2026-05-22T10:00:00.000Z",
      durationMinutes: 45
    });

    expect(() =>
      domain.planner.scheduleTaskBlock({
        taskId: "acct-1:task:inbox:task-1",
        calendarId: "acct-1:calendar:product",
        startsAt: "2026-05-22T12:00:00.000Z",
        durationMinutes: 45
      })
    ).toThrow(/already has a scheduled block/i);
    expect(
      domain.planner.scheduleTaskBlock({
        taskId: "acct-1:task:inbox:task-1",
        calendarId: "acct-1:calendar:product",
        startsAt: "2026-05-22T10:00:00.000Z",
        durationMinutes: 45
      })
    ).toMatchObject({
      id: block.id,
      calendarEventId: block.calendarEventId
    });

    const googleEventId = block.calendarEventId.split(":").at(-1) ?? "";
    syncRepository.writeCalendarEvents(
      "acct-1",
      "product",
      [
        {
          id: googleEventId,
          calendarId: "product",
          status: "confirmed",
          summary: "Externally moved task block",
          startAt: "2026-05-22T13:00:00.000Z",
          endAt: "2026-05-22T14:15:00.000Z",
          isAllDay: false,
          updatedAt: now
        }
      ],
      {
        fullSync: false,
        now
      }
    );

    expect(
      (
        await domain.planner.listScheduledTaskBlocks({
          start: "2026-05-22T00:00:00.000Z",
          end: "2026-05-23T00:00:00.000Z",
          limit: 20
        })
      ).items[0]
    ).toMatchObject({
      startsAt: "2026-05-22T13:00:00.000Z",
      endsAt: "2026-05-22T14:15:00.000Z",
      durationMinutes: 75,
      status: "scheduled"
    });

    syncRepository.writeCalendarEvents("acct-1", "product", [], {
      fullSync: true,
      now
    });

    expect(
      (
        await domain.planner.listScheduledTaskBlocks({
          start: "2026-05-22T00:00:00.000Z",
          end: "2026-05-23T00:00:00.000Z",
          limit: 20
        })
      ).items[0]
    ).toMatchObject({
      id: block.id,
      status: "orphaned"
    });

    const repaired = await domain.planner.moveScheduledTaskBlock({
      id: block.id,
      calendarId: "acct-1:calendar:product",
      startsAt: "2026-05-22T15:00:00.000Z",
      durationMinutes: 30
    });

    expect(repaired).toMatchObject({
      id: block.id,
      status: "scheduled",
      startsAt: "2026-05-22T15:00:00.000Z",
      endsAt: "2026-05-22T15:30:00.000Z",
      mutationState: "queued"
    });
    expect(repaired.calendarEventId).not.toBe(block.calendarEventId);
  });

  it("returns materialized recurring instances from visible range queries", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    syncRepository.writeCalendarEvents(
      "acct-1",
      "product",
      [
        {
          id: "event-daily-root",
          calendarId: "product",
          status: "confirmed",
          summary: "Daily planning",
          startAt: "2026-05-22T08:00:00.000Z",
          endAt: "2026-05-22T08:30:00.000Z",
          isAllDay: false,
          recurrenceRule: "RRULE:FREQ=DAILY;COUNT=3",
          updatedAt: now
        }
      ],
      {
        fullSync: false,
        now
      }
    );

    const events = await domain.planner.listCalendarEvents({
      calendarIds: ["acct-1:calendar:product"],
      start: "2026-05-22T00:00:00.000Z",
      end: "2026-05-25T00:00:00.000Z",
      limit: 20
    });
    const dailyInstances = events.items.filter((event) => event.title === "Daily planning");

    expect(dailyInstances).toHaveLength(3);
    expect(dailyInstances.map((event) => event.startsAt)).toEqual([
      "2026-05-22T08:00:00.000Z",
      "2026-05-23T08:00:00.000Z",
      "2026-05-24T08:00:00.000Z"
    ]);
    expect(dailyInstances[0]?.recurrenceRule).toBe("RRULE:FREQ=DAILY;COUNT=3");
  });

  it("round-trips local calendar recurrence through create and update", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);

    const created = await domain.planner.createCalendarEvent({
      title: "Recurring planning",
      calendarId: "acct-1:calendar:product",
      startsAt: "2026-05-22T08:00:00.000Z",
      endsAt: "2026-05-22T08:30:00.000Z",
      recurrence: {
        frequency: "weekly",
        interval: 2,
        endsOn: "2026-06-30",
        count: null
      }
    });

    expect(created.recurrenceRule).toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20260630");

    const events = await domain.planner.listCalendarEvents({
      calendarIds: ["acct-1:calendar:product"],
      start: "2026-05-22T00:00:00.000Z",
      end: "2026-06-30T23:59:59.000Z",
      limit: 20
    });

    expect(events.items.filter((event) => event.title === "Recurring planning").length).toBeGreaterThan(1);

    const updated = await domain.planner.updateCalendarEvent({
      id: created.id,
      recurrence: {
        frequency: "yearly",
        interval: 1,
        count: 2,
        endsOn: null
      }
    });

    expect(updated.recurrenceRule).toBe("RRULE:FREQ=YEARLY;INTERVAL=1;COUNT=2");
  });

  it("applies auto tag rules to task, note, and event creates", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const createdAt = "2026-06-06T00:00:00.000Z";

    await domain.settings.update({
      autoTagRules: [{
        id: "auto-coding",
        name: "Coding",
        enabled: true,
        targetKinds: ["task", "event", "note"],
        matchField: "title",
        matchType: "prefix",
        pattern: "CODING",
        tags: ["coding"],
        stripMatchedPrefix: true,
        eventColorId: "5",
        overrideExistingEventColor: false,
        createdAt,
        updatedAt: createdAt
      }]
    });

    const task = await domain.planner.createTask({
      title: "CODING: Build rules",
      notes: "",
      dueDate: null,
      listId: "acct-1:task-list:inbox",
      tags: ["manual"]
    });
    const note = await domain.planner.createNote({
      title: "CODING: Notes",
      body: "",
      listId: "acct-1:task-list:inbox"
    });
    const event = await domain.planner.createCalendarEvent({
      title: "CODING: Review",
      calendarId: "acct-1:calendar:product",
      startsAt: "2026-05-22T11:00:00.000Z",
      endsAt: "2026-05-22T12:00:00.000Z"
    });

    expect(task).toMatchObject({
      title: "Build rules",
      tags: ["manual", "coding"]
    });
    expect(note).toMatchObject({
      title: "Notes",
      tags: ["coding"]
    });
    expect(event).toMatchObject({
      title: "Review",
      colorId: "5",
      tags: ["coding"]
    });
  });

  it("updates event tags locally without adding a Google mutation", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const created = await domain.planner.createCalendarEvent({
      title: "Tag-only event",
      calendarId: "acct-1:calendar:product",
      startsAt: "2026-05-22T11:00:00.000Z",
      endsAt: "2026-05-22T12:00:00.000Z"
    });
    const before = syncRepository.listActivePendingMutations({ limit: 20 }).length;

    const updated = await domain.planner.updateCalendarEvent({
      id: created.id,
      tags: ["local"]
    });
    const after = syncRepository.listActivePendingMutations({ limit: 20 }).length;

    expect(updated.tags).toEqual(["local"]);
    expect(after).toBe(before);
  });

  it("uses the calendar visible-range index for calendar id and start/end paths", () => {
    const { syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);

    const rows = temp!.connection.query<{ detail: string }>(
      `EXPLAIN QUERY PLAN
       SELECT instances.id
       FROM google_calendar_event_instances instances
       INNER JOIN google_calendar_events events ON events.id = instances.event_id
       INNER JOIN google_calendar_lists calendars ON calendars.id = instances.calendar_id
       WHERE instances.deleted_at IS NULL
         AND instances.status != 'cancelled'
         AND calendars.deleted_at IS NULL
         AND events.deleted_at IS NULL
         AND instances.start_at < ?
         AND instances.end_at > ?
         AND instances.calendar_id IN (?)
       ORDER BY instances.start_at ASC, instances.end_at ASC, instances.id ASC
       LIMIT ? OFFSET ?;`,
      [
        "2026-05-23T00:00:00.000Z",
        "2026-05-22T00:00:00.000Z",
        "acct-1:calendar:product",
        20,
        0
      ]
    );

    expect(rows.map((row) => row.detail).join("\n")).toContain(
      "idx_google_calendar_event_instances_visible_range"
    );
  });
});
