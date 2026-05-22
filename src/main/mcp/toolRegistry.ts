import { McpConfirmationStore } from "./confirmationStore";
import type { McpDomainServices } from "./domainServices";
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

const readToolNames = [
  "hcb_search",
  "hcb_today",
  "hcb_week",
  "hcb_get_task",
  "hcb_get_event",
  "hcb_get_note",
  "hcb_list_task_lists",
  "hcb_list_calendars"
] as const;

const writeToolNames = [
  "hcb_create_task",
  "hcb_create_note",
  "hcb_create_event",
  "hcb_update_task",
  "hcb_update_note",
  "hcb_update_event",
  "hcb_complete_task",
  "hcb_reopen_task",
  "hcb_move_task",
  "hcb_delete_task",
  "hcb_delete_note",
  "hcb_delete_event"
] as const;

const destructiveToolNames = new Set<string>([
  "hcb_delete_task",
  "hcb_delete_note",
  "hcb_delete_event"
]);

export const MCP_READ_TOOL_NAMES = new Set<string>(readToolNames);
export const MCP_WRITE_TOOL_NAMES = new Set<string>(writeToolNames);
export const MCP_DESTRUCTIVE_TOOL_NAMES = destructiveToolNames;

export const mcpToolDefinitions: readonly McpToolDefinition[] = [
  readTool("hcb_search", "Search tasks, notes, events, lists, and calendars.", {
    query: stringSchema("Search or fuzzy query."),
    scope: enumSchema(["all", "tasks", "notes", "events", "lists", "calendars"]),
    limit: integerSchema("Maximum result count.")
  }, ["query"]),
  readTool("hcb_today", "Read today's due tasks, notes, and scheduled events.", {}),
  readTool("hcb_week", "Read the agenda for a seven-day window.", {
    startDate: stringSchema("Optional ISO-8601 date or date-time. Defaults to today.")
  }),
  readTool("hcb_get_task", "Read one task by id.", {
    id: stringSchema("Task id.")
  }, ["id"]),
  readTool("hcb_get_event", "Read one event by id.", {
    id: stringSchema("Event id.")
  }, ["id"]),
  readTool("hcb_get_note", "Read one local note by id.", {
    id: stringSchema("Note id.")
  }, ["id"]),
  readTool("hcb_list_task_lists", "List available Google Tasks lists.", {}),
  readTool("hcb_list_calendars", "List available Google calendars.", {}),
  writeTool("hcb_create_task", "Create a dated task.", false, {
    title: stringSchema("Task title."),
    notes: stringSchema("Optional task notes."),
    dueDate: stringSchema("Optional ISO-8601 due date."),
    taskListId: stringSchema("Optional task list id."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["title"]),
  writeTool("hcb_create_note", "Create a local note.", false, {
    title: stringSchema("Note title."),
    body: stringSchema("Optional note body."),
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
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["title", "startDate"]),
  writeTool("hcb_update_task", "Update task fields.", false, {
    id: stringSchema("Task id."),
    patch: objectSchema("Fields: title, notes, dueDate, taskListId."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id", "patch"]),
  writeTool("hcb_update_note", "Update local note fields.", false, {
    id: stringSchema("Note id."),
    patch: objectSchema("Fields: title, body, linkedTaskId, linkedEventId."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id", "patch"]),
  writeTool("hcb_update_event", "Update event fields.", false, {
    id: stringSchema("Event id."),
    patch: objectSchema("Fields: title, details, startDate, endDate, isAllDay, location, calendarId."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id", "patch"]),
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
  writeTool("hcb_move_task", "Move a task to another list.", false, {
    id: stringSchema("Task id."),
    taskListId: stringSchema("Destination task list id."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id", "taskListId"]),
  writeTool("hcb_delete_task", "Delete a task. Always requires confirmation.", true, {
    id: stringSchema("Task id."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id"]),
  writeTool("hcb_delete_note", "Delete a local note. Always requires confirmation.", true, {
    id: stringSchema("Note id."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id"]),
  writeTool("hcb_delete_event", "Delete an event. Always requires confirmation.", true, {
    id: stringSchema("Event id."),
    dryRun: booleanSchema("Preview without applying."),
    confirmationId: stringSchema("Confirmation id returned by a dry-run.")
  }, ["id"])
];

export class McpToolRegistry {
  private readonly definitions = new Map<string, McpToolDefinition>();
  private readonly writeHandlers: Record<string, WriteHandler>;

  constructor(
    private readonly services: McpDomainServices,
    private readonly confirmations = new McpConfirmationStore()
  ) {
    for (const definition of mcpToolDefinitions) {
      this.definitions.set(definition.name, definition);
    }

    this.writeHandlers = this.createWriteHandlers();
  }

  listTools(): PublicMcpToolDefinition[] {
    return mcpToolDefinitions.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema
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
      case "hcb_list_calendars":
        return success({
          message: "Read calendars.",
          items: await this.services.calendar.listCalendars()
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

    if (requiresConfirmation) {
      const confirmationId = optionalString(argumentsObject, "confirmationId");

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

    const item = await handler.apply(argumentsObject);

    return success({
      applied: true,
      message: appliedMessage(definition.name),
      item
    });
  }

  private createWriteHandlers(): Record<string, WriteHandler> {
    return {
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
      hcb_complete_task: {
        preview: (args) => this.services.tasks.previewCompleteTask(requiredString(args, "id")),
        apply: (args) => this.services.tasks.completeTask(requiredString(args, "id"))
      },
      hcb_reopen_task: {
        preview: (args) => this.services.tasks.previewReopenTask(requiredString(args, "id")),
        apply: (args) => this.services.tasks.reopenTask(requiredString(args, "id"))
      },
      hcb_move_task: {
        preview: (args) =>
          this.services.tasks.previewMoveTask(
            requiredString(args, "id"),
            requiredString(args, "taskListId")
          ),
        apply: (args) =>
          this.services.tasks.moveTask(
            requiredString(args, "id"),
            requiredString(args, "taskListId")
          )
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
      }
    };
  }
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
    kind: "write",
    destructive
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

function enumSchema(values: string[]): JsonObject {
  return { type: "string", enum: values };
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

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
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
