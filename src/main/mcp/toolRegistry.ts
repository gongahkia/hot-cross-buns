import { McpConfirmationStore } from "./confirmationStore";
import { HcbPublicError } from "@shared/ipc/result";
import type { McpAdminDomainServices, McpDomainServices } from "./domainServices";
import { McpToolError } from "./errors";
import type {
  JsonObject,
  JsonValue,
  McpToolCallContext,
  McpToolDefinition,
  McpToolResponse,
  PublicMcpToolDefinition
} from "./types";

interface WriteHandler {
  preview: (argumentsObject: Record<string, unknown>) => Promise<JsonObject> | JsonObject;
  apply: (argumentsObject: Record<string, unknown>) => Promise<JsonObject> | JsonObject;
}

type ConvertItemKind = "event" | "task" | "note";
type ConvertSourceAction = "keep" | "replace";

const readToolNames = [
  "hcb_doctor",
  "hcb_status",
  "hcb_log",
  "hcb_diff",
  "hcb_show",
  "hcb_search",
  "hcb_today",
  "hcb_week",
  "hcb_brief",
  "hcb_plan",
  "hcb_tail",
  "hcb_get_task",
  "hcb_get_event",
  "hcb_get_note",
  "hcb_list_task_lists",
  "hcb_list_note_lists",
  "hcb_list_calendars",
  "hcb_undo_status",
  "hcb_pending_mutations",
  "hcb_backend_status",
  "hcb_hoster_status",
  "hcb_hoster_test"
] as const;

const writeToolNames = [
  "hcb_sync_now",
  "hcb_retry_mutation",
  "hcb_cancel_mutation",
  "hcb_create_task",
  "hcb_create_note",
  "hcb_create_event",
  "hcb_create_task_list",
  "hcb_create_note_list",
  "hcb_rename_task_list",
  "hcb_rename_note_list",
  "hcb_update_task",
  "hcb_update_note",
  "hcb_update_event",
  "hcb_convert_item",
  "hcb_complete_task",
  "hcb_reopen_task",
  "hcb_complete_event",
  "hcb_reopen_event",
  "hcb_move_task",
  "hcb_schedule_task_block",
  "hcb_settings_update",
  "hcb_backend_set",
  "hcb_vault_export",
  "hcb_vault_import",
  "hcb_google_save_oauth_client",
  "hcb_google_begin_oauth",
  "hcb_mcp_set_enabled",
  "hcb_hoster_create",
  "hcb_hoster_export",
  "hcb_hoster_import",
  "hcb_hoster_remove",
  "hcb_delete_task",
  "hcb_delete_note",
  "hcb_delete_event",
  "hcb_delete_task_list",
  "hcb_delete_note_list",
  "hcb_undo",
  "hcb_redo"
] as const;

const destructiveToolNames = new Set<string>([
  "hcb_delete_task",
  "hcb_delete_note",
  "hcb_delete_event",
  "hcb_delete_task_list",
  "hcb_delete_note_list",
  "hcb_convert_item",
  "hcb_cancel_mutation",
  "hcb_vault_import",
  "hcb_hoster_remove",
  "hcb_undo",
  "hcb_redo"
]);

export const MCP_READ_TOOL_NAMES = new Set<string>(readToolNames);
export const MCP_WRITE_TOOL_NAMES = new Set<string>(writeToolNames);
export const MCP_DESTRUCTIVE_TOOL_NAMES = destructiveToolNames;

export const mcpToolDefinitions: readonly McpToolDefinition[] = [
  readTool("hcb_doctor", "Run read-only HCB diagnostics and return agent-friendly findings.", {
    logLimit: integerSchema("Maximum recent log entries to inspect."),
    mutationLimit: integerSchema("Maximum pending mutations to inspect.")
  }),
  readTool("hcb_status", "Read Git-like HCB status for account, sync, cache, pending writes, and MCP state.", {}),
  readTool("hcb_log", "Read recent sanitized HCB logs.", {
    limit: integerSchema("Maximum log entry count."),
    level: enumSchema(["debug", "info", "warn", "error"])
  }),
  readTool("hcb_diff", "Read pending local-to-Google mutations. This is not a remote content diff.", {
    limit: integerSchema("Maximum pending mutation count.")
  }),
  readTool("hcb_show", "Read one HCB object or diagnostics snapshot.", {
    kind: enumSchema(["task", "event", "note", "mutation", "diagnostics"]),
    id: stringSchema("Object id. Required for task, event, note, and mutation.")
  }, ["kind"]),
  readTool("hcb_search", "Search tasks, notes, events, lists, and calendars.", {
    query: stringSchema("Search or fuzzy query."),
    scope: enumSchema(["all", "tasks", "notes", "events", "lists", "calendars"]),
    limit: integerSchema("Maximum result count.")
  }, ["query"]),
  readTool("hcb_today", "Read today's due tasks, notes, and scheduled events.", {}),
  readTool("hcb_week", "Read the agenda for a seven-day window.", {
    startDate: stringSchema("Optional ISO-8601 date or date-time. Defaults to today.")
  }),
  readTool("hcb_brief", "Read a compact planner brief for agents: status, today counts, and pending action signals.", {
    mutationLimit: integerSchema("Maximum pending mutations to include.")
  }),
  readTool("hcb_plan", "Read an agent planning summary for today plus a seven-day window.", {
    startDate: stringSchema("Optional ISO-8601 date or date-time. Defaults to today.")
  }),
  readTool("hcb_tail", "Read recent sanitized HCB logs as an agent tail.", {
    limit: integerSchema("Maximum log entry count."),
    level: enumSchema(["debug", "info", "warn", "error"])
  }),
  readTool("hcb_get_task", "Read one task by id.", {
    id: stringSchema("Task id.")
  }, ["id"]),
  readTool("hcb_get_event", "Read one event by id.", {
    id: stringSchema("Event id.")
  }, ["id"]),
  readTool("hcb_get_note", "Read one HCB note by id.", {
    id: stringSchema("Note id.")
  }, ["id"]),
  readTool("hcb_list_task_lists", "List available Google Tasks lists.", {}),
  readTool("hcb_list_note_lists", "List task-backed HCB note lists.", {}),
  readTool("hcb_list_calendars", "List available Google calendars.", {}),
  readTool("hcb_undo_status", "Read current undo and redo availability.", {}),
  readTool("hcb_pending_mutations", "List pending local-to-Google mutation queue entries.", {
    limit: integerSchema("Maximum pending mutation count.")
  }),
  readTool("hcb_backend_status", "Read current HCB storage backend and local vault settings.", {}),
  readTool("hcb_hoster_status", "Read local hoster status and configured profiles.", {}),
  readTool("hcb_hoster_test", "Run a local hoster signal encryption round-trip.", {
    id: stringSchema("Optional hoster profile id."),
    privatePayload: booleanSchema("Whether to test private payload encryption.")
  }),
  writeTool("hcb_sync_now", "Run Google sync now for tasks, calendar, or both.", false, {
    resources: arraySchema("Optional resources to sync: tasks, calendar."),
    full: booleanSchema("Whether to force a full read sync."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }),
  writeTool("hcb_retry_mutation", "Retry a failed or paused pending mutation.", false, {
    id: stringSchema("Pending mutation id."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id"]),
  writeTool("hcb_cancel_mutation", "Cancel a pending mutation. Always requires confirmation.", true, {
    id: stringSchema("Pending mutation id."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id"]),
  writeTool("hcb_create_task", "Create a dated task.", false, {
    title: stringSchema("Task title."),
    notes: stringSchema("Optional task notes."),
    dueDate: stringSchema("Optional ISO-8601 due date."),
    taskListId: stringSchema("Optional task list id."),
    parentId: stringSchema("Optional parent task id."),
    previousSiblingId: stringSchema("Optional previous sibling task id."),
    priority: enumSchema(["none", "low", "medium", "high"]),
    plannedStart: stringSchema("Optional ISO-8601 planned start date-time."),
    plannedEnd: stringSchema("Optional ISO-8601 planned end date-time."),
    durationMinutes: integerSchema("Optional task duration in minutes."),
    lockedSchedule: booleanSchema("Whether schedule placement is locked."),
    snoozeUntil: stringSchema("Optional ISO-8601 snooze-until date-time."),
    tags: arraySchema("Optional task tags."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["title"]),
  writeTool("hcb_create_note", "Create an HCB note.", false, {
    title: stringSchema("Note title."),
    body: stringSchema("Optional note body."),
    tags: arraySchema("Optional note tags."),
    linkedTaskId: stringSchema("Optional linked task id."),
    linkedEventId: stringSchema("Optional linked event id."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["title"]),
  writeTool("hcb_create_event", "Create a calendar event.", false, {
    title: stringSchema("Event title."),
    details: stringSchema("Optional event details."),
    startDate: stringSchema("ISO-8601 start date or date-time."),
    endDate: stringSchema("Optional ISO-8601 end date or date-time."),
    isAllDay: booleanSchema("Whether this is an all-day event."),
    location: stringSchema("Optional location."),
    calendarId: stringSchema("Optional calendar id."),
    guestEmails: arraySchema("Optional guest email list."),
    reminderMinutes: arraySchema("Optional reminder minute offsets."),
    tags: arraySchema("Optional local HCB event tags."),
    colorId: stringSchema("Optional Google Calendar color id."),
    recurrence: objectSchema("Optional recurrence object."),
    timeZone: stringSchema("Optional IANA time zone."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["title", "startDate"]),
  writeTool("hcb_create_task_list", "Create a Google Tasks list.", false, {
    title: stringSchema("Task list title."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["title"]),
  writeTool("hcb_create_note_list", "Create a task-backed HCB note list.", false, {
    title: stringSchema("Note list title."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["title"]),
  writeTool("hcb_rename_task_list", "Rename a Google Tasks list.", false, {
    id: stringSchema("Task list id."),
    title: stringSchema("New task list title."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id", "title"]),
  writeTool("hcb_rename_note_list", "Rename a task-backed HCB note list.", false, {
    id: stringSchema("Note list id."),
    title: stringSchema("New note list title."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id", "title"]),
  writeTool("hcb_update_task", "Update task fields.", false, {
    id: stringSchema("Task id."),
    patch: objectSchema("Fields: title, notes, dueDate, taskListId, parentId, previousSiblingId, priority, plannedStart, plannedEnd, durationMinutes, lockedSchedule, snoozeUntil, tags."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id", "patch"]),
  writeTool("hcb_update_note", "Update HCB note fields.", false, {
    id: stringSchema("Note id."),
    patch: objectSchema("Fields: title, body, noteListId, tags."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id", "patch"]),
  writeTool("hcb_update_event", "Update event fields.", false, {
    id: stringSchema("Event id."),
    patch: objectSchema("Fields: title, details, startDate, endDate, isAllDay, location, calendarId, guestEmails, reminderMinutes, tags, colorId, recurrence, timeZone."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id", "patch"]),
  writeTool("hcb_convert_item", "Convert an event, task, or note into another primitive. Always requires confirmation.", true, {
    sourceKind: enumSchema(["event", "task", "note"]),
    sourceId: stringSchema("Source item id."),
    targetKind: enumSchema(["event", "task", "note"]),
    sourceAction: enumSchema(["keep", "replace"]),
    title: stringSchema("Optional target title override."),
    notes: stringSchema("Optional target notes override."),
    body: stringSchema("Optional target body override."),
    details: stringSchema("Optional target event details override."),
    dueDate: stringSchema("Optional target task due date."),
    taskListId: stringSchema("Optional target task list id."),
    noteListId: stringSchema("Optional target note list id."),
    calendarId: stringSchema("Optional target calendar id."),
    startDate: stringSchema("Optional target event start date or date-time."),
    endDate: stringSchema("Optional target event end date or date-time."),
    isAllDay: booleanSchema("Whether target event is all-day."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["sourceKind", "sourceId", "targetKind", "sourceAction"]),
  writeTool("hcb_complete_task", "Mark a task complete.", false, {
    id: stringSchema("Task id."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id"]),
  writeTool("hcb_reopen_task", "Reopen a completed task.", false, {
    id: stringSchema("Task id."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id"]),
  writeTool("hcb_complete_event", "Mark an event complete in local HCB state.", false, {
    id: stringSchema("Event id."),
    scope: enumSchema(["occurrence", "seriesFuture", "seriesAll"]),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id"]),
  writeTool("hcb_reopen_event", "Reopen a locally completed event.", false, {
    id: stringSchema("Event id."),
    scope: enumSchema(["occurrence", "seriesFuture", "seriesAll"]),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id"]),
  writeTool("hcb_move_task", "Move a task to another list, parent, or sibling position.", false, {
    id: stringSchema("Task id."),
    taskListId: stringSchema("Destination task list id."),
    parentId: stringSchema("Destination parent task id, or null to clear."),
    previousSiblingId: stringSchema("Previous sibling task id, or null to move first."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id"]),
  writeTool("hcb_schedule_task_block", "Create a calendar block for a task.", false, {
    taskId: stringSchema("Task id."),
    calendarId: stringSchema("Destination calendar id."),
    startDate: stringSchema("ISO-8601 start date-time."),
    durationMinutes: integerSchema("Block duration in minutes."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["taskId", "calendarId", "startDate"]),
  writeTool("hcb_settings_update", "Update HCB settings with a validated JSON patch.", false, {
    patch: objectSchema("Settings patch."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["patch"]),
  writeTool("hcb_backend_set", "Switch HCB storage backend. hcb-local seeds local planner lists.", false, {
    backend: enumSchema(["google", "hcb-local", "hcb-hoster"]),
    endpoint: stringSchema("Optional HCB hoster endpoint URL."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["backend"]),
  writeTool("hcb_vault_export", "Export encrypted .hcbvault portable state.", false, {
    out: stringSchema("Optional output path."),
    passphrase: stringSchema("Vault passphrase."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["passphrase"]),
  writeTool("hcb_vault_import", "Import encrypted .hcbvault portable state. Always requires confirmation.", true, {
    path: stringSchema("Vault path."),
    passphrase: stringSchema("Vault passphrase."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["path", "passphrase"]),
  writeTool("hcb_google_save_oauth_client", "Save Google OAuth client configuration.", false, {
    clientId: stringSchema("Google OAuth client id."),
    clientSecret: stringSchema("Optional Google OAuth client secret."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["clientId"]),
  writeTool("hcb_google_begin_oauth", "Begin Google OAuth by opening the external browser.", false, {
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }),
  writeTool("hcb_mcp_set_enabled", "Enable or disable the local MCP server.", false, {
    enabled: booleanSchema("Whether MCP should be enabled."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["enabled"]),
  writeTool("hcb_hoster_create", "Create a local hoster profile.", false, {
    name: stringSchema("Hoster profile name."),
    capabilities: arraySchema("Optional hoster capabilities."),
    permissionMode: enumSchema(["read-only", "confirm-writes", "allow-writes"]),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["name"]),
  writeTool("hcb_hoster_export", "Export a local hoster profile as an encrypted .hcbhost package.", false, {
    id: stringSchema("Hoster profile id."),
    out: stringSchema("Output .hcbhost directory path."),
    passphrase: stringSchema("Optional passphrase for portable package key wrapping."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id", "out"]),
  writeTool("hcb_hoster_import", "Import an encrypted .hcbhost package.", false, {
    path: stringSchema("Input .hcbhost directory path."),
    passphrase: stringSchema("Optional passphrase for portable package key wrapping."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["path"]),
  writeTool("hcb_hoster_remove", "Remove a local hoster profile. Always requires confirmation.", true, {
    id: stringSchema("Hoster profile id."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id"]),
  writeTool("hcb_delete_task", "Delete a task. Always requires confirmation.", true, {
    id: stringSchema("Task id."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id"]),
  writeTool("hcb_delete_note", "Delete an HCB note. Always requires confirmation.", true, {
    id: stringSchema("Note id."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id"]),
  writeTool("hcb_delete_event", "Delete an event. Always requires confirmation.", true, {
    id: stringSchema("Event id."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id"]),
  writeTool("hcb_delete_task_list", "Delete a task list. Always requires confirmation.", true, {
    id: stringSchema("Task list id."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id"]),
  writeTool("hcb_delete_note_list", "Delete a note list. Always requires confirmation.", true, {
    id: stringSchema("Note list id."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id"]),
  writeTool("hcb_undo", "Undo the latest undoable planner write. Always requires confirmation.", true, {
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }),
  writeTool("hcb_redo", "Redo the latest undone planner write. Always requires confirmation.", true, {
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  })
];

export class McpToolRegistry {
  private readonly definitions = new Map<string, McpToolDefinition>();
  private readonly writeHandlers: Record<string, WriteHandler>;
  private adminServices?: McpAdminDomainServices;

  constructor(
    private readonly services: McpDomainServices,
    private readonly confirmations = new McpConfirmationStore(),
    adminServices?: McpAdminDomainServices
  ) {
    this.adminServices = adminServices;

    for (const definition of mcpToolDefinitions) {
      this.definitions.set(definition.name, definition);
    }

    this.writeHandlers = this.createWriteHandlers();
  }

  setAdminServices(services: McpAdminDomainServices): void {
    this.adminServices = services;
  }

  listTools(): PublicMcpToolDefinition[] {
    return mcpToolDefinitions.map(({ name, description, inputSchema, outputSchema, annotations }) => ({
      name,
      description,
      inputSchema,
      ...(outputSchema === undefined ? {} : { outputSchema }),
      ...(annotations === undefined ? {} : { annotations })
    }));
  }

  isWriteTool(name: string): boolean {
    return MCP_WRITE_TOOL_NAMES.has(name);
  }

  async callTool(
    name: string,
    argumentsObject: Record<string, unknown>,
    context: McpToolCallContext
  ): Promise<McpToolResponse> {
    const definition = this.definitions.get(name);

    if (!definition) {
      throw new McpToolError("UNKNOWN_TOOL", "Unknown MCP tool.");
    }

    if (definition.kind === "read") {
      return this.callReadTool(name, argumentsObject);
    }

    return this.callWriteTool(definition, argumentsObject, context);
  }

  clearConfirmations(): void {
    this.confirmations.clear();
  }

  private async callReadTool(
    name: string,
    argumentsObject: Record<string, unknown>
  ): Promise<McpToolResponse> {
    switch (name) {
      case "hcb_doctor": {
        const logLimit = optionalNumber(argumentsObject, "logLimit") ?? 20;
        const mutationLimit = optionalNumber(argumentsObject, "mutationLimit") ?? 20;
        const [status, mutations, logs, hosters] = await Promise.all([
          this.services.diagnostics.status(),
          this.services.diagnostics.diff({ limit: mutationLimit }),
          this.services.diagnostics.logs({ limit: logLimit, level: "warn" }),
          Promise.resolve(this.adminServices?.hosters.status()).catch(() => undefined)
        ]);

        return success({
          message: "Ran HCB doctor.",
          item: doctorItem(status, mutations, logs, hosters as JsonObject | undefined)
        });
      }
      case "hcb_status":
        return success({
          message: "Read HCB status.",
          item: await this.services.diagnostics.status()
        });
      case "hcb_log": {
        const items = await this.services.diagnostics.logs({
          limit: optionalNumber(argumentsObject, "limit"),
          level: optionalString(argumentsObject, "level")
        });

        return success({ message: `Read ${items.length} log entr${items.length === 1 ? "y" : "ies"}.`, items });
      }
      case "hcb_diff": {
        const items = await this.services.diagnostics.diff({
          limit: optionalNumber(argumentsObject, "limit")
        });

        return success({ message: `Read ${items.length} pending mutation${items.length === 1 ? "" : "s"}.`, items });
      }
      case "hcb_show": {
        const kind = requiredString(argumentsObject, "kind");
        const id = optionalString(argumentsObject, "id");

        if (kind === "task") {
          return success({ message: "Read task.", item: await this.services.tasks.getTask(requiredShowId(id, kind)) });
        }

        if (kind === "event") {
          return success({ message: "Read event.", item: await this.services.calendar.getEvent(requiredShowId(id, kind)) });
        }

        if (kind === "note") {
          return success({ message: "Read note.", item: await this.services.notes.getNote(requiredShowId(id, kind)) });
        }

        if (kind === "mutation" || kind === "diagnostics") {
          return success({
            message: `Read ${kind}.`,
            item: await this.services.diagnostics.show({ kind, id })
          });
        }

        throw new McpToolError("INVALID_ARGUMENTS", "Unsupported show kind.");
      }
      case "hcb_search": {
        const items = await this.services.planning.search({
          query: requiredString(argumentsObject, "query"),
          scope: optionalString(argumentsObject, "scope"),
          limit: optionalNumber(argumentsObject, "limit")
        });
        return success({ message: `Found ${items.length} result${items.length === 1 ? "" : "s"}.`, items });
      }
      case "hcb_today":
        return success({ message: "Read today's agenda.", item: await this.services.planning.today() });
      case "hcb_week":
        return success({
          message: "Read week agenda.",
          item: await this.services.planning.week({
            startDate: optionalString(argumentsObject, "startDate")
          })
        });
      case "hcb_brief": {
        const mutationLimit = optionalNumber(argumentsObject, "mutationLimit") ?? 10;
        const [status, today, mutations] = await Promise.all([
          this.services.diagnostics.status(),
          this.services.planning.today(),
          this.services.syncQueue.pendingMutations({ limit: mutationLimit })
        ]);

        return success({
          message: "Read HCB brief.",
          item: plannerBrief(status, today, mutations)
        });
      }
      case "hcb_plan": {
        const startDate = optionalString(argumentsObject, "startDate");
        const [status, today, week] = await Promise.all([
          this.services.diagnostics.status(),
          this.services.planning.today(),
          this.services.planning.week({ startDate })
        ]);

        return success({
          message: "Read HCB plan.",
          item: plannerPlan(status, today, week)
        });
      }
      case "hcb_tail": {
        const items = await this.services.diagnostics.logs({
          limit: optionalNumber(argumentsObject, "limit") ?? 50,
          level: optionalString(argumentsObject, "level")
        });

        return success({ message: `Read ${items.length} log entr${items.length === 1 ? "y" : "ies"}.`, items });
      }
      case "hcb_get_task":
        return success({
          message: "Read task.",
          item: await this.services.tasks.getTask(requiredString(argumentsObject, "id"))
        });
      case "hcb_get_event":
        return success({
          message: "Read event.",
          item: await this.services.calendar.getEvent(requiredString(argumentsObject, "id"))
        });
      case "hcb_get_note":
        return success({
          message: "Read note.",
          item: await this.services.notes.getNote(requiredString(argumentsObject, "id"))
        });
      case "hcb_list_task_lists":
        return success({
          message: "Read task lists.",
          items: await this.services.tasks.listTaskLists()
        });
      case "hcb_list_note_lists":
        return success({
          message: "Read note lists.",
          items: await this.services.notes.listNoteLists()
        });
      case "hcb_list_calendars":
        return success({
          message: "Read calendars.",
          items: await this.services.calendar.listCalendars()
        });
      case "hcb_undo_status":
        return success({
          message: "Read undo status.",
          item: await this.services.undo.status()
        });
      case "hcb_pending_mutations": {
        const items = await this.services.syncQueue.pendingMutations({
          limit: optionalNumber(argumentsObject, "limit")
        });

        return success({ message: `Read ${items.length} pending mutation${items.length === 1 ? "" : "s"}.`, items });
      }
      case "hcb_backend_status": {
        const [settings, syncStatus, taskLists, calendars] = await Promise.all([
          this.requireAdminServices().settings.get(),
          this.services.diagnostics.status(),
          this.services.tasks.listTaskLists(),
          this.services.calendar.listCalendars()
        ]);

        return success({
          message: "Read HCB backend status.",
          item: {
            kind: "hcbBackendStatus",
            storageBackend: settings.storageBackend,
            hcbHosterEndpoint: settings.hcbHosterEndpoint,
            hcbVaultPath: settings.hcbVaultPath,
            googleSyncActive: settings.storageBackend === "google",
            sync: syncStatus,
            taskListCount: taskLists.length,
            calendarCount: calendars.length
          }
        });
      }
      case "hcb_hoster_status":
        return success({
          message: "Read local hoster status.",
          item: await this.requireAdminServices().hosters.status()
        });
      case "hcb_hoster_test":
        return success({
          message: "Tested local hoster signal encryption.",
          item: await this.requireAdminServices().hosters.test({
            ...(optionalString(argumentsObject, "id") === undefined
              ? {}
              : { id: optionalString(argumentsObject, "id") }),
            ...(optionalBoolean(argumentsObject, "privatePayload") === undefined
              ? {}
              : { privatePayload: optionalBoolean(argumentsObject, "privatePayload") })
          })
        });
      default:
        throw new McpToolError("UNKNOWN_TOOL", "Unknown MCP tool.");
    }
  }

  private async callWriteTool(
    definition: McpToolDefinition,
    argumentsObject: Record<string, unknown>,
    context: McpToolCallContext
  ): Promise<McpToolResponse> {
    if (context.permissionMode === "read-only") {
      throw new McpToolError("PERMISSION_DENIED", "MCP is in read-only mode.");
    }

    const handler = this.writeHandlers[definition.name];

    if (!handler) {
      throw new McpToolError("UNKNOWN_TOOL", "Unknown MCP tool.");
    }

    const dryRun = optionalBoolean(argumentsObject, "dryRun") ?? false;
    const requiresConfirmation =
      definition.destructive || context.permissionMode === "confirm-writes";

    if (dryRun) {
      const preview = await handler.preview(argumentsObject);
      const confirmationId = requiresConfirmation
        ? this.confirmations.create({
            toolName: definition.name,
            arguments: argumentsObject,
            preview,
            permissionMode: context.permissionMode,
            credentialRevision: context.credentialRevision,
            clientKey: context.clientKey,
            now: context.now
          })
        : undefined;

      return success({
        dryRun: true,
        requiresConfirmation,
        confirmationId,
        message: requiresConfirmation
          ? "Dry-run ready. Pass confirmationId to apply."
          : "Dry-run preview.",
        item: preview
      });
    }

    const suppliedConfirmationId = requiresConfirmation
      ? optionalString(argumentsObject, "confirmationId")
      : undefined;

    if (requiresConfirmation) {
      const confirmationId = suppliedConfirmationId;

      if (!confirmationId) {
        throw new McpToolError(
          "CONFIRMATION_REQUIRED",
          "Dry-run confirmation is required before this write can apply."
        );
      }

      const matches = this.confirmations.consume(confirmationId, {
        toolName: definition.name,
        arguments: argumentsObject,
        permissionMode: context.permissionMode,
        credentialRevision: context.credentialRevision,
        clientKey: context.clientKey,
        now: context.now
      });

      if (!matches) {
        throw new McpToolError(
          "CONFIRMATION_MISMATCH",
          "Confirmation id is missing, expired, or does not match these arguments."
        );
      }
    }

    try {
      const item = await handler.apply(argumentsObject);
      if (suppliedConfirmationId) {
        this.confirmations.markApplied(suppliedConfirmationId, context.now);
      }

      return success({
        applied: true,
        message: appliedMessage(definition.name),
        item
      });
    } catch (error) {
      if (suppliedConfirmationId) {
        this.confirmations.markFailed(suppliedConfirmationId, error, context.now);
      }
      throw error;
    }
  }

  private createWriteHandlers(): Record<string, WriteHandler> {
    return {
      hcb_sync_now: {
        preview: (args) => this.services.syncQueue.previewRunNow(domainArguments(args)),
        apply: (args) => this.services.syncQueue.runNow(domainArguments(args))
      },
      hcb_retry_mutation: {
        preview: (args) => this.services.syncQueue.previewRetryMutation(requiredString(args, "id")),
        apply: (args) => this.services.syncQueue.retryMutation(requiredString(args, "id"))
      },
      hcb_cancel_mutation: {
        preview: (args) => this.services.syncQueue.previewCancelMutation(requiredString(args, "id")),
        apply: (args) => this.services.syncQueue.cancelMutation(requiredString(args, "id"))
      },
      hcb_create_task: {
        preview: (args) => this.services.tasks.previewCreateTask(domainArguments(args)),
        apply: (args) => this.services.tasks.createTask(domainArguments(args))
      },
      hcb_create_note: {
        preview: (args) => this.services.notes.previewCreateNote(domainArguments(args)),
        apply: (args) => this.services.notes.createNote(domainArguments(args))
      },
      hcb_create_event: {
        preview: (args) => this.services.calendar.previewCreateEvent(domainArguments(args)),
        apply: (args) => this.services.calendar.createEvent(domainArguments(args))
      },
      hcb_create_task_list: {
        preview: (args) => this.services.tasks.previewCreateTaskList(domainArguments(args)),
        apply: (args) => this.services.tasks.createTaskList(domainArguments(args))
      },
      hcb_create_note_list: {
        preview: (args) => this.services.notes.previewCreateNoteList(domainArguments(args)),
        apply: (args) => this.services.notes.createNoteList(domainArguments(args))
      },
      hcb_rename_task_list: {
        preview: (args) =>
          this.services.tasks.previewRenameTaskList(
            requiredString(args, "id"),
            domainArguments(args)
          ),
        apply: (args) =>
          this.services.tasks.renameTaskList(requiredString(args, "id"), domainArguments(args))
      },
      hcb_rename_note_list: {
        preview: (args) =>
          this.services.notes.previewRenameNoteList(
            requiredString(args, "id"),
            domainArguments(args)
          ),
        apply: (args) =>
          this.services.notes.renameNoteList(requiredString(args, "id"), domainArguments(args))
      },
      hcb_update_task: {
        preview: (args) =>
          this.services.tasks.previewUpdateTask(
            requiredString(args, "id"),
            requiredObject(args, "patch")
          ),
        apply: (args) =>
          this.services.tasks.updateTask(requiredString(args, "id"), requiredObject(args, "patch"))
      },
      hcb_update_note: {
        preview: (args) =>
          this.services.notes.previewUpdateNote(
            requiredString(args, "id"),
            requiredObject(args, "patch")
          ),
        apply: (args) =>
          this.services.notes.updateNote(requiredString(args, "id"), requiredObject(args, "patch"))
      },
      hcb_update_event: {
        preview: (args) =>
          this.services.calendar.previewUpdateEvent(
            requiredString(args, "id"),
            requiredObject(args, "patch")
          ),
        apply: (args) =>
          this.services.calendar.updateEvent(
            requiredString(args, "id"),
            requiredObject(args, "patch")
          )
      },
      hcb_convert_item: {
        preview: (args) => this.convertItem(args, false),
        apply: (args) => this.convertItem(args, true)
      },
      hcb_complete_task: {
        preview: (args) => this.services.tasks.previewCompleteTask(requiredString(args, "id")),
        apply: (args) => this.services.tasks.completeTask(requiredString(args, "id"))
      },
      hcb_reopen_task: {
        preview: (args) => this.services.tasks.previewReopenTask(requiredString(args, "id")),
        apply: (args) => this.services.tasks.reopenTask(requiredString(args, "id"))
      },
      hcb_complete_event: {
        preview: (args) =>
          this.services.calendar.previewCompleteEvent(requiredString(args, "id"), domainArguments(args)),
        apply: (args) =>
          this.services.calendar.completeEvent(requiredString(args, "id"), domainArguments(args))
      },
      hcb_reopen_event: {
        preview: (args) =>
          this.services.calendar.previewReopenEvent(requiredString(args, "id"), domainArguments(args)),
        apply: (args) =>
          this.services.calendar.reopenEvent(requiredString(args, "id"), domainArguments(args))
      },
      hcb_move_task: {
        preview: (args) =>
          this.services.tasks.previewMoveTask(
            requiredString(args, "id"),
            domainArguments(args)
          ),
        apply: (args) =>
          this.services.tasks.moveTask(
            requiredString(args, "id"),
            domainArguments(args)
          )
      },
      hcb_schedule_task_block: {
        preview: (args) => this.services.calendar.previewScheduleTaskBlock(domainArguments(args)),
        apply: (args) => this.services.calendar.scheduleTaskBlock(domainArguments(args))
      },
      hcb_settings_update: {
        preview: (args) => {
          const patch = requiredObject(args, "patch");
          return {
            kind: "settingsPatch",
            patchKeys: Object.keys(patch).sort()
          };
        },
        apply: async (args) => ({
          kind: "settings",
          ...(await this.requireAdminServices().settings.update(requiredObject(args, "patch")))
        })
      },
      hcb_backend_set: {
        preview: (args) => ({
          kind: "hcbBackendSettings",
          storageBackend: requiredBackend(args),
          ...(optionalString(args, "endpoint") === undefined
            ? {}
            : { hcbHosterEndpoint: optionalString(args, "endpoint") })
        }),
        apply: async (args) => ({
          kind: "hcbBackendSettings",
          ...(await this.requireAdminServices().settings.update({
            storageBackend: requiredBackend(args),
            ...(optionalString(args, "endpoint") === undefined
              ? {}
              : { hcbHosterEndpoint: optionalString(args, "endpoint") })
          }))
        })
      },
      hcb_vault_export: {
        preview: (args) => ({
          kind: "hcbVaultExport",
          ...(optionalString(args, "out") === undefined ? {} : { out: optionalString(args, "out") }),
          hasPassphrase: true
        }),
        apply: (args) => this.requireAdminServices().settings.exportHcbVault({
          ...(optionalString(args, "out") === undefined ? {} : { out: optionalString(args, "out") }),
          passphrase: requiredString(args, "passphrase")
        })
      },
      hcb_vault_import: {
        preview: (args) => ({
          kind: "hcbVaultImport",
          path: requiredString(args, "path"),
          hasPassphrase: true
        }),
        apply: (args) => this.requireAdminServices().settings.importHcbVault({
          path: requiredString(args, "path"),
          passphrase: requiredString(args, "passphrase")
        })
      },
      hcb_google_save_oauth_client: {
        preview: (args) => ({
          kind: "googleOAuthClient",
          clientId: requiredString(args, "clientId"),
          hasClientSecret: optionalString(args, "clientSecret") !== undefined
        }),
        apply: async (args) => ({
          kind: "googleStatus",
          ...(await this.requireAdminServices().google.saveOAuthClient({
            clientId: requiredString(args, "clientId"),
            ...(optionalString(args, "clientSecret") === undefined
              ? {}
              : { clientSecret: optionalString(args, "clientSecret") })
          }))
        })
      },
      hcb_google_begin_oauth: {
        preview: () => ({
          kind: "googleOAuthStart",
          opensExternalBrowser: true
        }),
        apply: async () => ({
          kind: "googleOAuthStart",
          ...(await this.requireAdminServices().google.beginOAuth())
        })
      },
      hcb_mcp_set_enabled: {
        preview: (args) => ({
          kind: "mcpSettings",
          enabled: requiredBoolean(args, "enabled")
        }),
        apply: async (args) => ({
          kind: "mcpStatus",
          ...(await this.requireAdminServices().mcp.setEnabled({
            enabled: requiredBoolean(args, "enabled")
          }))
        })
      },
      hcb_hoster_create: {
        preview: (args) => ({
          kind: "localHosterProfile",
          name: requiredString(args, "name"),
          ...(optionalHosterCapabilities(args) === undefined
            ? {}
            : { capabilities: optionalHosterCapabilities(args) }),
          permissionMode: optionalPermissionMode(args) ?? "confirm-writes"
        }),
        apply: (args) => this.requireAdminServices().hosters.create({
          name: requiredString(args, "name"),
          ...(optionalHosterCapabilities(args) === undefined
            ? {}
            : { capabilities: optionalHosterCapabilities(args) }),
          ...(optionalPermissionMode(args) === undefined
            ? {}
            : { permissionMode: optionalPermissionMode(args) })
        })
      },
      hcb_hoster_export: {
        preview: (args) => ({
          kind: "localHosterExport",
          id: requiredString(args, "id"),
          out: requiredString(args, "out"),
          hasPassphrase: optionalString(args, "passphrase") !== undefined
        }),
        apply: (args) => this.requireAdminServices().hosters.export({
          id: requiredString(args, "id"),
          out: requiredString(args, "out"),
          ...(optionalString(args, "passphrase") === undefined
            ? {}
            : { passphrase: optionalString(args, "passphrase") })
        })
      },
      hcb_hoster_import: {
        preview: (args) => ({
          kind: "localHosterImport",
          path: requiredString(args, "path"),
          hasPassphrase: optionalString(args, "passphrase") !== undefined
        }),
        apply: (args) => this.requireAdminServices().hosters.import({
          path: requiredString(args, "path"),
          ...(optionalString(args, "passphrase") === undefined
            ? {}
            : { passphrase: optionalString(args, "passphrase") })
        })
      },
      hcb_hoster_remove: {
        preview: (args) => ({
          kind: "localHosterRemove",
          id: requiredString(args, "id")
        }),
        apply: (args) => this.requireAdminServices().hosters.remove({
          id: requiredString(args, "id")
        })
      },
      hcb_delete_task: {
        preview: (args) => this.services.tasks.previewDeleteTask(requiredString(args, "id")),
        apply: (args) => this.services.tasks.deleteTask(requiredString(args, "id"))
      },
      hcb_delete_note: {
        preview: (args) => this.services.notes.previewDeleteNote(requiredString(args, "id")),
        apply: (args) => this.services.notes.deleteNote(requiredString(args, "id"))
      },
      hcb_delete_event: {
        preview: (args) => this.services.calendar.previewDeleteEvent(requiredString(args, "id")),
        apply: (args) => this.services.calendar.deleteEvent(requiredString(args, "id"))
      },
      hcb_delete_task_list: {
        preview: (args) => this.services.tasks.previewDeleteTaskList(requiredString(args, "id")),
        apply: (args) => this.services.tasks.deleteTaskList(requiredString(args, "id"))
      },
      hcb_delete_note_list: {
        preview: (args) => this.services.notes.previewDeleteNoteList(requiredString(args, "id")),
        apply: (args) => this.services.notes.deleteNoteList(requiredString(args, "id"))
      },
      hcb_undo: {
        preview: async () => undoPreview("undo", await this.services.undo.status()),
        apply: () => withMcpPublicError(() => this.services.undo.undo())
      },
      hcb_redo: {
        preview: async () => undoPreview("redo", await this.services.undo.status()),
        apply: () => withMcpPublicError(() => this.services.undo.redo())
      }
    };
  }

  private async convertItem(args: Record<string, unknown>, apply: boolean): Promise<JsonObject> {
    const sourceKind = requiredItemKind(args, "sourceKind");
    const targetKind = requiredItemKind(args, "targetKind");
    const sourceId = requiredString(args, "sourceId");
    const sourceAction = requiredSourceAction(args);

    if (sourceKind === targetKind) {
      throw new McpToolError("INVALID_ARGUMENTS", "sourceKind and targetKind must differ.");
    }

    const source = await this.readConvertSource(sourceKind, sourceId);

    if (sourceKind === "event" && optionalJsonString(source, "hcbKind") === "birthday") {
      throw new McpToolError("INVALID_ARGUMENTS", "Birthday events cannot be converted.");
    }

    const targetPayload = convertTargetPayload(sourceKind, source, targetKind, args);

    if (!apply) {
      return {
        kind: "conversion",
        source: {
          kind: sourceKind,
          id: sourceId,
          title: optionalJsonString(source, "title") ?? ""
        },
        target: {
          kind: targetKind,
          payload: targetPayload
        },
        sourceAction,
        willRemoveSource: sourceAction === "replace" && !isTaskBackedNoteReplace(sourceKind, targetKind),
        willUpdateSource: sourceAction === "replace" && isTaskBackedNoteReplace(sourceKind, targetKind)
      };
    }

    const replaceInPlace = sourceAction === "replace" && isTaskBackedNoteReplace(sourceKind, targetKind);
    const target = replaceInPlace
      ? await this.updateTaskBackedNoteConversion(sourceKind, targetKind, sourceId, targetPayload)
      : await this.createConvertTarget(targetKind, targetPayload);
    const removedSource =
      sourceAction === "replace" && !replaceInPlace
        ? await this.removeConvertSource(sourceKind, sourceId)
        : null;

    return {
      kind: "conversion",
      source: {
        kind: sourceKind,
        id: sourceId,
        action: sourceAction,
        removed: removedSource
      },
      target: {
        kind: targetKind,
        item: target
      }
    };
  }

  private readConvertSource(kind: ConvertItemKind, id: string): Promise<JsonObject> | JsonObject {
    if (kind === "task") {
      return this.services.tasks.getTask(id);
    }

    if (kind === "note") {
      return this.services.notes.getNote(id);
    }

    return this.services.calendar.getEvent(id);
  }

  private createConvertTarget(kind: ConvertItemKind, payload: JsonObject): Promise<JsonObject> | JsonObject {
    if (kind === "task") {
      return this.services.tasks.createTask(payload);
    }

    if (kind === "note") {
      return this.services.notes.createNote(payload);
    }

    return this.services.calendar.createEvent(payload);
  }

  private updateTaskBackedNoteConversion(
    sourceKind: ConvertItemKind,
    targetKind: ConvertItemKind,
    sourceId: string,
    payload: JsonObject
  ): Promise<JsonObject> | JsonObject {
    if (sourceKind === "task" && targetKind === "note") {
      return this.services.notes.updateNote(sourceId, payload);
    }

    throw new McpToolError("INVALID_ARGUMENTS", "Only task-to-note conversions can update in place.");
  }

  private removeConvertSource(kind: ConvertItemKind, id: string): Promise<JsonObject> | JsonObject {
    if (kind === "task") {
      return this.services.tasks.deleteTask(id);
    }

    if (kind === "note") {
      return this.services.notes.deleteNote(id);
    }

    return this.services.calendar.deleteEvent(id);
  }

  private requireAdminServices(): McpAdminDomainServices {
    if (!this.adminServices) {
      throw new McpToolError("INVALID_ARGUMENTS", "MCP admin services are unavailable.");
    }

    return this.adminServices;
  }
}

function undoPreview(action: "undo" | "redo", status: JsonObject): JsonObject {
  const canApply = action === "undo"
    ? status.canUndo === true
    : status.canRedo === true;
  const label = action === "undo"
    ? optionalJsonString(status, "undoLabel")
    : optionalJsonString(status, "redoLabel");

  if (!canApply) {
    throw new McpToolError("INVALID_ARGUMENTS", action === "undo" ? "Nothing to undo." : "Nothing to redo.");
  }

  return {
    kind: "undoAction",
    action,
    title: label ?? action,
    canApply: true
  };
}

function plannerBrief(
  status: JsonObject,
  today: JsonObject,
  mutations: JsonObject[]
): JsonObject {
  const tasks = jsonArray(today, "tasks");
  const events = jsonArray(today, "events");
  const notes = jsonArray(today, "notes");

  return {
    kind: "plannerBrief",
    generatedAt: new Date().toISOString(),
    account: jsonObjectValue(status, "account"),
    sync: jsonObjectValue(status, "sync"),
    cache: jsonObjectValue(status, "cache"),
    today: {
      date: stringValue(today.date),
      taskCount: tasks.length,
      eventCount: events.length,
      noteCount: notes.length,
      tasks: tasks.slice(0, 8),
      events: events.slice(0, 8),
      notes: notes.slice(0, 5)
    },
    pendingActions: {
      count: mutations.length,
      items: mutations.slice(0, 8)
    },
    suggestedReads: ["hcb://today", "hcb://week", "hcb://pending-mutations?limit=50"]
  };
}

function plannerPlan(status: JsonObject, today: JsonObject, week: JsonObject): JsonObject {
  const todayTasks = jsonArray(today, "tasks");
  const todayEvents = jsonArray(today, "events");
  const weekTasks = jsonArray(week, "tasks");
  const weekEvents = jsonArray(week, "events");

  return {
    kind: "plannerPlan",
    generatedAt: new Date().toISOString(),
    startDate: stringValue(week.startDate),
    sync: jsonObjectValue(status, "sync"),
    workload: {
      todayTaskCount: todayTasks.length,
      todayEventCount: todayEvents.length,
      weekTaskCount: weekTasks.length,
      weekEventCount: weekEvents.length
    },
    focus: {
      dueOrActiveTasks: todayTasks.slice(0, 10),
      nextEvents: todayEvents.slice(0, 10)
    },
    week: {
      tasks: weekTasks.slice(0, 30),
      events: weekEvents.slice(0, 30)
    },
    proposedActions: [
      {
        kind: "review",
        title: "Review unscheduled active tasks",
        command: "hcb_search",
        arguments: { query: "source:tasks status:active -has:due", limit: 20 }
      },
      {
        kind: "read",
        title: "Inspect pending writes before changing plan",
        resource: "hcb://pending-mutations?limit=50"
      }
    ]
  };
}

function requiredItemKind(args: Record<string, unknown>, key: string): ConvertItemKind {
  const value = requiredString(args, key);

  if (value === "event" || value === "task" || value === "note") {
    return value;
  }

  throw new McpToolError("INVALID_ARGUMENTS", `${key} must be event, task, or note.`);
}

function requiredSourceAction(args: Record<string, unknown>): ConvertSourceAction {
  const value = requiredString(args, "sourceAction");

  if (value === "keep" || value === "replace") {
    return value;
  }

  throw new McpToolError("INVALID_ARGUMENTS", "sourceAction must be keep or replace.");
}

function isTaskBackedNoteReplace(sourceKind: ConvertItemKind, targetKind: ConvertItemKind): boolean {
  return sourceKind === "task" && targetKind === "note";
}

function convertTargetPayload(
  sourceKind: ConvertItemKind,
  source: JsonObject,
  targetKind: ConvertItemKind,
  args: Record<string, unknown>
): JsonObject {
  if (targetKind === "task") {
    return convertTaskPayload(sourceKind, source, args);
  }

  if (targetKind === "note") {
    return convertNotePayload(sourceKind, source, args);
  }

  return convertEventPayload(sourceKind, source, args);
}

function convertTaskPayload(
  sourceKind: ConvertItemKind,
  source: JsonObject,
  args: Record<string, unknown>
): JsonObject {
  const sourceEventDate = sourceKind === "event"
    ? optionalJsonString(source, "startsAt") ?? optionalJsonString(source, "startDate")
    : undefined;
  const dueDate = optionalString(args, "dueDate") ?? sourceEventDate ?? (sourceKind === "note" ? todayDate() : undefined);

  return {
    title: optionalString(args, "title") ?? optionalJsonString(source, "title") ?? "Untitled task",
    notes:
      optionalString(args, "notes") ??
      optionalString(args, "body") ??
      optionalString(args, "details") ??
      optionalJsonString(source, "notes") ??
      optionalJsonString(source, "details") ??
      optionalJsonString(source, "body") ??
      "",
    ...(dueDate === undefined
      ? {}
      : { dueDate }),
    ...(optionalString(args, "taskListId") === undefined
      ? {}
      : { taskListId: optionalString(args, "taskListId") })
  };
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function convertNotePayload(
  sourceKind: ConvertItemKind,
  source: JsonObject,
  args: Record<string, unknown>
): JsonObject {
  return {
    title: optionalString(args, "title") ?? optionalJsonString(source, "title") ?? "Untitled note",
    body:
      optionalString(args, "body") ??
      optionalString(args, "notes") ??
      optionalString(args, "details") ??
      convertNoteBody(sourceKind, source),
    ...(optionalString(args, "noteListId") === undefined
      ? {}
      : { noteListId: optionalString(args, "noteListId") })
  };
}

function convertEventPayload(
  sourceKind: ConvertItemKind,
  source: JsonObject,
  args: Record<string, unknown>
): JsonObject {
  const startDate = eventStartDate(sourceKind, source, args);
  const allDay = optionalBoolean(args, "isAllDay") ?? eventAllDay(sourceKind, source, args);
  const endDate = optionalString(args, "endDate") ?? eventEndDate(sourceKind, source, startDate, allDay);

  return {
    title: optionalString(args, "title") ?? optionalJsonString(source, "title") ?? "Untitled event",
    details:
      optionalString(args, "details") ??
      optionalString(args, "notes") ??
      optionalString(args, "body") ??
      optionalJsonString(source, "notes") ??
      optionalJsonString(source, "body") ??
      "",
    startDate,
    endDate,
    isAllDay: allDay,
    ...(optionalJsonString(source, "location") === undefined
      ? {}
      : { location: optionalJsonString(source, "location") }),
    ...(optionalString(args, "calendarId") === undefined
      ? {}
      : { calendarId: optionalString(args, "calendarId") })
  };
}

function convertNoteBody(sourceKind: ConvertItemKind, source: JsonObject): string {
  if (sourceKind === "event") {
    return [
      optionalJsonString(source, "details") ?? optionalJsonString(source, "notes") ?? "",
      `Event: ${optionalJsonString(source, "startsAt") ?? optionalJsonString(source, "startDate") ?? ""} - ${optionalJsonString(source, "endsAt") ?? optionalJsonString(source, "endDate") ?? ""}`,
      optionalJsonString(source, "location") ? `Location: ${optionalJsonString(source, "location")}` : ""
    ].filter(Boolean).join("\n\n");
  }

  return optionalJsonString(source, "notes") ?? optionalJsonString(source, "body") ?? "";
}

function eventStartDate(
  sourceKind: ConvertItemKind,
  source: JsonObject,
  args: Record<string, unknown>
): string {
  const explicit = optionalString(args, "startDate");

  if (explicit) {
    return explicit;
  }

  if (sourceKind === "event") {
    return optionalJsonString(source, "startsAt") ?? optionalJsonString(source, "startDate") ?? missingEventDateMessage(sourceKind);
  }

  const plannedStart = optionalJsonString(source, "plannedStart");
  if (plannedStart) {
    return plannedStart;
  }

  const dueAt = optionalJsonString(source, "dueAt") ?? optionalJsonString(source, "dueDate");
  if (dueAt) {
    return dueAt;
  }

  throw new McpToolError("INVALID_ARGUMENTS", "Converting this item to an event requires --start-date.");
}

function eventEndDate(
  sourceKind: ConvertItemKind,
  source: JsonObject,
  startDate: string,
  allDay: boolean
): string {
  if (sourceKind === "event") {
    return optionalJsonString(source, "endsAt") ?? optionalJsonString(source, "endDate") ?? startDate;
  }

  const plannedEnd = optionalJsonString(source, "plannedEnd");
  if (plannedEnd) {
    return plannedEnd;
  }

  const startMs = Date.parse(startDate);

  if (!Number.isFinite(startMs)) {
    return startDate;
  }

  return new Date(startMs + (allDay ? 24 : 1) * 60 * 60 * 1000).toISOString();
}

function eventAllDay(
  sourceKind: ConvertItemKind,
  source: JsonObject,
  args: Record<string, unknown>
): boolean {
  if (optionalBoolean(args, "allDay") !== undefined) {
    return optionalBoolean(args, "allDay") ?? false;
  }

  if (sourceKind === "event") {
    return source.allDay === true || source.isAllDay === true;
  }

  return optionalJsonString(source, "plannedStart") === undefined;
}

function missingEventDateMessage(sourceKind: ConvertItemKind): never {
  throw new McpToolError("INVALID_ARGUMENTS", `Converting ${sourceKind} to event requires --start-date.`);
}

async function withMcpPublicError(action: () => Promise<JsonObject> | JsonObject): Promise<JsonObject> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof HcbPublicError) {
      throw new McpToolError(error.code === "CONFLICT" ? "MUTATION_FAILED" : "INVALID_ARGUMENTS", error.message);
    }

    throw error;
  }
}

function optionalJsonString(input: JsonObject, key: string): string | undefined {
  const value = input[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function readTool(
  name: string,
  description: string,
  properties: Record<string, JsonObject>,
  required: string[] = []
): McpToolDefinition {
  return {
    name,
    description,
    inputSchema: schema(properties, required),
    outputSchema: mcpToolResponseOutputSchema(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    kind: "read",
    destructive: false
  };
}

function writeTool(
  name: string,
  description: string,
  destructive: boolean,
  properties: Record<string, JsonObject>,
  required: string[] = []
): McpToolDefinition {
  return {
    name,
    description,
    inputSchema: schema(properties, required),
    outputSchema: mcpToolResponseOutputSchema(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: destructive,
      idempotentHint: false,
      openWorldHint: true
    },
    kind: "write",
    destructive
  };
}

function mcpToolResponseOutputSchema(): JsonObject {
  return {
    type: "object",
    properties: {
      applied: { type: "boolean" },
      dryRun: { type: "boolean" },
      requiresConfirmation: { type: "boolean" },
      confirmationId: { type: "string" },
      message: { type: "string" },
      item: { type: "object" },
      items: { type: "array" },
      deepLink: { type: "string" }
    },
    required: ["applied", "dryRun", "requiresConfirmation", "message"],
    additionalProperties: true
  };
}

function schema(properties: Record<string, JsonObject>, required: string[]): JsonObject {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

function stringSchema(description: string): JsonObject {
  return { type: "string", description };
}

function integerSchema(description: string): JsonObject {
  return { type: "integer", description };
}

function booleanSchema(description: string): JsonObject {
  return { type: "boolean", description };
}

function objectSchema(description: string): JsonObject {
  return { type: "object", description };
}

function arraySchema(description: string): JsonObject {
  return { type: "array", description };
}

function enumSchema(values: string[]): JsonObject {
  return { type: "string", enum: values };
}

function doctorItem(status: JsonObject, mutations: JsonObject[], logs: JsonObject[], hosterStatus?: JsonObject): JsonObject {
  const findings: JsonObject[] = [];
  const suggestedCommands: string[] = [];
  const account = objectValue(status.account);
  const sync = objectValue(status.sync);
  const pending = objectValue(status.pendingMutations);
  const mcp = objectValue(status.mcp);
  const hosters = objectValue(hosterStatus ?? {});
  const accountState = stringValue(account.state);
  const syncState = stringValue(sync.state);
  const failedCount = numberValue(pending.failedCount);
  const retryableCount = numberValue(pending.retryableCount);
  const pendingCount = numberValue(pending.totalCount) || numberValue(sync.pendingMutationCount);
  const failedMutations = mutations.filter((mutation) => stringValue(mutation.status) === "failed");
  const errorLogs = logs.filter((entry) => stringValue(entry.level) === "error");
  const warningLogs = logs.filter((entry) => stringValue(entry.level) === "warn");

  if (accountState !== "connected") {
    findings.push(finding("error", "Google account not connected", `Account state is ${accountState || "unknown"}.`));
    suggestedCommands.push("pnpm hcb -- status");
  }

  if (failedCount > 0 || failedMutations.length > 0) {
    findings.push(finding("error", "Failed pending mutations", `${Math.max(failedCount, failedMutations.length)} pending mutation(s) failed.`));
    suggestedCommands.push("pnpm hcb -- diff");

    const firstFailed = failedMutations[0];
    const firstFailedId = firstFailed ? stringValue(firstFailed.id) : "";

    if (firstFailedId) {
      suggestedCommands.push(`pnpm hcb -- show mutation ${firstFailedId}`);
    }
  } else if (pendingCount > 0) {
    findings.push(finding("warning", "Pending local mutations", `${pendingCount} local mutation(s) are waiting for Google sync.`));
    suggestedCommands.push("pnpm hcb -- diff");
  }

  if (retryableCount > 0) {
    findings.push(finding("warning", "Retryable pending mutations", `${retryableCount} pending mutation(s) can retry later.`));
    suggestedCommands.push("pnpm hcb -- diff");
  }

  if (booleanValue(sync.offline)) {
    findings.push(finding("warning", "Sync offline", "Sync status reports offline mode."));
    suggestedCommands.push("pnpm hcb -- status");
  }

  if (booleanValue(sync.stale)) {
    findings.push(finding("warning", "Cache is stale", "Local cache has stale sync status."));
    suggestedCommands.push("pnpm hcb -- status");
  }

  if (syncState && syncState !== "idle") {
    findings.push(finding("warning", "Sync not idle", `Sync state is ${syncState}.`));
    suggestedCommands.push("pnpm hcb -- status");
  }

  const permissionMode = stringValue(mcp.permissionMode);

  if (permissionMode && permissionMode !== "read-only") {
    findings.push(finding("warning", "MCP write access enabled", `MCP permission mode is ${permissionMode}.`));
  }

  if (booleanValue(hosters.enabled)) {
    if (!booleanValue(hosters.running)) {
      findings.push(finding("error", "Local hoster not running", stringValue(hosters.lastError) || "Local hosters are enabled but the loopback server is not running."));
      suggestedCommands.push("pnpm hcb -- hoster status");
    } else if (stringValue(hosters.health) && stringValue(hosters.health) !== "running") {
      findings.push(finding("warning", "Local hoster health degraded", `Local hoster health is ${stringValue(hosters.health)}.`));
      suggestedCommands.push("pnpm hcb -- hoster status");
    }
  } else if (jsonArray(hosters, "profiles").length > 0) {
    findings.push(finding("warning", "Local hoster profiles disabled", `${jsonArray(hosters, "profiles").length} local hoster profile(s) exist while local hosters are disabled.`));
    suggestedCommands.push("pnpm hcb -- hoster status");
  }

  if (errorLogs.length > 0) {
    findings.push(finding("error", "Recent error logs", `${errorLogs.length} recent error log(s) found.`));
    suggestedCommands.push("pnpm hcb -- log --level error");
  } else if (warningLogs.length > 0) {
    findings.push(finding("warning", "Recent warning logs", `${warningLogs.length} recent warning log(s) found.`));
    suggestedCommands.push("pnpm hcb -- log --level warn");
  }

  if (findings.length === 0) {
    findings.push(finding("ok", "No issues found", "Account, sync, queue, MCP, local hosters, and recent logs look healthy."));
  }

  return {
    kind: "doctor",
    status: doctorStatus(findings),
    generatedAt: new Date().toISOString(),
    findings,
    suggestedCommands: uniqueStrings(suggestedCommands)
  };
}

function finding(level: "ok" | "warning" | "error", title: string, detail: string): JsonObject {
  return {
    level,
    title,
    detail
  };
}

function doctorStatus(findings: JsonObject[]): "ok" | "warning" | "error" {
  if (findings.some((finding) => stringValue(finding.level) === "error")) {
    return "error";
  }

  if (findings.some((finding) => stringValue(finding.level) === "warning")) {
    return "warning";
  }

  return "ok";
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function objectValue(value: JsonValue | undefined): JsonObject {
  return isPlainObject(value) ? value as JsonObject : {};
}

function stringValue(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function jsonObjectValue(input: JsonObject, key: string): JsonObject {
  const value = input[key];
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function jsonArray(input: JsonObject, key: string): JsonValue[] {
  const value = input[key];
  return Array.isArray(value) ? value : [];
}

function numberValue(value: JsonValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function booleanValue(value: JsonValue | undefined): boolean {
  return value === true;
}

function success(input: {
  applied?: boolean;
  dryRun?: boolean;
  requiresConfirmation?: boolean;
  confirmationId?: string;
  message: string;
  item?: JsonObject;
  items?: JsonObject[];
}): McpToolResponse {
  return {
    applied: input.applied ?? false,
    dryRun: input.dryRun ?? false,
    requiresConfirmation: input.requiresConfirmation ?? false,
    ...(input.confirmationId === undefined ? {} : { confirmationId: input.confirmationId }),
    message: input.message,
    ...(input.item === undefined ? {} : { item: input.item }),
    ...(input.items === undefined ? {} : { items: input.items })
  };
}

function appliedMessage(toolName: string): string {
  const verb = toolName.replace(/^hcb_/, "").replaceAll("_", " ");
  return `Applied ${verb}.`;
}

function domainArguments(args: Record<string, unknown>): JsonObject {
  const output: JsonObject = {};

  for (const [key, value] of Object.entries(args)) {
    if (key === "dryRun" || key === "confirmationId") {
      continue;
    }

    output[key] = asJsonValue(value);
  }

  return output;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args, key);

  if (!value) {
    throw new McpToolError("INVALID_ARGUMENTS", `Missing required string argument '${key}'.`);
  }

  return value;
}

function requiredShowId(id: string | undefined, kind: string): string {
  if (!id) {
    throw new McpToolError("INVALID_ARGUMENTS", `Missing id for '${kind}'.`);
  }

  return id;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function requiredBackend(args: Record<string, unknown>): "google" | "hcb-local" | "hcb-hoster" {
  const value = requiredString(args, "backend");

  if (value !== "google" && value !== "hcb-local" && value !== "hcb-hoster") {
    throw new McpToolError("INVALID_ARGUMENTS", "backend must be google, hcb-local, or hcb-hoster.");
  }

  return value;
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.trunc(value);
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

function optionalHosterCapabilities(
  args: Record<string, unknown>
): Array<"host.info" | "signal.send" | "planner.read" | "planner.write"> | undefined {
  const value = args.capabilities;
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new McpToolError("INVALID_ARGUMENTS", "capabilities must be an array.");
  }
  const allowed = new Set(["host.info", "signal.send", "planner.read", "planner.write"]);
  const capabilities = [...new Set(value)];
  if (!capabilities.every((entry): entry is "host.info" | "signal.send" | "planner.read" | "planner.write" =>
    typeof entry === "string" && allowed.has(entry)
  )) {
    throw new McpToolError("INVALID_ARGUMENTS", "Unsupported local hoster capability.");
  }
  return capabilities;
}

function optionalPermissionMode(
  args: Record<string, unknown>
): "read-only" | "confirm-writes" | "allow-writes" | undefined {
  const value = optionalString(args, "permissionMode");
  if (value === undefined) {
    return undefined;
  }
  if (value === "read-only" || value === "confirm-writes" || value === "allow-writes") {
    return value;
  }
  throw new McpToolError("INVALID_ARGUMENTS", "permissionMode must be read-only, confirm-writes, or allow-writes.");
}

function requiredBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = optionalBoolean(args, key);

  if (value === undefined) {
    throw new McpToolError("INVALID_ARGUMENTS", `Missing required boolean argument '${key}'.`);
  }

  return value;
}

function requiredObject(args: Record<string, unknown>, key: string): JsonObject {
  const value = args[key];

  if (!isPlainObject(value)) {
    throw new McpToolError("INVALID_ARGUMENTS", `'${key}' must be an object.`);
  }

  return asJsonValue(value) as JsonObject;
}

function asJsonValue(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map(asJsonValue);
  }

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "object": {
      if (!isPlainObject(value)) {
        return null;
      }

      const output: JsonObject = {};

      for (const [key, child] of Object.entries(value)) {
        output[key] = asJsonValue(child);
      }

      return output;
    }
    default:
      return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
