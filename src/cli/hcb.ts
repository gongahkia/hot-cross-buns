import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HCB_MCP_RUNTIME_FILE_NAME, type HcbMcpRuntimeFile } from "@shared/mcpRuntime";
import { MacOsKeychainSecretStore } from "@main/credentials/secretStore";
import { KeychainMcpCredentialAdapter } from "@main/mcp/keychainCredentials";
import type { JsonObject, McpToolResponse } from "@main/mcp/types";

type Output = Pick<typeof process.stdout, "write">;

interface FetchResponseLike {
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

type FetchLike = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  }
) => Promise<FetchResponseLike>;

export interface HcbCliDependencies {
  env?: NodeJS.ProcessEnv;
  stdout?: Output;
  stderr?: Output;
  fetch?: FetchLike;
  tokenProvider?: () => Promise<string>;
  runtimeFilePaths?: string[];
  pidExists?: (pid: number) => boolean;
}

interface ParsedCommand {
  command:
    | "status"
    | "log"
    | "diff"
    | "show"
    | "doctor"
    | "search"
    | "today"
    | "week"
    | "export-diagnostics"
    | "undo-status"
    | "sync-now"
    | "pending-mutations"
    | "retry-mutation"
    | "cancel-mutation"
    | "list"
    | "get"
    | "create"
    | "update"
    | "convert"
    | "rename"
    | "complete"
    | "reopen"
    | "move"
    | "delete"
    | "undo"
    | "redo"
    | "schedule"
    | "settings"
    | "google"
    | "mcp"
    | "help";
  json: boolean;
  limit?: number;
  level?: string;
  kind?: string;
  action?: string;
  id?: string;
  target?: string;
  to?: string;
  sourceAction?: string;
  apply?: boolean;
  confirmationId?: string;
  title?: string;
  notes?: string;
  dueDate?: string | null;
  taskListId?: string;
  parentId?: string | null;
  previousSiblingId?: string | null;
  priority?: string;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  durationMinutes?: number | null;
  lockedSchedule?: boolean;
  snoozeUntil?: string | null;
  tags?: string[];
  noteListId?: string;
  body?: string;
  details?: string;
  logLimit?: number;
  mutationLimit?: number;
  query?: string;
  scope?: string;
  eventCompletionScope?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  calendarId?: string;
  allDay?: boolean;
  guestEmails?: string[];
  reminderMinutes?: number[];
  colorId?: string | null;
  timeZone?: string;
  resources?: string[];
  full?: boolean;
  recurrenceFrequency?: string;
  recurrenceInterval?: number;
  recurrenceEndsOn?: string | null;
  recurrenceCount?: number | null;
  recurrenceByDay?: string[];
  clearRecurrence?: boolean;
  patchJson?: JsonObject;
  clientId?: string;
  clientSecret?: string;
  enabled?: boolean;
}

interface RuntimeTarget {
  url: "http://127.0.0.1";
  port: number;
  pid?: number;
}

class CliError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
  }
}

export async function runHcbCli(
  argv = process.argv.slice(2),
  dependencies: HcbCliDependencies = {}
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  let command: ParsedCommand | undefined;

  try {
    command = parseCommand(argv);

    if (command.command === "help") {
      stdout.write(helpText());
      return 0;
    }

    const response = await callCommand(command, dependencies);
    stdout.write(formatResponse(command, response));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (command?.command === "doctor") {
      const response = doctorFailureResponse(message);
      stdout.write(formatResponse(command, response));
      return 1;
    }

    stderr.write(`${message}\n`);
    return error instanceof CliError ? error.exitCode : 1;
  }
}

export function parseCommand(argv: string[]): ParsedCommand {
  const args = [...argv];

  while (args[0] === "--") {
    args.shift();
  }

  const command = args.shift();

  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { command: "help", json: false };
  }

  if (!isCommand(command)) {
    throw new CliError(`Unknown command '${command}'. Run 'pnpm hcb -- help'.`, 2);
  }

  const parsed: ParsedCommand = {
    command,
    json: false
  };
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "-n" || arg === "--limit") {
      const value = args[index + 1];
      index += 1;
      parsed.limit = parseLimit(value);
      continue;
    }

    if (arg === "--level") {
      const value = args[index + 1];
      index += 1;
      parsed.level = parseLevel(value);
      continue;
    }

    if (arg === "--log-limit") {
      const value = args[index + 1];
      index += 1;
      parsed.logLimit = parseLimit(value);
      continue;
    }

    if (arg === "--mutation-limit") {
      const value = args[index + 1];
      index += 1;
      parsed.mutationLimit = parseLimit(value);
      continue;
    }

    if (arg === "--scope") {
      const value = args[index + 1];
      index += 1;
      if (command === "complete" || command === "reopen") {
        parsed.eventCompletionScope = parseEventCompletionScope(value);
      } else {
        parsed.scope = parseScope(value);
      }
      continue;
    }

    if (arg === "--start-date") {
      const value = args[index + 1];
      index += 1;
      parsed.startDate = parseStartDate(value);
      continue;
    }

    if (arg === "--end-date") {
      const value = args[index + 1];
      index += 1;
      parsed.endDate = parseEndDate(value);
      continue;
    }

    if (arg === "--due-date") {
      const value = args[index + 1];
      index += 1;
      parsed.dueDate = parseDueDate(value);
      continue;
    }

    if (arg === "--title") {
      const value = args[index + 1];
      index += 1;
      parsed.title = optionValue(value, "--title");
      continue;
    }

    if (arg === "--to") {
      const value = args[index + 1];
      index += 1;
      parsed.to = parsePrimitiveTarget(value, "--to");
      continue;
    }

    if (arg === "--source-action") {
      const value = args[index + 1];
      index += 1;
      parsed.sourceAction = parseSourceAction(value);
      continue;
    }

    if (arg === "--notes") {
      const value = args[index + 1];
      index += 1;
      parsed.notes = optionValue(value, "--notes");
      continue;
    }

    if (arg === "--task-list-id") {
      const value = args[index + 1];
      index += 1;
      parsed.taskListId = optionValue(value, "--task-list-id");
      continue;
    }

    if (arg === "--parent-id") {
      const value = args[index + 1];
      index += 1;
      parsed.parentId = parseNullableId(value, "--parent-id");
      continue;
    }

    if (arg === "--previous-sibling-id") {
      const value = args[index + 1];
      index += 1;
      parsed.previousSiblingId = parseNullableId(value, "--previous-sibling-id");
      continue;
    }

    if (arg === "--priority") {
      const value = args[index + 1];
      index += 1;
      parsed.priority = parsePriority(value);
      continue;
    }

    if (arg === "--planned-start") {
      const value = args[index + 1];
      index += 1;
      parsed.plannedStart = parseNullableDateTime(value, "--planned-start");
      continue;
    }

    if (arg === "--planned-end") {
      const value = args[index + 1];
      index += 1;
      parsed.plannedEnd = parseNullableDateTime(value, "--planned-end");
      continue;
    }

    if (arg === "--duration-minutes") {
      const value = args[index + 1];
      index += 1;
      parsed.durationMinutes = parseNullableInteger(value, "--duration-minutes", 0, 24 * 60);
      continue;
    }

    if (arg === "--locked-schedule") {
      parsed.lockedSchedule = true;
      continue;
    }

    if (arg === "--snooze-until") {
      const value = args[index + 1];
      index += 1;
      parsed.snoozeUntil = parseNullableDateTime(value, "--snooze-until");
      continue;
    }

    if (arg === "--tags") {
      const value = args[index + 1];
      index += 1;
      parsed.tags = parseCsv(value, "--tags");
      continue;
    }

    if (arg === "--note-list-id") {
      const value = args[index + 1];
      index += 1;
      parsed.noteListId = optionValue(value, "--note-list-id");
      continue;
    }

    if (arg === "--body") {
      const value = args[index + 1];
      index += 1;
      parsed.body = optionValue(value, "--body");
      continue;
    }

    if (arg === "--details") {
      const value = args[index + 1];
      index += 1;
      parsed.details = optionValue(value, "--details");
      continue;
    }

    if (arg === "--location") {
      const value = args[index + 1];
      index += 1;
      parsed.location = optionValue(value, "--location");
      continue;
    }

    if (arg === "--calendar-id") {
      const value = args[index + 1];
      index += 1;
      parsed.calendarId = optionValue(value, "--calendar-id");
      continue;
    }

    if (arg === "--guest-emails") {
      const value = args[index + 1];
      index += 1;
      parsed.guestEmails = parseCsv(value, "--guest-emails");
      continue;
    }

    if (arg === "--reminder-minutes") {
      const value = args[index + 1];
      index += 1;
      parsed.reminderMinutes = parseIntegerCsv(value, "--reminder-minutes", 0, 28 * 24 * 60);
      continue;
    }

    if (arg === "--resources") {
      const value = args[index + 1];
      index += 1;
      parsed.resources = parseSyncResources(value);
      continue;
    }

    if (arg === "--full") {
      parsed.full = true;
      continue;
    }

    if (arg === "--color-id") {
      const value = args[index + 1];
      index += 1;
      parsed.colorId = parseNullableId(value, "--color-id");
      continue;
    }

    if (arg === "--time-zone") {
      const value = args[index + 1];
      index += 1;
      parsed.timeZone = optionValue(value, "--time-zone");
      continue;
    }

    if (arg === "--recurrence-frequency") {
      const value = args[index + 1];
      index += 1;
      parsed.recurrenceFrequency = parseRecurrenceFrequency(value);
      continue;
    }

    if (arg === "--recurrence-interval") {
      const value = args[index + 1];
      index += 1;
      parsed.recurrenceInterval = parseInteger(value, "--recurrence-interval", 1, 366);
      continue;
    }

    if (arg === "--recurrence-ends-on") {
      const value = args[index + 1];
      index += 1;
      parsed.recurrenceEndsOn = parseNullableDateOnly(value, "--recurrence-ends-on");
      continue;
    }

    if (arg === "--recurrence-count") {
      const value = args[index + 1];
      index += 1;
      parsed.recurrenceCount = parseNullableInteger(value, "--recurrence-count", 1, 366);
      continue;
    }

    if (arg === "--recurrence-by-day") {
      const value = args[index + 1];
      index += 1;
      parsed.recurrenceByDay = parseByDayCsv(value);
      continue;
    }

    if (arg === "--clear-recurrence") {
      parsed.clearRecurrence = true;
      continue;
    }

    if (arg === "--patch-json") {
      const value = args[index + 1];
      index += 1;
      parsed.patchJson = parsePatchJson(value);
      continue;
    }

    if (arg === "--client-id") {
      const value = args[index + 1];
      index += 1;
      parsed.clientId = optionValue(value, "--client-id");
      continue;
    }

    if (arg === "--client-secret") {
      const value = args[index + 1];
      index += 1;
      parsed.clientSecret = optionValue(value, "--client-secret");
      continue;
    }

    if (arg === "--enabled") {
      const value = args[index + 1];
      index += 1;
      parsed.enabled = parseBooleanOption(value, "--enabled");
      continue;
    }

    if (arg === "--confirmation-id") {
      const value = args[index + 1];
      index += 1;
      parsed.confirmationId = optionValue(value, "--confirmation-id");
      continue;
    }

    if (arg === "--all-day") {
      parsed.allDay = true;
      continue;
    }

    if (arg === "--apply") {
      parsed.apply = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new CliError(`Unknown option '${arg}'.`, 2);
    }

    positional.push(arg);
  }

  if (command === "show") {
    parsed.kind = positional[0];
    parsed.id = positional[1];

    if (!parsed.kind) {
      throw new CliError("Usage: pnpm hcb -- show <task|event|note|mutation|diagnostics> [id]", 2);
    }

    if (positional.length > 2) {
      throw new CliError("Too many positional arguments for show.", 2);
    }
  } else if (command === "search") {
    parsed.query = positional.join(" ").trim();

    if (!parsed.query) {
      throw new CliError("Usage: pnpm hcb -- search <query> [--scope <scope>] [--limit <limit>]", 2);
    }
  } else if (command === "list") {
    parsed.target = parseListTarget(positional[0]);

    if (positional.length !== 1) {
      throw new CliError("Usage: pnpm hcb -- list <task-lists|calendars|note-lists>", 2);
    }
  } else if (command === "get") {
    parsed.target = parseGetTarget(positional[0]);
    parsed.id = positional[1];

    if (!parsed.id || positional.length !== 2) {
      throw new CliError("Usage: pnpm hcb -- get <task|event|note> <id>", 2);
    }
  } else if (command === "create") {
    parsed.target = parseCreateTarget(positional[0]);

    if (positional.length !== 1) {
      throw new CliError("Usage: pnpm hcb -- create <task|note|event|task-list|note-list> --title <title> [options]", 2);
    }

    validateCreateCommand(parsed);
  } else if (command === "update") {
    parsed.target = parseUpdateTarget(positional[0]);
    parsed.id = positional[1];

    if (!parsed.id || positional.length !== 2) {
      throw new CliError("Usage: pnpm hcb -- update <task|note|event> <id> [options]", 2);
    }

    validateUpdateCommand(parsed);
  } else if (command === "convert") {
    parsed.target = parsePrimitiveTarget(positional[0], "convert target");
    parsed.id = positional[1];

    if (!parsed.id || positional.length !== 2) {
      throw new CliError("Usage: pnpm hcb -- convert <task|note|event> <id> --to <task|note|event> --source-action <keep|replace> [options]", 2);
    }

    validateConvertCommand(parsed);
  } else if (command === "rename") {
    parsed.target = parseRenameTarget(positional[0]);
    parsed.id = positional[1];

    if (!parsed.id || positional.length !== 2) {
      throw new CliError("Usage: pnpm hcb -- rename <task-list|note-list> <id> --title <title>", 2);
    }

    validateRenameCommand(parsed);
  } else if (command === "complete" || command === "reopen") {
    parsed.target = parseTaskStateTarget(positional[0], command);
    parsed.id = positional[1];

    if (!parsed.id || positional.length !== 2) {
      throw new CliError(`Usage: pnpm hcb -- ${command} <task|event> <id>`, 2);
    }

    validateTaskStateCommand(parsed);
  } else if (command === "move") {
    parsed.target = parseTaskStateTarget(positional[0], command);
    parsed.id = positional[1];

    if (!parsed.id || positional.length !== 2) {
      throw new CliError("Usage: pnpm hcb -- move task <id> [--task-list-id <id>] [--parent-id <id|null>] [--previous-sibling-id <id|null>]", 2);
    }

    validateMoveCommand(parsed);
  } else if (command === "delete") {
    parsed.target = parseDeleteTarget(positional[0]);
    parsed.id = positional[1];

    if (!parsed.id || positional.length !== 2) {
      throw new CliError("Usage: pnpm hcb -- delete <task|note|event|task-list|note-list> <id>", 2);
    }

    validateDeleteCommand(parsed);
  } else if (command === "undo-status") {
    if (positional.length !== 0) {
      throw new CliError("Usage: pnpm hcb -- undo-status", 2);
    }

    validateUndoStatusCommand(parsed);
  } else if (command === "sync-now") {
    if (positional.length !== 0) {
      throw new CliError("Usage: pnpm hcb -- sync-now [--resources tasks,calendar] [--full] [--apply --confirmation-id <id>]", 2);
    }

    parsed.target = "sync";
    validateSyncNowCommand(parsed);
  } else if (command === "pending-mutations") {
    if (positional.length !== 0) {
      throw new CliError("Usage: pnpm hcb -- pending-mutations [--limit <limit>]", 2);
    }

    validatePendingMutationsCommand(parsed);
  } else if (command === "retry-mutation" || command === "cancel-mutation") {
    parsed.target = "mutation";
    parsed.id = positional[0];

    if (!parsed.id || positional.length !== 1) {
      throw new CliError(`Usage: pnpm hcb -- ${command} <id> [--apply --confirmation-id <id>]`, 2);
    }

    validatePendingMutationActionCommand(parsed);
  } else if (command === "undo" || command === "redo") {
    if (positional.length !== 0) {
      throw new CliError(`Usage: pnpm hcb -- ${command} [--apply --confirmation-id <id>]`, 2);
    }

    validateUndoRedoCommand(parsed);
  } else if (command === "schedule") {
    parsed.target = parseTaskStateTarget(positional[0], command);
    parsed.id = positional[1];

    if (!parsed.id || positional.length !== 2) {
      throw new CliError("Usage: pnpm hcb -- schedule task <id> --calendar-id <id> --start-date <iso> [--duration-minutes <n>]", 2);
    }

    validateScheduleCommand(parsed);
  } else if (command === "settings") {
    parsed.action = parseSettingsAction(positional[0]);
    parsed.target = "settings";

    if (positional.length !== 1) {
      throw new CliError("Usage: pnpm hcb -- settings update --patch-json '<json>' [--apply]", 2);
    }

    validateSettingsCommand(parsed);
  } else if (command === "google") {
    parsed.action = parseGoogleAction(positional[0]);
    parsed.target = parsed.action;

    if (positional.length !== 1) {
      throw new CliError("Usage: pnpm hcb -- google <save-oauth-client|begin-oauth> [options]", 2);
    }

    validateGoogleCommand(parsed);
  } else if (command === "mcp") {
    parsed.action = parseMcpAction(positional[0]);
    parsed.target = "mcp";

    if (positional.length !== 1 && positional.length !== 2) {
      throw new CliError("Usage: pnpm hcb -- mcp set-enabled <true|false> [--apply]", 2);
    }

    if (positional[1] !== undefined) {
      parsed.enabled = parseBooleanOption(positional[1], "set-enabled");
    }

    validateMcpCommand(parsed);
  } else if (positional.length > 0) {
    throw new CliError(`Unexpected argument '${positional[0]}'.`, 2);
  }

  if (parsed.scope !== undefined && command !== "search") {
    throw new CliError(`--scope is only supported by search.`, 2);
  }

  if (
    parsed.eventCompletionScope !== undefined &&
    (command !== "complete" && command !== "reopen" || parsed.target !== "event")
  ) {
    throw new CliError("--scope is only supported by complete/reopen event.", 2);
  }

  if ((parsed.to !== undefined || parsed.sourceAction !== undefined) && command !== "convert") {
    throw new CliError("--to and --source-action are only supported by convert.", 2);
  }

  if (parsed.startDate !== undefined && command !== "week" && command !== "create" && command !== "update" && command !== "schedule" && command !== "convert") {
    throw new CliError(`--start-date is only supported by week, create event, update event, schedule task, and convert.`, 2);
  }

  if ((parsed.logLimit !== undefined || parsed.mutationLimit !== undefined) && command !== "doctor" && command !== "export-diagnostics") {
    throw new CliError("--log-limit and --mutation-limit are only supported by doctor and export-diagnostics.", 2);
  }

  if (parsed.resources !== undefined && command !== "sync-now") {
    throw new CliError("--resources is only supported by sync-now.", 2);
  }

  if (parsed.full === true && command !== "sync-now") {
    throw new CliError("--full is only supported by sync-now.", 2);
  }

  if (hasWriteOnlyOptions(parsed) && !isWriteCommand(command)) {
    throw new CliError("Write options are only supported by sync-now, retry-mutation, cancel-mutation, create, update, convert, rename, complete, reopen, move, delete, undo, redo, schedule, settings, google, and mcp.", 2);
  }

  return parsed;
}

export async function callCommand(
  command: ParsedCommand,
  dependencies: HcbCliDependencies = {}
): Promise<McpToolResponse> {
  if (command.command === "export-diagnostics") {
    return callDiagnosticsExport(command, dependencies);
  }

  const tool = toolName(command);
  const args: JsonObject = {};

  if (command.limit !== undefined) {
    args.limit = command.limit;
  }

  if (command.level !== undefined) {
    args.level = command.level;
  }

  if (command.kind !== undefined) {
    args.kind = command.kind;
  }

  if (command.id !== undefined && command.command !== "schedule" && command.command !== "convert") {
    args.id = command.id;
  }

  if (command.logLimit !== undefined) {
    args.logLimit = command.logLimit;
  }

  if (command.mutationLimit !== undefined) {
    args.mutationLimit = command.mutationLimit;
  }

  if (command.query !== undefined) {
    args.query = command.query;
  }

  if (command.scope !== undefined) {
    args.scope = command.scope;
  }

  if (command.eventCompletionScope !== undefined) {
    args.scope = command.eventCompletionScope;
  }

  if (command.command === "week" && command.startDate !== undefined) {
    args.startDate = command.startDate;
  }

  if (command.command === "sync-now") {
    if (command.resources !== undefined) {
      args.resources = command.resources;
    }

    if (command.full === true) {
      args.full = true;
    }
  }

  if (isWriteCommand(command.command)) {
    args.dryRun = command.apply !== true;

    if (command.confirmationId !== undefined) {
      args.confirmationId = command.confirmationId;
    }
  }

  if (command.command === "create" || command.command === "rename") {
    if (command.title !== undefined) {
      args.title = command.title;
    }
  }

  if (command.command === "create") {
    if (command.notes !== undefined) {
      args.notes = command.notes;
    }

    if (command.dueDate !== undefined) {
      args.dueDate = command.dueDate;
    }

    if (command.taskListId !== undefined) {
      args.taskListId = command.taskListId;
    }

    if (command.parentId !== undefined) {
      args.parentId = command.parentId;
    }

    if (command.previousSiblingId !== undefined) {
      args.previousSiblingId = command.previousSiblingId;
    }

    if (command.priority !== undefined) {
      args.priority = command.priority;
    }

    if (command.plannedStart !== undefined) {
      args.plannedStart = command.plannedStart;
    }

    if (command.plannedEnd !== undefined) {
      args.plannedEnd = command.plannedEnd;
    }

    if (command.durationMinutes !== undefined) {
      args.durationMinutes = command.durationMinutes;
    }

    if (command.lockedSchedule === true) {
      args.lockedSchedule = true;
    }

    if (command.snoozeUntil !== undefined) {
      args.snoozeUntil = command.snoozeUntil;
    }

    if (command.tags !== undefined) {
      args.tags = command.tags;
    }

    if (command.noteListId !== undefined) {
      args.noteListId = command.noteListId;
    }

    if (command.body !== undefined) {
      args.body = command.body;
    }

    if (command.startDate !== undefined) {
      args.startDate = command.startDate;
    }

    if (command.details !== undefined) {
      args.details = command.details;
    }

    if (command.endDate !== undefined) {
      args.endDate = command.endDate;
    }

    if (command.location !== undefined) {
      args.location = command.location;
    }

    if (command.calendarId !== undefined) {
      args.calendarId = command.calendarId;
    }

    if (command.allDay === true) {
      args.isAllDay = true;
    }

    if (command.guestEmails !== undefined) {
      args.guestEmails = command.guestEmails;
    }

    if (command.reminderMinutes !== undefined) {
      args.reminderMinutes = command.reminderMinutes;
    }

    if (command.colorId !== undefined) {
      args.colorId = command.colorId;
    }

    if (command.timeZone !== undefined) {
      args.timeZone = command.timeZone;
    }

    const recurrence = recurrenceInput(command);

    if (recurrence !== undefined) {
      args.recurrence = recurrence;
    }
  }

  if (command.command === "update") {
    args.patch = updatePatch(command);
  }

  if (command.command === "convert") {
    args.sourceKind = command.target ?? "";
    args.sourceId = command.id ?? "";
    args.targetKind = command.to ?? "";
    args.sourceAction = command.sourceAction ?? "";

    if (command.title !== undefined) {
      args.title = command.title;
    }

    if (command.notes !== undefined) {
      args.notes = command.notes;
    }

    if (command.body !== undefined) {
      args.body = command.body;
    }

    if (command.details !== undefined) {
      args.details = command.details;
    }

    if (command.dueDate !== undefined) {
      args.dueDate = command.dueDate;
    }

    if (command.taskListId !== undefined) {
      args.taskListId = command.taskListId;
    }

    if (command.noteListId !== undefined) {
      args.noteListId = command.noteListId;
    }

    if (command.calendarId !== undefined) {
      args.calendarId = command.calendarId;
    }

    if (command.startDate !== undefined) {
      args.startDate = command.startDate;
    }

    if (command.endDate !== undefined) {
      args.endDate = command.endDate;
    }

    if (command.allDay === true) {
      args.isAllDay = true;
    }
  }

  if (command.command === "move") {
    if (command.taskListId !== undefined) {
      args.taskListId = command.taskListId;
    }

    if (command.parentId !== undefined) {
      args.parentId = command.parentId;
    }

    if (command.previousSiblingId !== undefined) {
      args.previousSiblingId = command.previousSiblingId;
    }
  }

  if (command.command === "schedule") {
    args.taskId = command.id ?? "";

    if (command.calendarId !== undefined) {
      args.calendarId = command.calendarId;
    }

    if (command.startDate !== undefined) {
      args.startDate = command.startDate;
    }

    if (command.durationMinutes !== undefined && command.durationMinutes !== null) {
      args.durationMinutes = command.durationMinutes;
    }
  }

  if (command.command === "settings") {
    args.patch = command.patchJson ?? {};
  }

  if (command.command === "google") {
    if (command.clientId !== undefined) {
      args.clientId = command.clientId;
    }

    if (command.clientSecret !== undefined) {
      args.clientSecret = command.clientSecret;
    }
  }

  if (command.command === "mcp" && command.enabled !== undefined) {
    args.enabled = command.enabled;
  }

  return callMcpTool(tool, args, dependencies);
}

export async function callMcpTool(
  name: string,
  argumentsObject: JsonObject,
  dependencies: HcbCliDependencies = {}
): Promise<McpToolResponse> {
  const target = discoverRuntime(dependencies);
  const token = await tokenProvider(dependencies)();
  return callMcpToolWithAuth(name, argumentsObject, dependencies, target, token);
}

async function callDiagnosticsExport(
  command: ParsedCommand,
  dependencies: HcbCliDependencies = {}
): Promise<McpToolResponse> {
  const target = discoverRuntime(dependencies);
  const token = await tokenProvider(dependencies)();
  const logLimit = command.logLimit ?? 50;
  const mutationLimit = command.mutationLimit ?? 50;
  const call = (name: string, args: JsonObject) =>
    callMcpToolWithAuth(name, args, dependencies, target, token);
  const [doctor, status, mutations, warningLogs, errorLogs] = await Promise.all([
    call("hcb_doctor", { logLimit, mutationLimit }),
    call("hcb_status", {}),
    call("hcb_diff", { limit: mutationLimit }),
    call("hcb_log", { limit: logLimit, level: "warn" }),
    call("hcb_log", { limit: logLimit, level: "error" })
  ]);

  return {
    applied: false,
    dryRun: false,
    requiresConfirmation: false,
    message: "Exported HCB diagnostics.",
    item: {
      kind: "diagnosticsExport",
      generatedAt: new Date().toISOString(),
      doctor: doctor.item ?? {},
      status: status.item ?? {},
      pendingMutations: mutations.items ?? [],
      warningLogs: warningLogs.items ?? [],
      errorLogs: errorLogs.items ?? []
    }
  };
}

async function callMcpToolWithAuth(
  name: string,
  argumentsObject: JsonObject,
  dependencies: HcbCliDependencies,
  target: RuntimeTarget,
  token: string
): Promise<McpToolResponse> {
  const response = await fetchImpl(dependencies)(`${target.url}:${target.port}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "hcb-cli/1.0"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `hcb-cli-${Date.now()}`,
      method: "tools/call",
      params: {
        name,
        arguments: argumentsObject
      }
    })
  });

  if (response.status === 401) {
    throw new CliError("MCP authentication failed. Reset the MCP token from HCB2 Settings, then retry.", 1);
  }

  if (response.status === 403) {
    throw new CliError("MCP access was rejected. Confirm the local MCP server allows this client.", 1);
  }

  if (response.status < 200 || response.status >= 300) {
    throw new CliError(`MCP request failed with HTTP ${response.status}: ${await response.text()}`);
  }

  const body = await response.json();
  const object = asObject(body);

  if (!object) {
    throw new CliError("MCP response was not a JSON object.");
  }

  const error = asObject(object.error);

  if (error) {
    throw new CliError(String(error.message ?? "MCP tool failed."));
  }

  const result = asObject(object.result);
  const structured = asObject(result?.structuredContent);

  if (!structured) {
    throw new CliError("MCP response did not include structured content.");
  }

  return structured as unknown as McpToolResponse;
}

export function discoverRuntime(dependencies: HcbCliDependencies = {}): RuntimeTarget {
  const env = dependencies.env ?? process.env;
  const explicitUrl = env.HCB_MCP_URL?.trim();

  if (explicitUrl) {
    const parsed = runtimeFromUrl(explicitUrl);

    if (parsed) {
      return parsed;
    }

    throw new CliError("HCB_MCP_URL must be http://127.0.0.1:<port>.");
  }

  const files = dependencies.runtimeFilePaths ?? runtimeFileCandidates(env);

  for (const file of files) {
    if (!existsSync(file)) {
      continue;
    }

    const runtime = parseRuntimeFile(readFileSync(file, "utf8"));

    if (!runtime.running) {
      continue;
    }

    if (!pidExists(dependencies)(runtime.pid)) {
      throw new CliError("HCB MCP server runtime file is stale. Start HCB2 or toggle Local MCP server.");
    }

    return {
      url: runtime.url,
      port: runtime.port,
      pid: runtime.pid
    };
  }

  throw new CliError("HCB MCP server not running. Start HCB2 and enable Settings > Local MCP server.");
}

export function runtimeFileCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = env.HCB_MCP_RUNTIME_FILE?.trim();

  if (explicit) {
    return [explicit];
  }

  const userData = env.HCB_USER_DATA_DIR?.trim();

  if (userData) {
    return [join(userData, "config", HCB_MCP_RUNTIME_FILE_NAME)];
  }

  const home = homedir();

  if (process.platform === "darwin") {
    return [
      join(home, "Library", "Application Support", "Hot Cross Buns 2", "config", HCB_MCP_RUNTIME_FILE_NAME),
      join(home, "Library", "Application Support", "hot-cross-buns-2", "config", HCB_MCP_RUNTIME_FILE_NAME)
    ];
  }

  return [
    join(home, ".config", "Hot Cross Buns 2", "config", HCB_MCP_RUNTIME_FILE_NAME),
    join(home, ".config", "hot-cross-buns-2", "config", HCB_MCP_RUNTIME_FILE_NAME)
  ];
}

export function parseRuntimeFile(text: string): HcbMcpRuntimeFile {
  const parsed = JSON.parse(text) as Partial<HcbMcpRuntimeFile>;

  if (
    parsed.running !== true ||
    parsed.url !== "http://127.0.0.1" ||
    typeof parsed.port !== "number" ||
    !Number.isInteger(parsed.port) ||
    parsed.port <= 0 ||
    parsed.port > 65_535 ||
    typeof parsed.pid !== "number" ||
    !Number.isInteger(parsed.pid)
  ) {
    throw new CliError("HCB MCP runtime file is invalid.");
  }

  return parsed as HcbMcpRuntimeFile;
}

export function formatResponse(command: ParsedCommand, response: McpToolResponse): string {
  if (command.command === "export-diagnostics") {
    return `${JSON.stringify(response.item ?? {}, null, 2)}\n`;
  }

  if (command.json) {
    if (isWriteCommand(command.command)) {
      return `${JSON.stringify(writeJsonOutput(command, response), null, 2)}\n`;
    }

    return `${JSON.stringify(response, null, 2)}\n`;
  }

  if (command.command === "status") {
    return formatStatus(response.item ?? {});
  }

  if (command.command === "log") {
    return formatLogs(response.items ?? []);
  }

  if (command.command === "diff") {
    return formatDiff(response.items ?? []);
  }

  if (command.command === "pending-mutations") {
    return formatDiff(response.items ?? []);
  }

  if (command.command === "doctor") {
    return formatDoctor(response.item ?? {});
  }

  if (command.command === "search") {
    return formatSearch(response.items ?? []);
  }

  if (command.command === "today") {
    return formatAgenda("HCB today", response.item ?? {});
  }

  if (command.command === "week") {
    return formatAgenda("HCB week", response.item ?? {});
  }

  if (command.command === "undo-status") {
    return formatUndoStatus(response.item ?? {});
  }

  if (command.command === "list") {
    return formatList(command.target ?? "items", response.items ?? []);
  }

  if (command.command === "get") {
    return formatDetail(command.target ?? "item", response.item ?? {});
  }

  if (isWriteCommand(command.command)) {
    return formatWrite(command, response);
  }

  return `${JSON.stringify(response.item ?? response, null, 2)}\n`;
}

function formatStatus(item: JsonObject): string {
  const account = asObject(item.account) ?? {};
  const sync = asObject(item.sync) ?? {};
  const pending = asObject(item.pendingMutations) ?? {};
  const cache = asObject(item.cache) ?? {};
  const mcp = asObject(item.mcp) ?? {};
  const build = asObject(item.build) ?? {};

  return [
    "HCB status",
    `Account: ${text(account.state)}`,
    `Sync: ${text(sync.state)} mode=${text(sync.mode)} pending=${text(sync.pendingMutationCount)}`,
    `Pending writes: total=${text(pending.totalCount)} failed=${text(pending.failedCount)} retryable=${text(pending.retryableCount)}`,
    `Cache: tasks=${text(cache.taskCount)} events=${text(cache.eventCount)} notes=${text(cache.noteCount)}`,
    `MCP: enabled=${text(mcp.enabled)} mode=${text(mcp.permissionMode)} port=${text(mcp.configuredPort)}`,
    `Build: ${text(build.appName)}@${text(build.version)} node=${text(build.nodeVersion)}`
  ].join("\n") + "\n";
}

function formatLogs(items: JsonObject[]): string {
  if (items.length === 0) {
    return "No logs.\n";
  }

  return `${items.map((item) => text(item.formattedLine) || `${text(item.timestamp)} ${text(item.level)} ${text(item.message)}`).join("\n")}\n`;
}

function formatDiff(items: JsonObject[]): string {
  if (items.length === 0) {
    return "No pending local mutations.\n";
  }

  return `${items.map((item) => [
    text(item.status),
    text(item.operation),
    `${text(item.resourceType)}/${text(item.resourceId)}`,
    `id=${text(item.id)}`,
    `attempts=${text(item.attemptCount)}`,
    item.lastErrorCode ? `error=${text(item.lastErrorCode)}` : ""
  ].filter(Boolean).join(" ")).join("\n")}\n`;
}

function formatDoctor(item: JsonObject): string {
  const status = text(item.status);
  const findings = Array.isArray(item.findings)
    ? item.findings.filter((finding): finding is JsonObject => asObject(finding) !== undefined)
    : [];
  const commands = Array.isArray(item.suggestedCommands)
    ? item.suggestedCommands.map(text).filter((command) => command !== "unknown")
    : [];
  const lines = [`HCB doctor: ${status}`];

  if (findings.length === 0) {
    lines.push("ok No findings.");
  } else {
    for (const finding of findings) {
      lines.push(`${text(finding.level)} ${text(finding.title)} - ${text(finding.detail)}`);
    }
  }

  if (commands.length > 0) {
    lines.push("", "Suggested next commands:");

    for (const command of commands) {
      lines.push(`  ${command}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatSearch(items: JsonObject[]): string {
  if (items.length === 0) {
    return "No results.\n";
  }

  const lines = [`HCB search: ${items.length} result${items.length === 1 ? "" : "s"}`];

  for (const item of items) {
    lines.push(`  ${formatCompactItem(item)}`);
  }

  return `${lines.join("\n")}\n`;
}

function formatList(target: string, items: JsonObject[]): string {
  const title = listTitle(target);

  if (items.length === 0) {
    return `${title}: 0 items\n`;
  }

  const lines = [`${title}: ${items.length} item${items.length === 1 ? "" : "s"}`];

  for (const item of items) {
    lines.push(`  ${formatCompactItem(item)}`);
  }

  return `${lines.join("\n")}\n`;
}

function formatDetail(target: string, item: JsonObject): string {
  return `HCB ${target}\n${JSON.stringify(item, null, 2)}\n`;
}

function formatUndoStatus(item: JsonObject): string {
  return [
    "HCB undo status",
    `Undo: ${item.canUndo === true ? "yes" : "no"}${optionalText(item.undoLabel) ? ` ${optionalText(item.undoLabel)}` : ""}`,
    `Redo: ${item.canRedo === true ? "yes" : "no"}${optionalText(item.redoLabel) ? ` ${optionalText(item.redoLabel)}` : ""}`
  ].join("\n") + "\n";
}

function formatWrite(command: ParsedCommand, response: McpToolResponse): string {
  const target = command.target ?? "item";
  const label = command.command === "sync-now" || command.command === "retry-mutation" || command.command === "cancel-mutation"
    ? command.command
    : command.target === undefined && (command.command === "undo" || command.command === "redo")
    ? command.command
    : `${command.command} ${target}`;
  const state = response.applied ? "applied" : response.dryRun ? "dry-run" : "preview";
  const lines = [
    `HCB ${label}: ${state}`,
    response.message,
    `Requires confirmation: ${response.requiresConfirmation}`
  ];

  if (response.confirmationId) {
    lines.push(`Confirmation id: ${response.confirmationId}`);
  }

  if (response.item) {
    lines.push(`Item: ${formatCompactItem(response.item)}`);
  }

  const applyCommand = writeApplyCommand(command, response);

  if (applyCommand) {
    lines.push(`Apply: ${applyCommand}`);
  }

  return `${lines.join("\n")}\n`;
}

function writeJsonOutput(command: ParsedCommand, response: McpToolResponse): Record<string, unknown> {
  const applyCommand = writeApplyCommand(command, response);

  return {
    tool: toolName(command),
    target: command.target ?? command.command,
    ...response,
    ...(applyCommand ? { applyCommand } : {})
  };
}

function writeApplyCommand(command: ParsedCommand, response: McpToolResponse): string | undefined {
  if (!isWriteCommand(command.command) || !response.dryRun || command.apply === true) {
    return undefined;
  }

  if (command.command === "google" && command.action === "save-oauth-client" && command.clientSecret !== undefined) {
    return undefined;
  }

  const args = writeCommandPrefix(command);

  if (command.id !== undefined) {
    args.push(command.id);
  }

  if (command.command === "create" || command.command === "rename" || command.command === "update") {
    pushFlag(args, "--title", command.title);
  }

  if ((command.command === "create" || command.command === "update") && command.target === "task") {
    pushFlag(args, "--notes", command.notes);
    pushFlagValue(args, "--due-date", command.dueDate);
    pushFlag(args, "--task-list-id", command.taskListId);
    pushFlagValue(args, "--parent-id", command.parentId);
    pushFlagValue(args, "--previous-sibling-id", command.previousSiblingId);
    pushFlag(args, "--priority", command.priority);
    pushFlagValue(args, "--planned-start", command.plannedStart);
    pushFlagValue(args, "--planned-end", command.plannedEnd);
    pushFlagValue(args, "--duration-minutes", command.durationMinutes);
    pushBooleanFlag(args, "--locked-schedule", command.lockedSchedule);
    pushFlagValue(args, "--snooze-until", command.snoozeUntil);
    pushFlag(args, "--tags", command.tags?.join(","));
  }

  if ((command.command === "create" || command.command === "update") && command.target === "note") {
    pushFlag(args, "--body", command.body);
    pushFlag(args, "--note-list-id", command.noteListId);
    pushFlag(args, "--tags", command.tags?.join(","));
  }

  if ((command.command === "create" || command.command === "update") && command.target === "event") {
    pushFlag(args, "--start-date", command.startDate);
    pushFlag(args, "--end-date", command.endDate);
    pushFlag(args, "--details", command.details);
    pushFlag(args, "--location", command.location);
    pushFlag(args, "--calendar-id", command.calendarId);
    pushFlag(args, "--guest-emails", command.guestEmails?.join(","));
    pushFlag(args, "--reminder-minutes", command.reminderMinutes?.join(","));
    pushFlag(args, "--tags", command.tags?.join(","));
    pushFlagValue(args, "--color-id", command.colorId);
    pushFlag(args, "--time-zone", command.timeZone);
    pushFlag(args, "--recurrence-frequency", command.recurrenceFrequency);
    pushFlagValue(args, "--recurrence-interval", command.recurrenceInterval);
    pushFlagValue(args, "--recurrence-ends-on", command.recurrenceEndsOn);
    pushFlagValue(args, "--recurrence-count", command.recurrenceCount);
    pushFlag(args, "--recurrence-by-day", command.recurrenceByDay?.join(","));

    if (command.allDay === true) {
      args.push("--all-day");
    }

    if (command.clearRecurrence === true) {
      args.push("--clear-recurrence");
    }
  }

  if (command.command === "convert") {
    pushFlag(args, "--to", command.to);
    pushFlag(args, "--source-action", command.sourceAction);
    pushFlag(args, "--title", command.title);
    pushFlag(args, "--notes", command.notes);
    pushFlag(args, "--body", command.body);
    pushFlag(args, "--details", command.details);
    pushFlagValue(args, "--due-date", command.dueDate);
    pushFlag(args, "--task-list-id", command.taskListId);
    pushFlag(args, "--note-list-id", command.noteListId);
    pushFlag(args, "--calendar-id", command.calendarId);
    pushFlag(args, "--start-date", command.startDate);
    pushFlag(args, "--end-date", command.endDate);

    if (command.allDay === true) {
      args.push("--all-day");
    }
  }

  if (command.command === "move") {
    pushFlag(args, "--task-list-id", command.taskListId);
    pushFlagValue(args, "--parent-id", command.parentId);
    pushFlagValue(args, "--previous-sibling-id", command.previousSiblingId);
  }

  if ((command.command === "complete" || command.command === "reopen") && command.target === "event") {
    pushFlag(args, "--scope", cliEventCompletionScope(command.eventCompletionScope));
  }

  if (command.command === "schedule") {
    pushFlag(args, "--calendar-id", command.calendarId);
    pushFlag(args, "--start-date", command.startDate);
    pushFlagValue(args, "--duration-minutes", command.durationMinutes);
  }

  if (command.command === "settings") {
    pushFlag(args, "--patch-json", command.patchJson === undefined ? undefined : JSON.stringify(command.patchJson));
  }

  if (command.command === "google") {
    pushFlag(args, "--client-id", command.clientId);
    pushFlag(args, "--client-secret", command.clientSecret);
  }

  if (command.command === "mcp") {
    pushFlag(args, "--enabled", command.enabled === undefined ? undefined : String(command.enabled));
  }

  if (command.command === "sync-now") {
    pushFlag(args, "--resources", command.resources?.join(","));

    if (command.full === true) {
      args.push("--full");
    }
  }

  args.push("--apply");
  pushFlag(args, "--confirmation-id", response.confirmationId);
  return shellJoin(args);
}

function writeCommandPrefix(command: ParsedCommand): string[] {
  if (command.command === "settings") {
    return ["pnpm", "hcb", "--", "settings", command.action ?? "update"];
  }

  if (command.command === "google") {
    return ["pnpm", "hcb", "--", "google", command.action ?? "begin-oauth"];
  }

  if (command.command === "mcp") {
    return ["pnpm", "hcb", "--", "mcp", command.action ?? "set-enabled"];
  }

  if (command.command === "undo" || command.command === "redo") {
    return ["pnpm", "hcb", "--", command.command];
  }

  if (command.command === "sync-now") {
    return ["pnpm", "hcb", "--", "sync-now"];
  }

  if (command.command === "retry-mutation" || command.command === "cancel-mutation") {
    return ["pnpm", "hcb", "--", command.command];
  }

  if (command.command === "convert") {
    return ["pnpm", "hcb", "--", "convert", command.target ?? "item"];
  }

  return ["pnpm", "hcb", "--", command.command, command.target ?? "item"];
}

function pushFlag(args: string[], flag: string, value: string | undefined): void {
  if (value === undefined) {
    return;
  }

  args.push(flag, value);
}

function pushFlagValue(args: string[], flag: string, value: string | number | null | undefined): void {
  if (value === undefined) {
    return;
  }

  args.push(flag, value === null ? "null" : String(value));
}

function pushBooleanFlag(args: string[], flag: string, value: boolean | undefined): void {
  if (value === true) {
    args.push(flag);
  }
}

function shellJoin(args: string[]): string {
  return args.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

function formatAgenda(title: string, item: JsonObject): string {
  const range = [optionalText(item.date), optionalText(item.startDate), optionalText(item.endDate)]
    .filter(Boolean)
    .join(" ");
  const lines = [range ? `${title}: ${range}` : title];
  const tasks = objectArray(item.tasks);
  const events = objectArray(item.events);
  const notes = objectArray(item.notes);

  pushSection(lines, "Tasks", tasks);
  pushSection(lines, "Events", events);
  pushSection(lines, "Notes", notes);

  if (tasks.length === 0 && events.length === 0 && notes.length === 0) {
    lines.push("No agenda items.");
  }

  return `${lines.join("\n")}\n`;
}

function pushSection(lines: string[], title: string, items: JsonObject[]): void {
  if (items.length === 0) {
    return;
  }

  lines.push(`${title}:`);

  for (const item of items) {
    lines.push(`  ${formatCompactItem(item)}`);
  }
}

function formatCompactItem(item: JsonObject): string {
  return [
    optionalText(item.kind) ?? "item",
    optionalText(item.id) ? `id=${optionalText(item.id)}` : "",
    optionalText(item.title) ?? optionalText(item.summary) ?? optionalText(item.name) ?? optionalText(item.message) ?? "Untitled",
    numberText(item.noteCount) ? `notes=${numberText(item.noteCount)}` : "",
    numberText(item.taskCount) ? `tasks=${numberText(item.taskCount)}` : "",
    optionalText(item.status) ? `status=${optionalText(item.status)}` : "",
    booleanText(item.selected) ? `selected=${booleanText(item.selected)}` : "",
    booleanText(item.isSelected) ? `selected=${booleanText(item.isSelected)}` : "",
    optionalText(item.dueDate) ? `due=${optionalText(item.dueDate)}` : "",
    optionalText(item.startDate) ? `start=${optionalText(item.startDate)}` : "",
    optionalText(item.endDate) ? `end=${optionalText(item.endDate)}` : "",
    optionalText(item.taskListTitle) ? `list=${optionalText(item.taskListTitle)}` : "",
    optionalText(item.calendarTitle) ? `calendar=${optionalText(item.calendarTitle)}` : ""
  ].filter(Boolean).join(" ");
}

function helpText(): string {
  return [
    "Usage: pnpm hcb -- <command> [options]",
    "",
    "Commands:",
    "  doctor [--json]                         run agent-friendly diagnostics",
    "  status [--json]                         show account/sync/cache/pending status",
    "  search <query> [--scope <scope>]        search tasks, notes, events, lists, calendars",
    "  today [--json]                          show today's agenda",
    "  week [--start-date <date>] [--json]     show a seven-day agenda",
    "  export-diagnostics [--json]             export redacted diagnostics JSON",
    "  undo-status [--json]                    show undo/redo availability",
    "  sync-now [options]                      dry-run immediate Google sync",
    "  pending-mutations [--limit <n>]          show pending mutation queue entries",
    "  retry-mutation <id>                     dry-run retry a pending mutation",
    "  cancel-mutation <id>                    dry-run cancel a pending mutation",
    "  list <target> [--json]                  list task-lists, calendars, or note-lists",
    "  get <kind> <id> [--json]                get a task, event, or note",
    "  create <kind> [options]                 dry-run create a task, note, event, or list",
    "  update <kind> <id> [options]            dry-run update a task, note, or event",
    "  convert <kind> <id> [options]           dry-run convert task, note, or event",
    "  rename <kind> <id> --title <title>      dry-run rename a task-list or note-list",
    "  complete <task|event> <id> [--scope s]  dry-run complete a task or event",
    "  reopen <task|event> <id> [--scope s]    dry-run reopen a task or event",
    "  move task <id> [options]                dry-run move a task",
    "  delete <kind> <id>                      dry-run delete a task, note, event, or list",
    "  undo                                    dry-run undo latest planner write",
    "  redo                                    dry-run redo latest undone planner write",
    "  schedule task <id> [options]            dry-run create a calendar block for a task",
    "  settings update --patch-json <json>     dry-run update settings",
    "  google save-oauth-client [options]      dry-run save Google OAuth client config",
    "  google begin-oauth                      dry-run start Google OAuth",
    "  mcp set-enabled <true|false>            dry-run enable or disable MCP",
    "  log [-n <limit>] [--level <level>]      show sanitized recent logs",
    "  diff [--limit <limit>] [--json]         show pending local-to-Google mutations",
    "  show <kind> [id] [--json]               show task, event, note, mutation, or diagnostics",
    "  help                                    show this help",
    "",
    "Examples:",
    "  pnpm hcb -- doctor",
    "  pnpm hcb -- search launch --scope tasks",
    "  pnpm hcb -- today",
    "  pnpm hcb -- week --start-date 2026-06-04",
    "  pnpm hcb -- export-diagnostics > hcb-diagnostics.json",
    "  pnpm hcb -- undo-status",
    "  pnpm hcb -- sync-now --resources tasks,calendar",
    "  pnpm hcb -- pending-mutations --limit 50",
    "  pnpm hcb -- retry-mutation mutation-id",
    "  pnpm hcb -- cancel-mutation mutation-id",
    "  pnpm hcb -- list task-lists",
    "  pnpm hcb -- list note-lists",
    "  pnpm hcb -- get task task-id",
    "  pnpm hcb -- create note --title 'Draft' --body 'Body' --tags reference",
    "  pnpm hcb -- create task-list --title 'Errands'",
    "  pnpm hcb -- create note --title 'Draft' --body 'Body' --apply --confirmation-id confirm-id",
    "  pnpm hcb -- update task task-id --title 'Next title'",
    "  pnpm hcb -- update task task-id --priority high --tags launch,ops",
    "  pnpm hcb -- update event event-id --tags focus --recurrence-frequency weekly --recurrence-by-day MO,WE",
    "  pnpm hcb -- convert event event-id --to task --source-action keep",
    "  pnpm hcb -- rename task-list list-id --title 'Errands'",
    "  pnpm hcb -- complete task task-id",
    "  pnpm hcb -- complete event event-id --scope occurrence",
    "  pnpm hcb -- move task task-id --task-list-id list-id",
    "  pnpm hcb -- move task task-id --parent-id parent-id --previous-sibling-id null",
    "  pnpm hcb -- delete task task-id",
    "  pnpm hcb -- delete task-list list-id",
    "  pnpm hcb -- undo",
    "  pnpm hcb -- undo --apply --confirmation-id confirm-id",
    "  pnpm hcb -- redo",
    "  pnpm hcb -- schedule task task-id --calendar-id cal-id --start-date 2026-06-04T09:00:00.000Z",
    "  pnpm hcb -- settings update --patch-json '{\"mcpEnabled\":true}'",
    "  pnpm hcb -- google begin-oauth --apply",
    "  pnpm hcb -- mcp set-enabled true",
    "  pnpm hcb -- status",
    "  pnpm hcb -- log -n 20 --level warn",
    "  pnpm hcb -- diff --json",
    "  pnpm hcb -- show task task-id"
  ].join("\n") + "\n";
}

function toolName(command: ParsedCommand): string {
  switch (command.command) {
    case "status":
      return "hcb_status";
    case "log":
      return "hcb_log";
    case "diff":
      return "hcb_diff";
    case "show":
      return "hcb_show";
    case "doctor":
      return "hcb_doctor";
    case "search":
      return "hcb_search";
    case "today":
      return "hcb_today";
    case "week":
      return "hcb_week";
    case "undo-status":
      return "hcb_undo_status";
    case "sync-now":
      return "hcb_sync_now";
    case "pending-mutations":
      return "hcb_pending_mutations";
    case "retry-mutation":
      return "hcb_retry_mutation";
    case "cancel-mutation":
      return "hcb_cancel_mutation";
    case "list":
      if (command.target === "task-lists") {
        return "hcb_list_task_lists";
      }

      if (command.target === "calendars") {
        return "hcb_list_calendars";
      }

      if (command.target === "note-lists") {
        return "hcb_list_note_lists";
      }

      throw new CliError("Unknown list target.", 2);
    case "get":
      if (command.target === "task") {
        return "hcb_get_task";
      }

      if (command.target === "event") {
        return "hcb_get_event";
      }

      if (command.target === "note") {
        return "hcb_get_note";
      }

      throw new CliError("Unknown get target.", 2);
    case "create":
      if (command.target === "task") {
        return "hcb_create_task";
      }

      if (command.target === "note") {
        return "hcb_create_note";
      }

      if (command.target === "event") {
        return "hcb_create_event";
      }

      if (command.target === "task-list") {
        return "hcb_create_task_list";
      }

      if (command.target === "note-list") {
        return "hcb_create_note_list";
      }

      throw new CliError("Unknown create target.", 2);
    case "update":
      if (command.target === "task") {
        return "hcb_update_task";
      }

      if (command.target === "note") {
        return "hcb_update_note";
      }

      if (command.target === "event") {
        return "hcb_update_event";
      }

      throw new CliError("Unknown update target.", 2);
    case "convert":
      return "hcb_convert_item";
    case "rename":
      if (command.target === "task-list") {
        return "hcb_rename_task_list";
      }

      if (command.target === "note-list") {
        return "hcb_rename_note_list";
      }

      throw new CliError("Unknown rename target.", 2);
    case "complete":
      if (command.target === "event") {
        return "hcb_complete_event";
      }

      return "hcb_complete_task";
    case "reopen":
      if (command.target === "event") {
        return "hcb_reopen_event";
      }

      return "hcb_reopen_task";
    case "move":
      return "hcb_move_task";
    case "delete":
      if (command.target === "task") {
        return "hcb_delete_task";
      }

      if (command.target === "note") {
        return "hcb_delete_note";
      }

      if (command.target === "event") {
        return "hcb_delete_event";
      }

      if (command.target === "task-list") {
        return "hcb_delete_task_list";
      }

      if (command.target === "note-list") {
        return "hcb_delete_note_list";
      }

      throw new CliError("Unknown delete target.", 2);
    case "undo":
      return "hcb_undo";
    case "redo":
      return "hcb_redo";
    case "schedule":
      return "hcb_schedule_task_block";
    case "settings":
      return "hcb_settings_update";
    case "google":
      if (command.action === "save-oauth-client") {
        return "hcb_google_save_oauth_client";
      }

      if (command.action === "begin-oauth") {
        return "hcb_google_begin_oauth";
      }

      throw new CliError("Unknown google action.", 2);
    case "mcp":
      return "hcb_mcp_set_enabled";
    default:
      throw new CliError("Help does not call MCP.");
  }
}

function isCommand(command: string): command is ParsedCommand["command"] {
  return (
    command === "status" ||
    command === "log" ||
    command === "diff" ||
    command === "show" ||
    command === "doctor" ||
    command === "search" ||
    command === "today" ||
    command === "week" ||
    command === "export-diagnostics" ||
    command === "undo-status" ||
    command === "sync-now" ||
    command === "pending-mutations" ||
    command === "retry-mutation" ||
    command === "cancel-mutation" ||
    command === "list" ||
    command === "get" ||
    command === "create" ||
    command === "update" ||
    command === "convert" ||
    command === "rename" ||
    command === "complete" ||
    command === "reopen" ||
    command === "move" ||
    command === "delete" ||
    command === "undo" ||
    command === "redo" ||
    command === "schedule" ||
    command === "settings" ||
    command === "google" ||
    command === "mcp"
  );
}

function doctorFailureResponse(message: string): McpToolResponse {
  return {
    applied: false,
    dryRun: false,
    requiresConfirmation: false,
    message: "HCB doctor found a local CLI/MCP issue.",
    item: {
      kind: "doctor",
      status: "error",
      findings: [
        {
          level: "error",
          title: "MCP unavailable",
          detail: message
        }
      ],
      suggestedCommands: [
        "Start HCB2",
        "Enable Settings > Local MCP server",
        "pnpm hcb -- status"
      ]
    }
  };
}

function runtimeFromUrl(value: string): RuntimeTarget | null {
  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || !parsed.port) {
      return null;
    }

    const port = Number(parsed.port);

    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
      return null;
    }

    return {
      url: "http://127.0.0.1",
      port
    };
  } catch {
    return null;
  }
}

function parseLimit(value: string | undefined): number {
  const limit = Number(value);

  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new CliError("Limit must be an integer from 1 to 200.", 2);
  }

  return limit;
}

function parseLevel(value: string | undefined): string {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }

  throw new CliError("Level must be one of: debug, info, warn, error.", 2);
}

function parseScope(value: string | undefined): string {
  if (value === "all" || value === "tasks" || value === "notes" || value === "events" || value === "lists" || value === "calendars") {
    return value;
  }

  throw new CliError("Scope must be one of: all, tasks, notes, events, lists, calendars.", 2);
}

function parseEventCompletionScope(value: string | undefined): string {
  if (value === "occurrence") {
    return "occurrence";
  }

  if (value === "series-future" || value === "seriesFuture") {
    return "seriesFuture";
  }

  if (value === "series-all" || value === "seriesAll") {
    return "seriesAll";
  }

  throw new CliError("Event completion scope must be one of: occurrence, series-future, series-all.", 2);
}

function cliEventCompletionScope(value: string | undefined): string | undefined {
  if (value === "seriesFuture") {
    return "series-future";
  }

  if (value === "seriesAll") {
    return "series-all";
  }

  return value;
}

function parseStartDate(value: string | undefined): string {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new CliError("Start date must be an ISO-8601 date or date-time.", 2);
  }

  return value;
}

function parseEndDate(value: string | undefined): string {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new CliError("End date must be an ISO-8601 date or date-time.", 2);
  }

  return value;
}

function parseDueDate(value: string | undefined): string | null {
  if (value === "null") {
    return null;
  }

  if (!value || Number.isNaN(Date.parse(value))) {
    throw new CliError("Due date must be an ISO-8601 date or date-time.", 2);
  }

  return value;
}

function parseNullableDateTime(value: string | undefined, flag: string): string | null {
  if (value === "null") {
    return null;
  }

  if (!value || Number.isNaN(Date.parse(value))) {
    throw new CliError(`${flag} must be an ISO-8601 date-time or null.`, 2);
  }

  return value;
}

function parseNullableDateOnly(value: string | undefined, flag: string): string | null {
  if (value === "null") {
    return null;
  }

  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CliError(`${flag} must be YYYY-MM-DD or null.`, 2);
  }

  return value;
}

function parsePriority(value: string | undefined): string {
  if (value === "none" || value === "low" || value === "medium" || value === "high") {
    return value;
  }

  throw new CliError("Priority must be one of: none, low, medium, high.", 2);
}

function parseInteger(value: string | undefined, flag: string, min: number, max: number): number {
  const number = Number(value);

  if (!Number.isInteger(number) || number < min || number > max) {
    throw new CliError(`${flag} must be an integer from ${min} to ${max}.`, 2);
  }

  return number;
}

function parseNullableInteger(value: string | undefined, flag: string, min: number, max: number): number | null {
  if (value === "null") {
    return null;
  }

  return parseInteger(value, flag, min, max);
}

function parseCsv(value: string | undefined, flag: string): string[] {
  const items = optionValue(value, flag)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (items.length === 0) {
    throw new CliError(`${flag} must contain at least one value.`, 2);
  }

  return items;
}

function parseIntegerCsv(value: string | undefined, flag: string, min: number, max: number): number[] {
  return parseCsv(value, flag).map((item) => parseInteger(item, flag, min, max));
}

function parseSyncResources(value: string | undefined): string[] {
  const resources = parseCsv(value, "--resources");
  const invalid = resources.find((resource) => resource !== "tasks" && resource !== "calendar");

  if (invalid) {
    throw new CliError("--resources must use tasks,calendar.", 2);
  }

  return Array.from(new Set(resources));
}

function parseRecurrenceFrequency(value: string | undefined): string {
  if (value === "daily" || value === "weekly" || value === "monthly" || value === "yearly") {
    return value;
  }

  throw new CliError("Recurrence frequency must be one of: daily, weekly, monthly, yearly.", 2);
}

function parseByDayCsv(value: string | undefined): string[] {
  const days = parseCsv(value, "--recurrence-by-day");
  const invalid = days.find((day) => !["SU", "MO", "TU", "WE", "TH", "FR", "SA"].includes(day));

  if (invalid) {
    throw new CliError("--recurrence-by-day must use SU,MO,TU,WE,TH,FR,SA.", 2);
  }

  return days;
}

function parsePatchJson(value: string | undefined): JsonObject {
  const text = optionValue(value, "--patch-json");
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CliError("--patch-json must be a JSON object.", 2);
  }

  if (!asObject(parsed)) {
    throw new CliError("--patch-json must be a JSON object.", 2);
  }

  return parsed as JsonObject;
}

function parseBooleanOption(value: string | undefined, flag: string): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new CliError(`${flag} must be true or false.`, 2);
}

function parseListTarget(value: string | undefined): string {
  if (value === "task-lists" || value === "calendars" || value === "note-lists") {
    return value;
  }

  throw new CliError("List target must be one of: task-lists, calendars, note-lists.", 2);
}

function parseGetTarget(value: string | undefined): string {
  if (value === "task" || value === "event" || value === "note") {
    return value;
  }

  throw new CliError("Get target must be one of: task, event, note.", 2);
}

function parseCreateTarget(value: string | undefined): string {
  if (value === "task" || value === "note" || value === "event" || value === "task-list" || value === "note-list") {
    return value;
  }

  throw new CliError("Create target must be one of: task, note, event, task-list, note-list.", 2);
}

function parseUpdateTarget(value: string | undefined): string {
  if (value === "task" || value === "note" || value === "event") {
    return value;
  }

  throw new CliError("Update target must be one of: task, note, event.", 2);
}

function parsePrimitiveTarget(value: string | undefined, label: string): string {
  if (value === "task" || value === "note" || value === "event") {
    return value;
  }

  throw new CliError(`${label} must be one of: task, note, event.`, 2);
}

function parseSourceAction(value: string | undefined): string {
  if (value === "keep" || value === "replace") {
    return value;
  }

  throw new CliError("--source-action must be keep or replace.", 2);
}

function parseRenameTarget(value: string | undefined): string {
  if (value === "task-list" || value === "note-list") {
    return value;
  }

  throw new CliError("Rename target must be one of: task-list, note-list.", 2);
}

function parseDeleteTarget(value: string | undefined): string {
  if (value === "task" || value === "note" || value === "event" || value === "task-list" || value === "note-list") {
    return value;
  }

  throw new CliError("Delete target must be one of: task, note, event, task-list, note-list.", 2);
}

function parseTaskStateTarget(value: string | undefined, command: string): string {
  if (value === "task" || value === "event") {
    return value;
  }

  throw new CliError(`${command} target must be task or event.`, 2);
}

function parseSettingsAction(value: string | undefined): string {
  if (value === "update") {
    return value;
  }

  throw new CliError("Settings action must be update.", 2);
}

function parseGoogleAction(value: string | undefined): string {
  if (value === "save-oauth-client" || value === "begin-oauth") {
    return value;
  }

  throw new CliError("Google action must be one of: save-oauth-client, begin-oauth.", 2);
}

function parseMcpAction(value: string | undefined): string {
  if (value === "set-enabled") {
    return value;
  }

  throw new CliError("MCP action must be set-enabled.", 2);
}

function optionValue(value: string | undefined, flag: string): string {
  if (!value || value.startsWith("--")) {
    throw new CliError(`Missing value for ${flag}.`, 2);
  }

  return value;
}

function parseNullableId(value: string | undefined, flag: string): string | null {
  const text = optionValue(value, flag).trim();
  return text === "null" ? null : text;
}

function hasWriteOnlyOptions(command: ParsedCommand): boolean {
  return (
    command.apply === true ||
    command.confirmationId !== undefined ||
    command.to !== undefined ||
    command.sourceAction !== undefined ||
    command.title !== undefined ||
    command.notes !== undefined ||
    command.dueDate !== undefined ||
    command.taskListId !== undefined ||
    command.parentId !== undefined ||
    command.previousSiblingId !== undefined ||
    command.priority !== undefined ||
    command.plannedStart !== undefined ||
    command.plannedEnd !== undefined ||
    command.durationMinutes !== undefined ||
    command.lockedSchedule === true ||
    command.snoozeUntil !== undefined ||
    command.tags !== undefined ||
    command.noteListId !== undefined ||
    command.body !== undefined ||
    command.details !== undefined ||
    command.endDate !== undefined ||
    command.location !== undefined ||
    command.calendarId !== undefined ||
    command.allDay === true ||
    command.guestEmails !== undefined ||
    command.reminderMinutes !== undefined ||
    command.colorId !== undefined ||
    command.timeZone !== undefined ||
    command.resources !== undefined ||
    command.full === true ||
    command.recurrenceFrequency !== undefined ||
    command.recurrenceInterval !== undefined ||
    command.recurrenceEndsOn !== undefined ||
    command.recurrenceCount !== undefined ||
    command.recurrenceByDay !== undefined ||
    command.clearRecurrence === true ||
    command.eventCompletionScope !== undefined ||
    command.patchJson !== undefined ||
    command.clientId !== undefined ||
    command.clientSecret !== undefined ||
    command.enabled !== undefined
  );
}

function isWriteCommand(command: ParsedCommand["command"]): boolean {
  return (
    command === "create" ||
    command === "sync-now" ||
    command === "retry-mutation" ||
    command === "cancel-mutation" ||
    command === "update" ||
    command === "convert" ||
    command === "rename" ||
    command === "complete" ||
    command === "reopen" ||
    command === "move" ||
    command === "delete" ||
    command === "undo" ||
    command === "redo" ||
    command === "schedule" ||
    command === "settings" ||
    command === "google" ||
    command === "mcp"
  );
}

function validateCreateCommand(command: ParsedCommand): void {
  if (command.limit !== undefined) {
    throw new CliError("--limit is not supported by create.", 2);
  }

  if (command.level !== undefined) {
    throw new CliError("--level is not supported by create.", 2);
  }

  command.title = requiredCreateText(command.title, "--title", command.target ?? "item");

  if (command.target === "task") {
    rejectCreateOptions(command, ["body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "noteListId", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled"]);
    return;
  }

  if (command.target === "note") {
    rejectCreateOptions(command, ["notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled"]);
    return;
  }

  if (command.target === "event") {
    rejectCreateOptions(command, ["notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "lockedSchedule", "snoozeUntil", "noteListId", "body", "patchJson", "clientId", "clientSecret", "enabled"]);
    command.startDate = requiredCreateText(command.startDate, "--start-date", "event");
    validateRecurrenceCommand(command);
    validateCreateEventDates(command);
    return;
  }

  if (command.target === "task-list" || command.target === "note-list") {
    rejectCreateOptions(command, ["notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled"]);
  }
}

function validateUpdateCommand(command: ParsedCommand): void {
  rejectReadOptions(command, "update");

  if (command.target === "task") {
    rejectCreateOptions(command, ["body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "noteListId", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled"]);
    requireAnyUpdateField(command, ["title", "notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags"], "task");
    command.title = optionalCreateText(command.title, "--title", "task");
    return;
  }

  if (command.target === "note") {
    rejectCreateOptions(command, ["notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled"]);
    requireAnyUpdateField(command, ["title", "body", "noteListId", "tags"], "note");
    command.title = optionalCreateText(command.title, "--title", "note");
    return;
  }

  if (command.target === "event") {
    rejectCreateOptions(command, ["notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "lockedSchedule", "snoozeUntil", "noteListId", "body", "patchJson", "clientId", "clientSecret", "enabled"]);
    requireAnyUpdateField(command, ["title", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "tags", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence"], "event");
    command.title = optionalCreateText(command.title, "--title", "event");
    validateRecurrenceCommand(command);
    validateUpdateEventDates(command);
  }
}

function validateConvertCommand(command: ParsedCommand): void {
  rejectReadOptions(command, "convert");

  if (!command.to) {
    throw new CliError("Missing required --to for convert.", 2);
  }

  if (!command.sourceAction) {
    throw new CliError("Missing required --source-action for convert.", 2);
  }

  if (command.target === command.to) {
    throw new CliError("Convert source and target must differ.", 2);
  }

  if (command.endDate !== undefined && command.startDate !== undefined && Date.parse(command.endDate) <= Date.parse(command.startDate)) {
    throw new CliError("--end-date must be after --start-date.", 2);
  }

  rejectUnsupportedOptions(command, "convert", ["parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled"]);
  command.title = optionalCreateText(command.title, "--title", "convert");
}

function validateRenameCommand(command: ParsedCommand): void {
  rejectReadOptions(command, "rename");
  command.title = requiredCreateText(command.title, "--title", command.target ?? "item");
  rejectCreateOptions(command, ["notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled"]);
}

function validateTaskStateCommand(command: ParsedCommand): void {
  rejectReadOptions(command, command.command);
  rejectCreateOptions(command, ["title", "notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled"]);
}

function validateMoveCommand(command: ParsedCommand): void {
  rejectReadOptions(command, "move");
  requireAnyUpdateField(command, ["taskListId", "parentId", "previousSiblingId"], "move task");
  rejectCreateOptions(command, ["title", "notes", "dueDate", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled"]);
}

function validateDeleteCommand(command: ParsedCommand): void {
  rejectReadOptions(command, "delete");
  rejectCreateOptions(command, ["title", "notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled"]);
}

function validateUndoStatusCommand(command: ParsedCommand): void {
  rejectReadOptions(command, "undo-status");
  rejectUnsupportedOptions(command, "undo-status", ["apply", "confirmationId", "title", "notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled"]);
}

function validateSyncNowCommand(command: ParsedCommand): void {
  rejectReadOptions(command, "sync-now");
  rejectUnsupportedOptions(command, "sync-now", ["title", "notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled"]);
}

function validatePendingMutationsCommand(command: ParsedCommand): void {
  if (command.level !== undefined) {
    throw new CliError("--level is not supported by pending-mutations.", 2);
  }

  rejectUnsupportedOptions(command, "pending-mutations", ["apply", "confirmationId", "title", "notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "resources", "full", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled"]);
}

function validatePendingMutationActionCommand(command: ParsedCommand): void {
  rejectReadOptions(command, command.command);
  rejectUnsupportedOptions(command, command.command, ["title", "notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "resources", "full", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled"]);
}

function validateUndoRedoCommand(command: ParsedCommand): void {
  rejectReadOptions(command, command.command);
  rejectUnsupportedOptions(command, command.command, ["title", "notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled"]);
}

function validateScheduleCommand(command: ParsedCommand): void {
  rejectReadOptions(command, "schedule");
  command.calendarId = requiredCreateText(command.calendarId, "--calendar-id", "schedule task");
  command.startDate = requiredCreateText(command.startDate, "--start-date", "schedule task");
  rejectCreateOptions(command, ["title", "notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "endDate", "location", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled"]);
}

function validateSettingsCommand(command: ParsedCommand): void {
  rejectReadOptions(command, "settings");

  if (command.patchJson === undefined) {
    throw new CliError("Missing required --patch-json for settings update.", 2);
  }

  rejectCreateOptions(command, ["title", "notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "clientId", "clientSecret", "enabled"]);
}

function validateGoogleCommand(command: ParsedCommand): void {
  rejectReadOptions(command, "google");

  if (command.action === "save-oauth-client" && command.clientId === undefined) {
    throw new CliError("Missing required --client-id for google save-oauth-client.", 2);
  }

  if (command.action === "begin-oauth") {
    rejectCreateOptions(command, ["clientId", "clientSecret"]);
  }

  rejectCreateOptions(command, ["title", "notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "enabled"]);
}

function validateMcpCommand(command: ParsedCommand): void {
  rejectReadOptions(command, "mcp");

  if (command.enabled === undefined) {
    throw new CliError("Missing required enabled value for mcp set-enabled.", 2);
  }

  rejectCreateOptions(command, ["title", "notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret"]);
}

function validateRecurrenceCommand(command: ParsedCommand): void {
  const hasRecurrence =
    command.recurrenceFrequency !== undefined ||
    command.recurrenceInterval !== undefined ||
    command.recurrenceEndsOn !== undefined ||
    command.recurrenceCount !== undefined ||
    command.recurrenceByDay !== undefined;

  if (command.clearRecurrence === true && hasRecurrence) {
    throw new CliError("--clear-recurrence cannot be combined with recurrence fields.", 2);
  }

  if (hasRecurrence && command.recurrenceFrequency === undefined) {
    throw new CliError("--recurrence-frequency is required when recurrence fields are supplied.", 2);
  }
}

function rejectReadOptions(command: ParsedCommand, name: string): void {
  if (command.limit !== undefined) {
    throw new CliError(`--limit is not supported by ${name}.`, 2);
  }

  if (command.level !== undefined) {
    throw new CliError(`--level is not supported by ${name}.`, 2);
  }
}

function rejectUnsupportedOptions(command: ParsedCommand, name: string, keys: Array<keyof ParsedCommand>): void {
  for (const key of keys) {
    const value = command[key];

    if (value !== undefined && value !== false) {
      throw new CliError(`${flagForKey(key)} is not supported by ${name}.`, 2);
    }
  }
}

function requireAnyUpdateField(command: ParsedCommand, keys: Array<keyof ParsedCommand>, target: string): void {
  if (keys.some((key) => command[key] !== undefined && command[key] !== false)) {
    return;
  }

  throw new CliError(`At least one update field is required for update ${target}.`, 2);
}

function optionalCreateText(value: string | undefined, flag: string, target: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requiredCreateText(value, flag, target);
}

function validateCreateEventDates(command: ParsedCommand): void {
  if (command.allDay === true) {
    if (!isDateOnly(command.startDate)) {
      throw new CliError("--all-day requires --start-date as YYYY-MM-DD.", 2);
    }

    if (command.endDate !== undefined && !isDateOnly(command.endDate)) {
      throw new CliError("--all-day requires --end-date as YYYY-MM-DD.", 2);
    }
  }

  if (command.endDate !== undefined && Date.parse(command.endDate) < Date.parse(command.startDate ?? "")) {
    throw new CliError("--end-date must not be before --start-date.", 2);
  }
}

function validateUpdateEventDates(command: ParsedCommand): void {
  if (command.allDay === true) {
    if (command.startDate !== undefined && !isDateOnly(command.startDate)) {
      throw new CliError("--all-day requires --start-date as YYYY-MM-DD when supplied.", 2);
    }

    if (command.endDate !== undefined && !isDateOnly(command.endDate)) {
      throw new CliError("--all-day requires --end-date as YYYY-MM-DD when supplied.", 2);
    }
  }

  if (command.startDate !== undefined && command.endDate !== undefined && Date.parse(command.endDate) < Date.parse(command.startDate)) {
    throw new CliError("--end-date must not be before --start-date.", 2);
  }
}

function isDateOnly(value: string | undefined): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function updatePatch(command: ParsedCommand): JsonObject {
  const patch: JsonObject = {};

  if (command.title !== undefined) {
    patch.title = command.title;
  }

  if (command.notes !== undefined) {
    patch.notes = command.notes;
  }

  if (command.dueDate !== undefined) {
    patch.dueDate = command.dueDate;
  }

  if (command.taskListId !== undefined) {
    patch.taskListId = command.taskListId;
  }

  if (command.parentId !== undefined) {
    patch.parentId = command.parentId;
  }

  if (command.previousSiblingId !== undefined) {
    patch.previousSiblingId = command.previousSiblingId;
  }

  if (command.priority !== undefined) {
    patch.priority = command.priority;
  }

  if (command.plannedStart !== undefined) {
    patch.plannedStart = command.plannedStart;
  }

  if (command.plannedEnd !== undefined) {
    patch.plannedEnd = command.plannedEnd;
  }

  if (command.durationMinutes !== undefined) {
    patch.durationMinutes = command.durationMinutes;
  }

  if (command.lockedSchedule === true) {
    patch.lockedSchedule = true;
  }

  if (command.snoozeUntil !== undefined) {
    patch.snoozeUntil = command.snoozeUntil;
  }

  if (command.tags !== undefined) {
    patch.tags = command.tags;
  }

  if (command.body !== undefined) {
    patch.body = command.body;
  }

  if (command.noteListId !== undefined) {
    patch.noteListId = command.noteListId;
  }

  if (command.details !== undefined) {
    patch.details = command.details;
  }

  if (command.startDate !== undefined) {
    patch.startDate = command.startDate;
  }

  if (command.endDate !== undefined) {
    patch.endDate = command.endDate;
  }

  if (command.location !== undefined) {
    patch.location = command.location;
  }

  if (command.calendarId !== undefined) {
    patch.calendarId = command.calendarId;
  }

  if (command.allDay === true) {
    patch.isAllDay = true;
  }

  if (command.guestEmails !== undefined) {
    patch.guestEmails = command.guestEmails;
  }

  if (command.reminderMinutes !== undefined) {
    patch.reminderMinutes = command.reminderMinutes;
  }

  if (command.colorId !== undefined) {
    patch.colorId = command.colorId;
  }

  if (command.timeZone !== undefined) {
    patch.timeZone = command.timeZone;
  }

  const recurrence = recurrenceInput(command);

  if (recurrence !== undefined) {
    patch.recurrence = recurrence;
  }

  return patch;
}

function recurrenceInput(command: ParsedCommand): JsonObject | null | undefined {
  if (command.clearRecurrence === true) {
    return null;
  }

  if (command.recurrenceFrequency === undefined) {
    return undefined;
  }

  return {
    frequency: command.recurrenceFrequency,
    interval: command.recurrenceInterval ?? 1,
    ...(command.recurrenceEndsOn === undefined ? {} : { endsOn: command.recurrenceEndsOn }),
    ...(command.recurrenceCount === undefined ? {} : { count: command.recurrenceCount }),
    ...(command.recurrenceByDay === undefined ? {} : { byDay: command.recurrenceByDay })
  };
}

function requiredCreateText(value: string | undefined, flag: string, target: string): string {
  const trimmed = optionalText(value);

  if (!trimmed) {
    throw new CliError(`Missing required ${flag} for create ${target}.`, 2);
  }

  return trimmed;
}

function rejectCreateOptions(command: ParsedCommand, keys: Array<keyof ParsedCommand>): void {
  for (const key of keys) {
    const value = command[key];

    if (value !== undefined && value !== false) {
      throw new CliError(`${flagForKey(key)} is not supported by create ${command.target}.`, 2);
    }
  }
}

function flagForKey(key: keyof ParsedCommand): string {
  switch (key) {
    case "taskListId":
      return "--task-list-id";
    case "startDate":
      return "--start-date";
    case "endDate":
      return "--end-date";
    case "dueDate":
      return "--due-date";
    case "calendarId":
      return "--calendar-id";
    case "allDay":
      return "--all-day";
    case "parentId":
      return "--parent-id";
    case "previousSiblingId":
      return "--previous-sibling-id";
    case "plannedStart":
      return "--planned-start";
    case "plannedEnd":
      return "--planned-end";
    case "durationMinutes":
      return "--duration-minutes";
    case "lockedSchedule":
      return "--locked-schedule";
    case "snoozeUntil":
      return "--snooze-until";
    case "noteListId":
      return "--note-list-id";
    case "guestEmails":
      return "--guest-emails";
    case "reminderMinutes":
      return "--reminder-minutes";
    case "colorId":
      return "--color-id";
    case "timeZone":
      return "--time-zone";
    case "recurrenceFrequency":
      return "--recurrence-frequency";
    case "recurrenceInterval":
      return "--recurrence-interval";
    case "recurrenceEndsOn":
      return "--recurrence-ends-on";
    case "recurrenceCount":
      return "--recurrence-count";
    case "recurrenceByDay":
      return "--recurrence-by-day";
    case "clearRecurrence":
      return "--clear-recurrence";
    case "patchJson":
      return "--patch-json";
    case "clientId":
      return "--client-id";
    case "clientSecret":
      return "--client-secret";
    case "confirmationId":
      return "--confirmation-id";
    default:
      return `--${String(key)}`;
  }
}

function listTitle(target: string): string {
  if (target === "task-lists") {
    return "HCB task lists";
  }

  if (target === "calendars") {
    return "HCB calendars";
  }

  if (target === "note-lists") {
    return "HCB note lists";
  }

  return "HCB items";
}

function tokenProvider(dependencies: HcbCliDependencies): () => Promise<string> {
  return dependencies.tokenProvider ?? (() =>
    new KeychainMcpCredentialAdapter(new MacOsKeychainSecretStore()).loadBearerToken());
}

function fetchImpl(dependencies: HcbCliDependencies): FetchLike {
  const fetchLike = dependencies.fetch ?? globalThis.fetch;

  if (!fetchLike) {
    throw new CliError("Fetch API is unavailable in this Node runtime.");
  }

  return fetchLike as FetchLike;
}

function pidExists(dependencies: HcbCliDependencies): (pid: number) => boolean {
  return dependencies.pidExists ?? ((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      const code = (error as { code?: string }).code;
      return code === "EPERM";
    }
  });
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function objectArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is JsonObject => asObject(item) !== undefined);
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const output = String(value).trim();
  return output.length === 0 ? undefined : output;
}

function numberText(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function booleanText(value: unknown): string | undefined {
  return typeof value === "boolean" ? String(value) : undefined;
}

function text(value: unknown): string {
  if (value === undefined || value === null) {
    return "unknown";
  }

  return String(value);
}
