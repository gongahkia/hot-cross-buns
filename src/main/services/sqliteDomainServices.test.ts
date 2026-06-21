import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultKeybindings } from "@shared/settingsCatalog";
import { runLocalDataMigrations } from "../data/migrations";
import { MemorySecretStore } from "../credentials/secretStore";
import { HcbVaultHostCredentialStore } from "../hoster/vaultCredentials";
import { HcbVaultHostServer, uploadHcbVaultPackage } from "../hoster/vaultServer";
import {
  LocalAgentRepository,
  LocalPerformanceRepository,
  LocalPlannerRepository,
  LocalSettingsRepository,
  LocalSettingsSupportRepository,
  LocalUndoRepository,
  LocalWebhookRepository
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
  temp = createTemporarySqliteConnection("hcb-domain-services-");
  runLocalDataMigrations(temp.connection);

  const performanceRepository = new LocalPerformanceRepository(temp.connection);
  const plannerRepository = new LocalPlannerRepository(temp.connection, performanceRepository);
  const settingsRepository = new LocalSettingsRepository(temp.connection);
  const settingsSupportRepository = new LocalSettingsSupportRepository(temp.connection, {
    configDirectory: join(temp.directory, "config"),
    dataDirectory: join(temp.directory, "data"),
    cacheDirectory: join(temp.directory, "cache"),
    logsDirectory: join(temp.directory, "logs"),
    diagnosticsDirectory: join(temp.directory, "diagnostics"),
    tempDirectory: join(temp.directory, "tmp")
  });
  const undoRepository = new LocalUndoRepository(temp.connection);
  const agentRepository = new LocalAgentRepository(temp.connection);
  const webhookRepository = new LocalWebhookRepository(temp.connection);
  const syncRepository = new GoogleSyncRepository(temp.connection);
  const secretStore = new MemorySecretStore();
  const domain = createSqliteDomainServices({
    plannerRepository,
    settingsRepository,
    settingsSupportRepository,
    undoRepository,
    agentRepository,
    webhookRepository,
    syncRepository,
    vaultHostCredentials: new HcbVaultHostCredentialStore(secretStore)
  });

  return {
    domain,
    plannerRepository,
    settingsRepository,
    settingsSupportRepository,
    undoRepository,
    agentRepository,
    webhookRepository,
    syncRepository,
    performanceRepository,
    secretStore
  };
}

function testConnection() {
  if (!temp) {
    throw new Error("Missing test database.");
  }

  return temp.connection;
}

interface HistoryRow extends Record<string, unknown> {
  kind: string;
  resourceId: string | null;
  summary: string;
  metadataJson: string;
}

function historyRows(): HistoryRow[] {
  return testConnection().query<HistoryRow>(
    `SELECT kind,
            resource_id AS resourceId,
            summary,
            metadata_json AS metadataJson
     FROM local_history_entries
     ORDER BY rowid ASC;`
  );
}

function historyMetadata(row: HistoryRow): Record<string, unknown> {
  return JSON.parse(row.metadataJson) as Record<string, unknown>;
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
  it("pushes and pulls encrypted HCB vaults through a trusted vault host", async () => {
    const { domain } = createTestServices();
    const token = "domain-vault-host-token";
    const passphrase = "domain-vault-passphrase";
    const remotePath = join(temp?.directory ?? "", "remote.hcbvault");
    const server = new HcbVaultHostServer({ vaultPath: remotePath, token });
    const started = await server.start({ port: 0 });
    const endpoint = `${started.protocol}://${started.host}:${started.port}/hcb/v1/vault`;

    try {
      await domain.settings.update({
        storageBackend: "hcb-hoster",
        hcbHosterEndpoint: endpoint
      });
      const saved = await domain.settings.saveHcbVaultRemoteCredentials({
        token,
        passphrase
      });
      expect(saved.configured).toBe(true);

      const pushed = await domain.settings.pushHcbVaultRemote({});
      expect(pushed.endpoint).toBe(endpoint);
      expect(pushed.remote.hasVault).toBe(true);
      expect(pushed.remote.packageSha256).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
      expect(pushed.manifest.kind).toBe("hot-cross-buns-vault");

      const status = await domain.settings.hcbVaultRemoteStatus({});
      expect(status.remote.manifest?.payloadSha256).toBe(pushed.manifest.payloadSha256);
      expect(status.remote.packageSha256).toBe(pushed.remote.packageSha256);

      const external = await domain.settings.exportHcbVault({
        out: join(temp?.directory ?? "", "external.hcbvault"),
        passphrase
      });
      await uploadHcbVaultPackage(endpoint, token, external.path);
      await expect(domain.settings.pushHcbVaultRemote({})).rejects.toThrow("412");

      const pulled = await domain.settings.pullHcbVaultRemote({
        confirm: true
      });
      expect(pulled.endpoint).toBe(endpoint);
      expect(pulled.manifest.payloadSha256).toBe(external.manifest.payloadSha256);

      const settings = await domain.settings.get();
      expect(settings.storageBackend).toBe("hcb-hoster");
      expect(settings.hcbHosterEndpoint).toBe(endpoint);
      expect(settings.hcbHosterLastPackageSha256).toBe(pulled.remote.packageSha256);
    } finally {
      await server.stop();
    }
  });

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

  it("records task-backed note create/edit/delete history with title metadata", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);

    const created = await domain.planner.createNote({
      title: "History note",
      body: "Initial body"
    });
    await domain.planner.updateNote({
      id: created.id,
      body: "Changed body"
    });
    await domain.planner.updateNote({
      id: created.id,
      title: "History note",
      body: "Changed body",
      tags: []
    });
    await domain.planner.deleteNote({ id: created.id });

    const noteRows = historyRows().filter((row) => row.kind.startsWith("note."));
    expect(noteRows.map((row) => row.kind)).toEqual(["note.create", "note.edit", "note.delete"]);
    expect(noteRows.map((row) => row.summary)).toEqual([
      'Created note "History note"',
      'Edited note "History note"',
      'Deleted note "History note"'
    ]);
    expect(noteRows.map((row) => historyMetadata(row))).toEqual([
      expect.objectContaining({ title: "History note", taskListTitle: "Inbox" }),
      expect.objectContaining({ title: "History note", taskListTitle: "Inbox" }),
      expect.objectContaining({ title: "History note", taskListTitle: "Inbox" })
    ]);
    expect(historyRows().filter((row) => row.kind === "task.create" || row.kind === "task.edit" || row.kind === "task.delete")).toEqual([]);
  });

  it("records note deletes for each note in a deleted note list", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);

    const list = await domain.planner.createNoteList({ title: "Archive notes" });
    const first = await domain.planner.createNote({
      listId: list.id,
      title: "First archived note",
      body: "One"
    });
    const second = await domain.planner.createNote({
      listId: list.id,
      title: "Second archived note",
      body: "Two"
    });

    await domain.planner.deleteNoteList({ id: list.id });

    const deletedNoteRows = historyRows().filter((row) => row.kind === "note.delete");
    expect(deletedNoteRows.map((row) => row.resourceId)).toEqual([first.id, second.id]);
    expect(deletedNoteRows.map((row) => row.summary)).toEqual([
      'Deleted note "First archived note"',
      'Deleted note "Second archived note"'
    ]);
    expect(historyRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "task_list.delete",
          resourceId: list.id
        })
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
    const undoHistory = historyRows().filter((row) => row.kind === "undo.apply" || row.kind === "redo.apply");
    expect(undoHistory.map((row) => row.kind)).toEqual(["undo.apply", "redo.apply"]);
    expect(undoHistory.map((row) => row.summary)).toEqual(["Undo task: Edit task", "Redo task: Edit task"]);
    expect(undoHistory.map((row) => historyMetadata(row))).toEqual([
      expect.objectContaining({
        actionKind: "task.update",
        resourceDomain: "task",
        resourceKind: "task",
        resourceId: id,
        title: "Draft inbox triage rules"
      }),
      expect.objectContaining({
        actionKind: "task.update",
        resourceDomain: "task",
        resourceKind: "task",
        resourceId: id,
        title: "Updated task title"
      })
    ]);
  });

  it("describes undo history for task-backed notes as notes", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const note = await domain.planner.createNote({
      title: "Undoable note",
      body: "Before"
    });

    await domain.undo.undo();

    const undoHistory = historyRows().filter((row) => row.kind === "undo.apply");
    expect(undoHistory).toHaveLength(1);
    expect(undoHistory[0]).toMatchObject({
      resourceId: note.id,
      summary: "Undo note: Create note"
    });
    expect(historyMetadata(undoHistory[0])).toEqual(
      expect.objectContaining({
        actionKind: "note.create",
        resourceDomain: "note",
        resourceKind: "task",
        title: "Undoable note"
      })
    );
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
    expect(historyRows().filter((row) => row.kind === "undo.apply" || row.kind === "redo.apply")).toEqual([]);
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

  it("exports, previews, and imports deterministic portable archives with attachments", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const attachmentPath = join(temp?.directory ?? "", "receipt.txt");
    const attachmentUrl = pathToFileURL(attachmentPath).href;

    writeFileSync(attachmentPath, "attachment bytes", "utf8");
    await domain.planner.updateTask({
      id: "acct-1:task:inbox:task-1",
      notes: `Local file ${attachmentUrl}`
    });

    const firstExport = await domain.settings.exportPortableArchive();
    const secondExport = await domain.settings.exportPortableArchive();
    const firstState = readFileSync(join(firstExport.path, "hot-cross-buns-state.json"), "utf8");
    const secondState = readFileSync(join(secondExport.path, "hot-cross-buns-state.json"), "utf8");

    expect(firstState).toBe(secondState);
    expect(firstExport.manifest.attachments).toHaveLength(1);
    expect(existsSync(join(firstExport.path, firstExport.manifest.attachments[0]?.bundledRelativePath ?? ""))).toBe(true);

    await domain.planner.updateTask({
      id: "acct-1:task:inbox:task-1",
      title: "Changed after export"
    });

    const preview = await domain.settings.previewPortableImport({ path: firstExport.path });

    expect(preview.tasks.changed).toBe(1);
    expect(preview.items?.tasks).toEqual([
      expect.objectContaining({
        id: "acct-1:task:inbox:task-1",
        change: "changed"
      })
    ]);
    expect(preview.attachments).toMatchObject({
      bundled: 1,
      corrupt: 0,
      missing: 0,
      skipped: 0
    });

    const imported = await domain.settings.importPortableArchive({
      path: firstExport.path,
      confirm: true
    });
    const restored = await domain.planner.getTask({ id: "acct-1:task:inbox:task-1" });

    expect(existsSync(imported.backupPath)).toBe(true);
    expect(restored.title).toBe("Draft inbox triage rules");
    expect(restored.notes).toContain("file://");
    expect(restored.notes).not.toContain(attachmentUrl);
  });

  it("lists and repairs missing local file pointers", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const missingUrl = pathToFileURL(join(temp?.directory ?? "", "missing.txt")).href;
    const replacementPath = join(temp?.directory ?? "", "replacement.txt");

    writeFileSync(replacementPath, "replacement bytes", "utf8");
    await domain.planner.updateTask({
      id: "acct-1:task:inbox:task-1",
      notes: `Missing ${missingUrl}`
    });

    const pointers = await domain.settings.listLocalPointers({ includeHealthy: false, limit: 10 });
    expect(pointers.items).toEqual([
      expect.objectContaining({
        pointer: missingUrl,
        kind: "task",
        entityId: "acct-1:task:inbox:task-1",
        exists: false
      })
    ]);

    const repaired = await domain.settings.repairLocalPointer({
      pointer: missingUrl,
      replacementPath,
      confirm: true
    });
    const replacementUrl = pathToFileURL(replacementPath).href;

    expect(repaired).toMatchObject({ updated: 1, queued: true, replacementPointer: replacementUrl });
    expect((await domain.planner.getTask({ id: "acct-1:task:inbox:task-1" })).notes).toContain(replacementUrl);
  });

  it("loads external settings, keymaps, snippets, and extension manifests", async () => {
    const { domain, settingsSupportRepository } = createTestServices();
    const configDirectory = join(temp?.directory ?? "", "config");
    const snippetDirectory = join(configDirectory, "snippets");
    const extensionDirectory = join(configDirectory, "extensions", "local.example");

    mkdirSync(snippetDirectory, { recursive: true });
    mkdirSync(extensionDirectory, { recursive: true });
    writeFileSync(join(configDirectory, "settings.json"), JSON.stringify({ theme: "dark", uiLayoutScale: 1.1 }), "utf8");
    writeFileSync(join(configDirectory, "keymap.json"), JSON.stringify({ keybindings: { "navigation.tasks": "CmdOrCtrl+8" } }), "utf8");
    writeFileSync(join(snippetDirectory, "accent.css"), ":root{--color-accent:#ff0000;}", "utf8");
    writeFileSync(join(extensionDirectory, "manifest.json"), JSON.stringify({
      id: "local.example",
      name: "Example",
      version: "1.0.0",
      main: "main.js",
      capabilities: ["ui.panel", "log.write"]
    }), "utf8");
    writeFileSync(join(extensionDirectory, "main.js"), "hcbExtension.log('loaded')", "utf8");

    await domain.settings.setSnippetEnabled({ id: "accent.css", enabled: true });
    await domain.settings.setExtensionEnabled({ id: "local.example", enabled: true });

    const settings = await domain.settings.get();
    const status = await domain.settings.customizationStatus();

    expect(settings.theme).toBe("dark");
    expect(settings.uiLayoutScale).toBe(1.1);
    expect(settings.keybindings["navigation.tasks"]).toBe("CmdOrCtrl+8");
    expect(status.snippets[0]).toMatchObject({ id: "accent.css", enabled: true });
    expect(status.snippets[0]?.content).toContain("--color-accent");
    expect(status.extensions[0]).toMatchObject({ id: "local.example", enabled: true });
    expect(status.extensions[0]?.code).toContain("hcbExtension.log");
    expect(settingsSupportRepository.applyExternalSettings(await domain.settings.update({ theme: "light" })).theme).toBe("dark");
  });

  it("adds, lists, opens through metadata, downloads, and removes attachments", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);

    const added = await domain.settings.addAttachment({
      entityKind: "task",
      entityId: "acct-1:task:inbox:task-1",
      fileName: "receipt.txt",
      mimeType: "text/plain",
      dataBase64: Buffer.from("receipt bytes", "utf8").toString("base64")
    });

    expect(added.queued).toBe(true);
    expect(added.items).toHaveLength(1);
    expect(added.items[0]?.displayName).toContain("receipt.txt");
    expect((await domain.planner.getTask({ id: "acct-1:task:inbox:task-1" })).notes).toContain("file://");

    const listed = await domain.settings.listAttachments({
      entityKind: "task",
      entityId: "acct-1:task:inbox:task-1"
    });
    expect(listed.items[0]).toMatchObject({ exists: true, kind: "file" });

    const downloaded = await domain.settings.downloadAttachment({
      pointer: listed.items[0]?.pointer ?? "",
      displayName: "receipt.txt"
    });
    expect(existsSync(downloaded.path)).toBe(true);

    const removed = await domain.settings.removeAttachment({
      pointer: listed.items[0]?.pointer ?? "",
      displayName: "receipt.txt"
    });
    expect(removed.items).toHaveLength(0);
  });

  it("imports ICS into a read-only local calendar and exports local reports", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "X-WR-CALNAME:Launches",
      "BEGIN:VEVENT",
      "UID:demo-1",
      "DTSTAMP:20260701T000000Z",
      "DTSTART:20260703T090000Z",
      "DTEND:20260703T100000Z",
      "SUMMARY:Ship HCB",
      "DESCRIPTION:Release prep",
      "LOCATION:Remote",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const imported = await domain.settings.importIcs({
      fileName: "launches.ics",
      dataBase64: Buffer.from(ics, "utf8").toString("base64")
    });
    const calendars = await domain.planner.listCalendars({ limit: 100 });
    const events = await domain.planner.listCalendarEvents({
      start: "2026-07-01T00:00:00.000Z",
      end: "2026-07-08T00:00:00.000Z",
      limit: 100
    });
    const report = await domain.settings.exportLocalReport({ range: "week", format: "markdown" });

    expect(imported).toMatchObject({ calendarTitle: "Launches", importedEventCount: 1 });
    expect(calendars.items.some((calendar) => calendar.title === "Launches")).toBe(true);
    expect(events.items.some((event) => event.title === "Ship HCB")).toBe(true);
    expect(() => domain.planner.updateCalendarEvent({
      id: events.items.find((event) => event.title === "Ship HCB")?.eventId ?? "",
      title: "Edited"
    })).toThrow(/read-only/);
    expect(existsSync(report.path)).toBe(true);
    expect(readFileSync(report.path, "utf8")).toContain("Hot Cross Buns report");
  });

  it("honors portable export task list, calendar, and future-event filters", async () => {
    const { domain, settingsRepository, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    syncRepository.writeTaskLists(
      "acct-1",
      [{ id: "archive", title: "Archive", updatedAt: now }],
      now
    );
    syncRepository.writeTasks(
      "acct-1",
      "archive",
      [
        {
          id: "task-3",
          taskListId: "archive",
          title: "Archived task",
          status: "needsAction",
          deleted: false,
          hidden: false,
          updatedAt: now
        }
      ],
      { fullSync: true, now }
    );
    syncRepository.writeCalendarLists(
      "acct-1",
      [
        {
          id: "marketing",
          summary: "Marketing",
          timeZone: "UTC",
          isSelected: true,
          isHidden: false,
          isPrimary: false,
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
          id: "past",
          calendarId: "product",
          status: "confirmed",
          summary: "Past product",
          startAt: "2026-05-01T09:00:00.000Z",
          endAt: "2026-05-01T09:30:00.000Z",
          isAllDay: false,
          updatedAt: now
        },
        {
          id: "future",
          calendarId: "product",
          status: "confirmed",
          summary: "Future product",
          startAt: "2026-06-02T09:00:00.000Z",
          endAt: "2026-06-02T09:30:00.000Z",
          isAllDay: false,
          updatedAt: now
        }
      ],
      { fullSync: true, now, defaultTimeZone: "UTC" }
    );
    syncRepository.writeCalendarEvents(
      "acct-1",
      "marketing",
      [
        {
          id: "future",
          calendarId: "marketing",
          status: "confirmed",
          summary: "Future marketing",
          startAt: "2026-06-02T10:00:00.000Z",
          endAt: "2026-06-02T10:30:00.000Z",
          isAllDay: false,
          updatedAt: now
        }
      ],
      { fullSync: true, now, defaultTimeZone: "UTC" }
    );
    syncRepository.enqueuePendingMutation({
      accountId: "acct-1",
      resourceType: "task",
      resourceId: "acct-1:task:inbox:task-1",
      operation: "tasks.update",
      payload: {},
      now
    });
    syncRepository.enqueuePendingMutation({
      accountId: "acct-1",
      resourceType: "task",
      resourceId: "acct-1:task:archive:task-3",
      operation: "tasks.update",
      payload: {},
      now
    });
    syncRepository.enqueuePendingMutation({
      accountId: "acct-1",
      resourceType: "event",
      resourceId: "acct-1:event:product:future",
      operation: "calendar.events.update",
      payload: {},
      now
    });
    syncRepository.enqueuePendingMutation({
      accountId: "acct-1",
      resourceType: "event",
      resourceId: "acct-1:event:marketing:future",
      operation: "calendar.events.update",
      payload: {},
      now
    });
    await domain.settings.update({
      selectedTaskListIds: ["acct-1:task-list:inbox"],
      selectedCalendarIds: ["acct-1:calendar:product"],
      portableExportOnlySelectedTaskLists: true,
      portableExportOnlySelectedCalendars: true,
      portableExportOnlyFutureCurrentEvents: true
    });

    const exported = settingsRepository.exportPortableArchive("2026-06-01T00:00:00.000Z");
    const state = JSON.parse(
      readFileSync(join(exported.path, "hot-cross-buns-state.json"), "utf8")
    ) as { tables: Record<string, { rows: Array<Record<string, unknown>> }> };
    const rowIds = (table: string) => state.tables[table]?.rows.map((row) => row.id).sort() ?? [];
    const mutationResourceIds = state.tables.google_pending_mutations.rows
      .map((row) => row.resource_id)
      .sort();

    expect(rowIds("google_task_lists")).toEqual(["acct-1:task-list:inbox"]);
    expect(rowIds("google_tasks")).toEqual([
      "acct-1:task:inbox:task-1",
      "acct-1:task:inbox:task-2"
    ]);
    expect(rowIds("google_calendar_lists")).toEqual(["acct-1:calendar:product"]);
    expect(rowIds("google_calendar_events")).toEqual(["acct-1:event:product:future"]);
    expect(mutationResourceIds).toEqual([
      "acct-1:event:product:future",
      "acct-1:task:inbox:task-1"
    ]);
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
    const regexTaskSearch = await domain.planner.search({
      query: "source:tasks regex:^Draft.*rules",
      limit: 10
    });
    const regexExactMiss = await domain.planner.search({
      query: "source:tasks regex:^Draft$",
      limit: 10
    });
    const regexEventBodySearch = await domain.planner.search({
      query: "source:calendar regex:Review",
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
    expect(regexTaskSearch.items).toEqual([
      expect.objectContaining({
        domain: "tasks",
        title: "Draft inbox triage rules"
      })
    ]);
    expect(regexExactMiss.items).toEqual([]);
    expect(regexEventBodySearch.items).toEqual([
      expect.objectContaining({
        domain: "calendar",
        title: "Planner shell standup"
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

  it("does not enqueue Google mutations for local or hoster backend writes", async () => {
    const cases = [
      { backend: "google" as const, expectedPending: 3 },
      { backend: "hcb-local" as const, expectedPending: 0 },
      { backend: "hcb-hoster" as const, expectedPending: 0 }
    ];

    for (const { backend, expectedPending } of cases) {
      const { domain, syncRepository } = createTestServices();
      seedGoogleMirrors(syncRepository);
      await domain.settings.update({ storageBackend: backend });

      await domain.planner.createTask({
        title: `${backend} task`,
        listId: "acct-1:task-list:inbox"
      });
      await domain.planner.createCalendarEvent({
        title: `${backend} event`,
        calendarId: "acct-1:calendar:product",
        startsAt: "2026-05-22T12:00:00.000Z",
        endsAt: "2026-05-22T12:30:00.000Z"
      });
      await domain.planner.createNote({
        title: `${backend} note`,
        body: "local backend writes stay local"
      });

      expect((await domain.sync.status()).pendingMutationCount).toBe(expectedPending);
      expect(
        temp!.connection.get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM google_pending_mutations;"
        )?.count ?? 0
      ).toBe(expectedPending);
      temp?.cleanup();
      temp = undefined;
    }
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

  it("previews and applies smart reschedule with grouped undo", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);

    const preview = await domain.planner.smartReschedule({
      date: "2026-05-22",
      calendarId: "acct-1:calendar:product",
      workingHours: { start: 9, end: 12 },
      capacityMinutes: 60
    });

    expect(preview).toMatchObject({
      applied: false,
      suggestions: [
        {
          taskId: "acct-1:task:inbox:task-1",
          calendarId: "acct-1:calendar:product",
          action: "create",
          startsAt: "2026-05-22T09:00:00.000Z",
          endsAt: "2026-05-22T09:30:00.000Z",
          reason: "Unscheduled task placed in the first open slot."
        }
      ]
    });
    expect((await domain.planner.listScheduledTaskBlocks({
      start: "2026-05-22T00:00:00.000Z",
      end: "2026-05-23T00:00:00.000Z",
      limit: 20
    })).items).toEqual([]);

    const applied = await domain.planner.smartReschedule({
      date: "2026-05-22",
      calendarId: "acct-1:calendar:product",
      workingHours: { start: 9, end: 12 },
      capacityMinutes: 60,
      apply: true
    });

    expect(applied.applied).toBe(true);
    expect(applied.appliedBlocks).toEqual([
      expect.objectContaining({
        taskId: "acct-1:task:inbox:task-1",
        startsAt: "2026-05-22T09:00:00.000Z",
        endsAt: "2026-05-22T09:30:00.000Z"
      })
    ]);
    expect(await domain.undo.status()).toMatchObject({ canUndo: true, undoLabel: "Smart reschedule" });

    await domain.undo.undo();
    expect((await domain.planner.listScheduledTaskBlocks({
      start: "2026-05-22T00:00:00.000Z",
      end: "2026-05-23T00:00:00.000Z",
      limit: 20
    })).items).toEqual([]);
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

  it("splits a recurring event for future-scoped edits", async () => {
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

    const before = await domain.planner.listCalendarEvents({
      calendarIds: ["acct-1:calendar:product"],
      start: "2026-05-22T00:00:00.000Z",
      end: "2026-05-25T00:00:00.000Z",
      limit: 20
    });
    const second = before.items.find((event) => event.startsAt === "2026-05-23T08:00:00.000Z");

    expect(second).toBeDefined();

    const updated = await domain.planner.updateCalendarEvent({
      id: second?.id ?? "",
      scope: "seriesFuture",
      title: "Future planning"
    });
    const after = await domain.planner.listCalendarEvents({
      calendarIds: ["acct-1:calendar:product"],
      start: "2026-05-22T00:00:00.000Z",
      end: "2026-05-25T00:00:00.000Z",
      limit: 20
    });
    const mutationRows = testConnection().query<{ operation: string }>(
      `SELECT operation
       FROM google_pending_mutations
       WHERE resource_type = 'event'
       ORDER BY created_at ASC, id ASC;`
    );

    expect(updated.title).toBe("Future planning");
    expect(after.items.filter((event) => event.title === "Daily planning")).toHaveLength(1);
    expect(after.items.filter((event) => event.title === "Future planning")).toHaveLength(2);
    expect(mutationRows.map((row) => row.operation).sort()).toEqual([
      "calendar.events.create",
      "calendar.events.update",
    ]);
  });

  it("fails clearly when future-scoped recurrence writes target an occurrence without its master", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    syncRepository.writeCalendarEvents(
      "acct-1",
      "product",
      [
        {
          id: "event-daily-root_20260523",
          calendarId: "product",
          recurringEventId: "event-daily-root",
          originalStartAt: "2026-05-23T08:00:00.000Z",
          status: "confirmed",
          summary: "Daily planning",
          startAt: "2026-05-23T08:00:00.000Z",
          endAt: "2026-05-23T08:30:00.000Z",
          isAllDay: false,
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
      start: "2026-05-23T00:00:00.000Z",
      end: "2026-05-24T00:00:00.000Z",
      limit: 20
    });
    const occurrence = events.items.find((event) => event.recurringEventId === "event-daily-root");

    expect(occurrence).toBeDefined();
    expect(() =>
      domain.planner.updateCalendarEvent({
        id: occurrence?.id ?? "",
        scope: "seriesFuture",
        title: "Future planning"
      })
    ).toThrow("This future-series edit needs the original recurring event. Sync calendar data, open the whole series, then try again.");
    expect(() =>
      domain.planner.deleteCalendarEvent({
        id: occurrence?.id ?? "",
        scope: "seriesFuture"
      })
    ).toThrow("This future-series delete needs the original recurring event. Sync calendar data, open the whole series, then try again.");
  });

  it("fails fast for occurrence edits on locally materialized recurrence instances", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const created = await domain.planner.createCalendarEvent({
      title: "Unsynced recurring planning",
      calendarId: "acct-1:calendar:product",
      startsAt: "2026-05-22T08:00:00.000Z",
      endsAt: "2026-05-22T08:30:00.000Z",
      recurrence: {
        frequency: "daily",
        interval: 1,
        count: 2,
        endsOn: null
      }
    });
    const events = await domain.planner.listCalendarEvents({
      calendarIds: ["acct-1:calendar:product"],
      start: "2026-05-22T00:00:00.000Z",
      end: "2026-05-24T00:00:00.000Z",
      limit: 20
    });
    const second = events.items.find((event) =>
      event.eventId === created.id && event.startsAt === "2026-05-23T08:00:00.000Z"
    );

    expect(second).toBeDefined();
    expect(() =>
      domain.planner.updateCalendarEvent({
        id: second?.id ?? "",
        scope: "occurrence",
        title: "Only one"
      })
    ).toThrow("Recurring event occurrence/future edits are not supported yet");
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

  it("reapplies auto tags across cached tasks through one undo entry", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const createdAt = "2026-06-06T00:00:00.000Z";

    await domain.settings.update({
      autoTagRules: [{
        id: "auto-draft",
        name: "Draft",
        enabled: true,
        targetKinds: ["task"],
        matchField: "title",
        matchType: "prefix",
        pattern: "Draft",
        tags: ["draft"],
        stripMatchedPrefix: false,
        eventColorId: null,
        overrideExistingEventColor: false,
        createdAt,
        updatedAt: createdAt
      }]
    });

    const preview = await domain.planner.previewAutoTagReapply({ kind: "task", scope: "all" });
    expect(preview).toMatchObject({ kind: "task", blocked: false, changed: 1 });

    const applied = await domain.planner.applyAutoTagReapply({ kind: "task", scope: "all", confirm: true });
    expect(applied).toMatchObject({ changed: 1, queued: true, undoLabel: "Auto-tag reapply" });
    expect((await domain.planner.getTask({ id: "acct-1:task:inbox:task-1" })).tags).toEqual(["draft"]);
    expect(await domain.undo.status()).toMatchObject({ canUndo: true, undoLabel: "Auto-tag reapply" });

    await domain.undo.undo();
    expect((await domain.planner.getTask({ id: "acct-1:task:inbox:task-1" })).tags).toEqual([]);
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

  it("maintains first-class tag catalog CRUD, merge, and bulk apply", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const task = await domain.planner.createTask({
      title: "Tagged task",
      notes: "",
      dueDate: "2026-05-22",
      listId: "acct-1:task-list:inbox",
      tags: ["ops"]
    });
    const note = await domain.planner.createNote({
      title: "Tagged note",
      body: "",
      listId: "acct-1:task-list:inbox",
      tags: ["ideas"]
    });
    const event = await domain.planner.createCalendarEvent({
      title: "Tagged event",
      calendarId: "acct-1:calendar:product",
      startsAt: "2026-05-22T11:00:00.000Z",
      endsAt: "2026-05-22T12:00:00.000Z",
      tags: ["ops"]
    });

    const listed = await domain.planner.listTags({ limit: 100 });
    const ops = listed.items.find((tag) => tag.name === "ops");
    expect(ops).toMatchObject({ taskCount: 1, eventCount: 1, noteCount: 0, totalCount: 2 });
    expect(listed.items.find((tag) => tag.name === "ideas")).toMatchObject({ noteCount: 1 });

    const created = await domain.planner.createTag({ name: "focus", color: "#123456" });
    const focusId = created.tag?.id ?? created.id;
    await domain.planner.bulkApplyTags({
      tagIds: [focusId],
      entityKind: "task",
      entityIds: [task.id],
      mode: "add"
    });
    expect((await domain.planner.getTask({ id: task.id })).tags).toEqual(["ops", "focus"]);

    const renamed = await domain.planner.updateTag({ id: focusId, name: "deep focus", color: "#654321" });
    expect(renamed.tag).toMatchObject({ name: "deep focus", color: "#654321" });
    expect((await domain.planner.getTask({ id: task.id })).tags).toEqual(["ops", "deep focus"]);

    await domain.planner.mergeTags({ sourceId: renamed.tag?.id ?? focusId, targetId: ops!.id });
    expect((await domain.planner.getTask({ id: task.id })).tags).toEqual(["ops"]);

    await domain.planner.deleteTag({ id: ops!.id });
    expect((await domain.planner.getTask({ id: task.id })).tags).toEqual([]);
    expect((await domain.planner.getCalendarEvent({ id: event.id })).tags).toEqual([]);
    expect((await domain.planner.getNote({ id: note.id })).tags).toEqual(["ideas"]);
  });

  it("coalesces bulk tag writes into one undo entry across tasks", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const second = await domain.planner.createTask({
      title: "Second tagged task",
      notes: "",
      dueDate: "2026-05-22",
      listId: "acct-1:task-list:inbox"
    });
    const tag = await domain.planner.createTag({ name: "focus", color: "#123456" });
    const taskIds = ["acct-1:task:inbox:task-1", second.id];

    await domain.planner.bulkApplyTags({
      tagIds: [tag.id],
      entityKind: "task",
      entityIds: taskIds,
      mode: "add"
    });

    const rows = testConnection().query<{
      actionKind: string;
      label: string;
      resourceKind: string;
      resourceId: string | null;
      undoPayloadJson: string;
    }>(
      `SELECT action_kind AS actionKind,
              label,
              resource_kind AS resourceKind,
              resource_id AS resourceId,
              undo_payload_json AS undoPayloadJson
       FROM local_undo_entries
       WHERE action_kind = 'tag.bulk_apply'
       ORDER BY created_at DESC, id DESC
       LIMIT 1;`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      label: "Bulk apply tags",
      resourceKind: "bulk",
      resourceId: "tags:task"
    });
    expect(JSON.parse(rows[0]!.undoPayloadJson)).toMatchObject({
      version: 2,
      resourceKind: "bulk",
      changes: expect.arrayContaining([
        expect.objectContaining({ resourceId: taskIds[0] }),
        expect.objectContaining({ resourceId: taskIds[1] })
      ])
    });
    expect((await domain.planner.getTask({ id: taskIds[0] })).tags).toContain("focus");
    expect((await domain.planner.getTask({ id: taskIds[1] })).tags).toContain("focus");

    await domain.undo.undo();
    expect((await domain.planner.getTask({ id: taskIds[0] })).tags).toEqual([]);
    expect((await domain.planner.getTask({ id: taskIds[1] })).tags).toEqual([]);

    await domain.undo.redo();
    expect((await domain.planner.getTask({ id: taskIds[0] })).tags).toEqual(["focus"]);
    expect((await domain.planner.getTask({ id: taskIds[1] })).tags).toEqual(["focus"]);
  });

  it("merges duplicate tasks through the domain and restores both rows through grouped undo", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const winnerId = "acct-1:task:inbox:task-1";
    const loser = await domain.planner.createTask({
      title: "Draft inbox triage rules",
      notes: "Duplicate note",
      dueDate: "2026-05-22",
      listId: "acct-1:task-list:inbox",
      priority: "high",
      durationMinutes: 45,
      tags: ["dup"]
    });

    await domain.planner.updateTask({ id: winnerId, title: "Draft inbox triage rules" });
    await domain.planner.updateTask({ id: loser.id, title: "Draft inbox triage rules" });

    const result = await domain.planner.cleanupDuplicates({
      kind: "task",
      winnerId,
      loserIds: [loser.id]
    });
    const duplicateMutations = testConnection().query<{
      resourceId: string;
      operation: string;
      status: string;
      payloadJson: string;
    }>(
      `SELECT resource_id AS resourceId,
              operation,
              status,
              payload_json AS payloadJson
       FROM google_pending_mutations
       WHERE resource_id IN (?, ?)
       ORDER BY created_at ASC, id ASC;`,
      [winnerId, loser.id]
    ).map((row) => ({ ...row, payload: JSON.parse(row.payloadJson) as Record<string, unknown> }));
    const winnerUpdates = duplicateMutations.filter((row) =>
      row.resourceId === winnerId &&
      row.operation === "task.update"
    );
    const loserUpdate = duplicateMutations.find((row) =>
      row.resourceId === loser.id &&
      row.operation === "task.update"
    );
    const loserDelete = duplicateMutations.find((row) =>
      row.resourceId === loser.id &&
      row.operation === "task.delete"
    );

    expect(result).toMatchObject({ id: winnerId, kind: "task", loserIds: [loser.id], queued: true });
    expect(await domain.planner.getTask({ id: winnerId })).toMatchObject({
      notes: "Local search should find task notes.\n\n--- merged duplicate ---\n\nDuplicate note",
      priority: "high",
      durationMinutes: 45,
      tags: ["dup"]
    });
    expect(() => domain.planner.getTask({ id: loser.id })).toThrow("Task was not found.");
    expect(await domain.undo.status()).toMatchObject({
      canUndo: true,
      undoLabel: "Merge duplicate group"
    });
    expect(winnerUpdates.map((row) => row.status)).toEqual(["cancelled", "pending"]);
    expect(winnerUpdates[0]?.payload).toMatchObject({
      cleanupKind: "task",
      cleanupCompacted: true
    });
    expect(loserUpdate).toMatchObject({ status: "cancelled" });
    expect(loserUpdate?.payload).toMatchObject({
      cleanupKind: "task",
      cleanupWinnerId: winnerId,
      cleanupCompacted: true
    });
    expect(loserDelete).toMatchObject({ status: "pending" });
    expect(loserDelete?.payload).toMatchObject({
      cleanupKind: "task",
      cleanupWinnerId: winnerId,
      cleanupLoserIds: [loser.id]
    });
    expect(
      syncRepository.listActivePendingMutations({ limit: 50 })
        .filter((mutation) => [winnerId, loser.id].includes(mutation.resourceId))
        .map((mutation) => mutation.payload as Record<string, unknown>)
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cleanupKind: "task",
        cleanupWinnerId: winnerId,
        cleanupLoserIds: [loser.id]
      })
    ]));

    await domain.undo.undo();
    expect(await domain.planner.getTask({ id: winnerId })).toMatchObject({
      notes: "Local search should find task notes.",
      priority: "none",
      durationMinutes: null,
      tags: []
    });
    expect(await domain.planner.getTask({ id: loser.id })).toMatchObject({
      notes: "Duplicate note",
      priority: "high",
      durationMinutes: 45,
      tags: ["dup"]
    });
  });

  it("compacts duplicate cleanup mutations for events and restores through grouped undo", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const events = await domain.planner.listCalendarEvents({
      calendarIds: ["acct-1:calendar:product"],
      start: "2026-05-22T00:00:00.000Z",
      end: "2026-05-23T00:00:00.000Z",
      limit: 20
    });
    const winnerId = events.items.find((event) => event.title === "Planner shell standup")?.id ?? "";
    const loser = await domain.planner.createCalendarEvent({
      title: "Planner shell standup",
      calendarId: "acct-1:calendar:product",
      startsAt: "2026-05-22T09:30:00.000Z",
      endsAt: "2026-05-22T09:50:00.000Z",
      notes: "Duplicate event note",
      guestEmails: ["dup@example.com"],
      reminderMinutes: [5],
      tags: ["event-dup"],
      colorId: "5"
    });

    await domain.planner.updateCalendarEvent({ id: winnerId, notes: "Review cache-first startup." });
    await domain.planner.updateCalendarEvent({ id: loser.id, notes: "Duplicate event note revised" });

    const result = await domain.planner.cleanupDuplicates({
      kind: "event",
      winnerId,
      loserIds: [loser.id]
    });
    const duplicateMutations = testConnection().query<{
      resourceId: string;
      operation: string;
      status: string;
      payloadJson: string;
    }>(
      `SELECT resource_id AS resourceId,
              operation,
              status,
              payload_json AS payloadJson
       FROM google_pending_mutations
       WHERE resource_id IN (?, ?)
       ORDER BY created_at ASC, id ASC;`,
      [winnerId, loser.id]
    ).map((row) => ({ ...row, payload: JSON.parse(row.payloadJson) as Record<string, unknown> }));
    const winnerUpdates = duplicateMutations.filter((row) =>
      row.resourceId === winnerId &&
      row.operation === "calendar.events.update"
    );
    const loserUpdate = duplicateMutations.find((row) =>
      row.resourceId === loser.id &&
      row.operation === "calendar.events.update"
    );
    const loserDelete = duplicateMutations.find((row) =>
      row.resourceId === loser.id &&
      row.operation === "calendar.events.delete"
    );

    expect(result).toMatchObject({ id: winnerId, kind: "event", loserIds: [loser.id], queued: true });
    expect(await domain.planner.getCalendarEvent({ id: winnerId })).toMatchObject({
      notes: "Review cache-first startup.\n\n--- merged duplicate ---\n\nDuplicate event note revised",
      guestEmails: ["dup@example.com"],
      reminderMinutes: [5],
      tags: ["event-dup"],
      colorId: "5"
    });
    expect(() => domain.planner.getCalendarEvent({ id: loser.id })).toThrow("Calendar event was not found.");
    expect(winnerUpdates.map((row) => row.status)).toEqual(["cancelled", "pending"]);
    expect(winnerUpdates[0]?.payload).toMatchObject({
      cleanupKind: "event",
      cleanupCompacted: true
    });
    expect(loserUpdate).toMatchObject({ status: "cancelled" });
    expect(loserUpdate?.payload).toMatchObject({
      cleanupKind: "event",
      cleanupWinnerId: winnerId,
      cleanupCompacted: true
    });
    expect(loserDelete).toMatchObject({ status: "pending" });
    expect(loserDelete?.payload).toMatchObject({
      cleanupKind: "event",
      cleanupWinnerId: winnerId,
      cleanupLoserIds: [loser.id]
    });

    await domain.undo.undo();
    expect(await domain.planner.getCalendarEvent({ id: winnerId })).toMatchObject({
      notes: "Review cache-first startup.",
      tags: []
    });
    expect(await domain.planner.getCalendarEvent({ id: loser.id })).toMatchObject({
      notes: "Duplicate event note revised",
      tags: ["event-dup"]
    });
  });

  it("compacts duplicate cleanup mutations for notes and restores through grouped undo", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    const winner = await domain.planner.createNote({
      title: "Duplicate note",
      body: "Winner note body",
      tags: ["winner"]
    });
    const loser = await domain.planner.createNote({
      title: "Duplicate note",
      body: "Loser note body",
      tags: ["loser"]
    });

    await domain.planner.updateNote({ id: winner.id, body: "Winner note body" });
    await domain.planner.updateNote({ id: loser.id, body: "Loser note body revised" });
    syncRepository.enqueuePendingMutation({
      accountId: "acct-1",
      resourceType: "task",
      resourceId: loser.id,
      operation: "task.update",
      payload: { id: loser.id, fixture: "stale-note-update" },
      now
    });

    const result = await domain.planner.cleanupDuplicates({
      kind: "note",
      winnerId: winner.id,
      loserIds: [loser.id]
    });
    const duplicateMutations = testConnection().query<{
      resourceId: string;
      operation: string;
      status: string;
      payloadJson: string;
    }>(
      `SELECT resource_id AS resourceId,
              operation,
              status,
              payload_json AS payloadJson
       FROM google_pending_mutations
       WHERE resource_id IN (?, ?)
       ORDER BY created_at ASC, id ASC;`,
      [winner.id, loser.id]
    ).map((row) => ({ ...row, payload: JSON.parse(row.payloadJson) as Record<string, unknown> }));
    const loserUpdate = duplicateMutations.find((row) =>
      row.resourceId === loser.id &&
      row.operation === "task.update"
    );
    const loserDelete = duplicateMutations.find((row) =>
      row.resourceId === loser.id &&
      row.operation === "task.delete"
    );

    expect(result).toMatchObject({ id: winner.id, kind: "note", loserIds: [loser.id], queued: true });
    expect(await domain.planner.getNote({ id: winner.id })).toMatchObject({
      body: "Winner note body\n\n--- merged duplicate ---\n\nLoser note body revised",
      tags: ["winner", "loser"]
    });
    expect(() => domain.planner.getNote({ id: loser.id })).toThrow("Note was not found.");
    expect(loserUpdate).toMatchObject({ status: "cancelled" });
    expect(loserUpdate?.payload).toMatchObject({
      cleanupKind: "note",
      cleanupWinnerId: winner.id,
      cleanupCompacted: true
    });
    expect(loserDelete).toMatchObject({ status: "pending" });
    expect(loserDelete?.payload).toMatchObject({
      cleanupKind: "note",
      cleanupWinnerId: winner.id,
      cleanupLoserIds: [loser.id]
    });

    await domain.undo.undo();
    expect(await domain.planner.getNote({ id: winner.id })).toMatchObject({
      body: "Winner note body",
      tags: ["winner"]
    });
    expect(await domain.planner.getNote({ id: loser.id })).toMatchObject({
      body: "Loser note body revised",
      tags: ["loser"]
    });
  });

  it("persists pending agent actions and rejects them through the tray service", async () => {
    const { domain, agentRepository } = createTestServices();
    const id = agentRepository.create({
      toolName: "planner.create_task",
      argumentsObject: { title: "Agent task" },
      preview: { message: "Create task", title: "Agent task" },
      permissionMode: "confirm-writes",
      credentialRevision: "rev-1",
      clientKey: "cli",
      createdAt: now,
      expiresAt: "2099-05-23T00:00:00.000Z"
    });

    expect(await domain.agent.listActions({ statuses: ["pending"], limit: 10 })).toMatchObject({
      items: [
        expect.objectContaining({
          id,
          status: "pending",
          toolName: "planner.create_task"
        })
      ]
    });

    const rejected = await domain.agent.rejectAction({ id });
    expect(rejected.action).toMatchObject({ id, status: "rejected" });
    expect((await domain.agent.listActions({ statuses: ["pending"], limit: 10 })).items).toEqual([]);
    expect((await domain.agent.listActions({ statuses: ["rejected"], limit: 10 })).items).toEqual([
      expect.objectContaining({ id, status: "rejected" })
    ]);
  });

  it("validates webhook endpoints and stores loopback subscriptions", async () => {
    const { domain } = createTestServices();

    expect(() => domain.webhooks.upsert({
      url: "https://example.com/hcb",
      events: ["sync.completed"],
      enabled: true
    })).toThrow("Webhook URL must target localhost or 127.0.0.1.");

    const created = await domain.webhooks.upsert({
      url: "http://127.0.0.1:49321/hcb",
      events: ["sync.completed", "task.created"],
      enabled: true,
      includePrivateBodies: false
    });
    expect(created.subscription).toMatchObject({
      url: "http://127.0.0.1:49321/hcb",
      events: ["sync.completed", "task.created"],
      enabled: true,
      includePrivateBodies: false
    });
    expect((await domain.webhooks.list({ limit: 10 })).items).toEqual([
      expect.objectContaining({ id: created.id })
    ]);

    await domain.webhooks.delete({ id: created.id });
    expect((await domain.webhooks.list({ limit: 10 })).items).toEqual([]);
  });

  it("indexes local semantic search", async () => {
    const { domain, syncRepository } = createTestServices();
    seedGoogleMirrors(syncRepository);
    await domain.planner.createNote({
      title: "Cache-first startup",
      body: "Renderer should paint from SQLite before fresh sync completes."
    });

    const disabled = await domain.planner.search({
      query: "cache startup",
      mode: "semantic",
      limit: 10
    });
    expect(disabled.diagnostics).toMatchObject({
      mode: "semantic",
      semanticEnabled: false,
      fallbackReason: "semantic-disabled"
    });

    await domain.settings.update({ semanticSearchEnabled: true });

    const semantic = await domain.planner.search({
      query: "cache startup",
      mode: "semantic",
      limit: 10
    });
    expect(semantic.diagnostics).toMatchObject({
      mode: "semantic",
      semanticEnabled: true,
      modelId: "hcb-local-hash-384"
    });
    expect(semantic.diagnostics?.indexedCount ?? 0).toBeGreaterThan(0);
    expect(semantic.items.length).toBeGreaterThan(0);

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
