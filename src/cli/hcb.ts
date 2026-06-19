import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { HCB_MCP_RUNTIME_FILE_NAME, type HcbMcpRuntimeFile } from "@shared/mcpRuntime";
import { MacOsKeychainSecretStore } from "@main/credentials/secretStore";
import { KeychainMcpCredentialAdapter } from "@main/mcp/keychainCredentials";
import type { JsonObject, McpToolResponse } from "@main/mcp/types";

interface Output {
  write: (chunk: string | Uint8Array) => boolean;
  columns?: number;
  rows?: number;
  on?: (event: "resize", listener: () => void) => unknown;
  off?: (event: "resize", listener: () => void) => unknown;
}

interface TuiInput {
  isTTY?: boolean;
  on: (event: "data", listener: (chunk: Buffer | string) => void) => unknown;
  off: (event: "data", listener: (chunk: Buffer | string) => void) => unknown;
  setRawMode?: (enabled: boolean) => unknown;
  resume: () => unknown;
  pause: () => unknown;
}

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
  stdin?: TuiInput;
  fetch?: FetchLike;
  tokenProvider?: () => Promise<string>;
  safeStorageTokenLoader?: (input: SafeStorageMcpTokenLoaderInput) => Promise<string>;
  runtimeFilePaths?: string[];
  pidExists?: (pid: number) => boolean;
  platform?: NodeJS.Platform | string;
}

export interface SafeStorageMcpTokenLoaderInput {
  platform: NodeJS.Platform | string;
  secretStoreFiles: string[];
  helperBinary?: string;
  helperPath: string;
  env: NodeJS.ProcessEnv;
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
    | "brief"
    | "plan"
    | "tail"
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
    | "backend"
    | "vault"
    | "google"
    | "mcp"
    | "hoster"
    | "tui"
    | "completion"
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
  name?: string;
  permissionMode?: string;
  out?: string;
  path?: string;
  endpoint?: string;
  privatePayload?: boolean;
  passphraseEnv?: string;
  shell?: "bash" | "zsh" | "fish";
  toolName?: string;
  argumentsJson?: JsonObject;
  requestId?: string;
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

    if (command.command === "completion") {
      stdout.write(completionScript(command.shell ?? "bash"));
      return 0;
    }

    if (command.command === "tui") {
      await runHcbTui(command, dependencies);
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

    if (arg === "--name") {
      const value = args[index + 1];
      index += 1;
      parsed.name = optionValue(value, "--name");
      continue;
    }

    if (arg === "--permission-mode") {
      const value = args[index + 1];
      index += 1;
      parsed.permissionMode = parsePermissionMode(value);
      continue;
    }

    if (arg === "--out") {
      const value = args[index + 1];
      index += 1;
      parsed.out = optionValue(value, "--out");
      continue;
    }

    if (arg === "--path") {
      const value = args[index + 1];
      index += 1;
      parsed.path = optionValue(value, "--path");
      continue;
    }

    if (arg === "--endpoint") {
      const value = args[index + 1];
      index += 1;
      parsed.endpoint = optionValue(value, "--endpoint");
      continue;
    }

    if (arg === "--private") {
      parsed.privatePayload = true;
      continue;
    }

    if (arg === "--passphrase-env") {
      const value = args[index + 1];
      index += 1;
      parsed.passphraseEnv = optionValue(value, "--passphrase-env");
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

    if (arg === "--arguments-json") {
      const value = args[index + 1];
      index += 1;
      parsed.argumentsJson = parsePatchJson(value);
      continue;
    }

    if (arg === "--tool") {
      const value = args[index + 1];
      index += 1;
      parsed.toolName = optionValue(value, "--tool");
      continue;
    }

    if (arg === "--request-id") {
      const value = args[index + 1];
      index += 1;
      parsed.requestId = optionValue(value, "--request-id");
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
  } else if (command === "brief" || command === "plan" || command === "tail") {
    if (positional.length !== 0) {
      throw new CliError(`Usage: pnpm hcb -- ${command} [options]`, 2);
    }
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
  } else if (command === "backend") {
    parsed.action = parseBackendAction(positional[0]);
    parsed.target = positional[1] ?? "backend";

    const validPositionalCount =
      parsed.action === "status" ? positional.length === 1 :
      parsed.action === "set" ? positional.length === 2 :
      false;

    if (!validPositionalCount) {
      throw new CliError("Usage: pnpm hcb -- backend <status|set> [google|hcb-local|hcb-hoster] [--endpoint <url>] [--apply]", 2);
    }

    validateBackendCommand(parsed);
  } else if (command === "vault") {
    parsed.action = parseVaultAction(positional[0]);
    parsed.target = "vault";

    if (parsed.action === "import") {
      parsed.path = parsed.path ?? positional[1];
    }

    const validPositionalCount =
      parsed.action === "export" ? positional.length === 1 :
      parsed.action === "import" && parsed.path !== undefined ? positional.length === 1 || positional.length === 2 :
      false;

    if (!validPositionalCount) {
      throw new CliError("Usage: pnpm hcb -- vault <export|import> --passphrase-env <env> [--out <path>|--path <path>] [--apply]", 2);
    }

    validateVaultCommand(parsed);
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
  } else if (command === "hoster") {
    parsed.action = parseHosterAction(positional[0]);
    parsed.target = "hoster";

    if (parsed.action === "export" || parsed.action === "remove" || parsed.action === "test" || parsed.action === "signal") {
      parsed.id = positional[1];
    }

    if (parsed.action === "import") {
      parsed.path = parsed.path ?? positional[1];
    }

    const validPositionalCount =
      (parsed.action === "status" || parsed.action === "create") ? positional.length === 1 :
      parsed.action === "test" ? positional.length === 1 || positional.length === 2 :
      parsed.action === "signal" ? positional.length === 2 :
      parsed.action === "import" && parsed.path !== undefined ? positional.length === 1 || positional.length === 2 :
      positional.length === 2;

    if (!validPositionalCount) {
      throw new CliError("Usage: pnpm hcb -- hoster <status|create|export|import|remove|test> [options]", 2);
    }

    validateHosterCommand(parsed);
  } else if (command === "tui") {
    if (positional.length !== 0) {
      throw new CliError("Usage: pnpm hcb -- tui", 2);
    }
  } else if (command === "completion") {
    parsed.shell = parseCompletionShell(positional[0] ?? "bash");
    if (positional.length > 1) {
      throw new CliError("Usage: hcb completion [bash|zsh|fish]", 2);
    }
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

  if ((parsed.toolName !== undefined || parsed.argumentsJson !== undefined || parsed.requestId !== undefined) && !(command === "hoster" && parsed.action === "signal")) {
    throw new CliError("--tool, --arguments-json, and --request-id are only supported by hoster signal.", 2);
  }

  if ((parsed.to !== undefined || parsed.sourceAction !== undefined) && command !== "convert") {
    throw new CliError("--to and --source-action are only supported by convert.", 2);
  }

  if (parsed.startDate !== undefined && command !== "week" && command !== "plan" && command !== "create" && command !== "update" && command !== "schedule" && command !== "convert") {
    throw new CliError(`--start-date is only supported by week, plan, create event, update event, schedule task, and convert.`, 2);
  }

  if (parsed.logLimit !== undefined && command !== "doctor" && command !== "export-diagnostics") {
    throw new CliError("--log-limit is only supported by doctor and export-diagnostics.", 2);
  }

  if (parsed.mutationLimit !== undefined && command !== "doctor" && command !== "brief" && command !== "export-diagnostics") {
    throw new CliError("--mutation-limit is only supported by doctor, brief, and export-diagnostics.", 2);
  }

  if (parsed.resources !== undefined && command !== "sync-now") {
    throw new CliError("--resources is only supported by sync-now.", 2);
  }

  if (parsed.full === true && command !== "sync-now") {
    throw new CliError("--full is only supported by sync-now.", 2);
  }

  if (
    (parsed.name !== undefined ||
      parsed.permissionMode !== undefined ||
      parsed.out !== undefined ||
      parsed.path !== undefined ||
      parsed.endpoint !== undefined ||
      parsed.privatePayload !== undefined ||
      parsed.passphraseEnv !== undefined) &&
    command !== "hoster" &&
    command !== "backend" &&
    command !== "vault"
  ) {
    throw new CliError("--name, --permission-mode, --out, --path, --endpoint, --private, and --passphrase-env are only supported by hoster/backend/vault.", 2);
  }

  if (hasWriteOnlyOptions(parsed) && !isCliWriteCommand(parsed)) {
    throw new CliError("Write options are only supported by sync-now, retry-mutation, cancel-mutation, create, update, convert, rename, complete, reopen, move, delete, undo, redo, schedule, settings, backend, vault, google, and mcp.", 2);
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

  if (command.command === "hoster" && command.action === "signal") {
    return callHosterSignal(command, dependencies);
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

  if ((command.command === "week" || command.command === "plan") && command.startDate !== undefined) {
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

  if (isCliWriteCommand(command)) {
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

  if (command.command === "backend") {
    if (command.action === "set") {
      args.backend = command.target ?? "google";
    }

    if (command.endpoint !== undefined) {
      args.endpoint = command.endpoint;
    }
  }

  if (command.command === "vault") {
    if (command.out !== undefined) {
      args.out = command.out;
    }

    if (command.path !== undefined) {
      args.path = command.path;
    }

    if (command.passphraseEnv !== undefined) {
      args.passphrase = passphraseFromEnv(command.passphraseEnv, dependencies.env ?? process.env);
    }
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

  if (command.command === "hoster") {
    if (command.id !== undefined) {
      args.id = command.id;
    }

    if (command.name !== undefined) {
      args.name = command.name;
    }

    if (command.permissionMode !== undefined) {
      args.permissionMode = command.permissionMode;
    }

    if (command.out !== undefined) {
      args.out = command.out;
    }

    if (command.path !== undefined) {
      args.path = command.path;
    }

    if (command.privatePayload === true) {
      args.privatePayload = true;
    }

    if (command.passphraseEnv !== undefined) {
      args.passphrase = passphraseFromEnv(command.passphraseEnv, dependencies.env ?? process.env);
    }
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

async function callHosterSignal(
  command: ParsedCommand,
  dependencies: HcbCliDependencies = {}
): Promise<McpToolResponse> {
  const id = command.id ?? "";
  const toolName = command.toolName ?? "";
  if (!id) {
    throw new CliError("hoster signal requires <id>.", 2);
  }
  if (!toolName) {
    throw new CliError("hoster signal requires --tool <name>.", 2);
  }
  const target = discoverRuntime(dependencies);
  const token = await tokenProvider(dependencies)();
  const status = await callMcpToolWithAuth("hcb_hoster_status", {}, dependencies, target, token);
  const hosterStatus = asObject(status.item) ?? {};
  const profile = objectArray(hosterStatus.profiles).find((item) => item.id === id);
  const endpoint = typeof profile?.endpoint === "string" ? profile.endpoint : undefined;
  if (!endpoint) {
    throw new CliError(`Hoster profile ${id} was not found or has no endpoint.`, 1);
  }
  const payload = {
    formatVersion: 1,
    requestId: command.requestId ?? `cli:${Date.now()}`,
    createdAt: new Date().toISOString(),
    toolName,
    arguments: command.argumentsJson ?? {}
  };
  const response = await fetchImpl(dependencies)(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "hcb-cli/1.0"
    },
    body: JSON.stringify({
      profileId: id,
      payload
    })
  });
  const textBody = await response.text();
  let body: JsonObject = {};
  try {
    body = JSON.parse(textBody) as JsonObject;
  } catch {
    body = { body: textBody };
  }
  if (response.status < 200 || response.status >= 300) {
    throw new CliError(`Hoster signal failed with HTTP ${response.status}: ${textBody}`, 1);
  }

  return {
    applied: false,
    dryRun: false,
    requiresConfirmation: false,
    message: "Sent local hoster signal.",
    item: {
      kind: "hosterSignal",
      status: response.status,
      profileId: id,
      requestId: payload.requestId,
      response: body
    }
  };
}

async function runHcbTui(
  _command: ParsedCommand,
  dependencies: HcbCliDependencies = {}
): Promise<void> {
  const stdout = dependencies.stdout ?? process.stdout;
  const env = dependencies.env ?? process.env;
  const stdin = dependencies.stdin ?? process.stdin;
  const target = discoverRuntime(dependencies);
  const token = await tokenProvider(dependencies)();
  const call = (name: string, args: JsonObject) =>
    callMcpToolWithAuth(name, args, dependencies, target, token);
  const state = initialTuiState();
  state.viewport = tuiViewport(stdout);
  await refreshTuiState(state, call);
  stdout.write(formatTuiScreen(state));

  if (env.HCB_TUI_ONCE === "1" || !stdin.isTTY) {
    return;
  }

  await new Promise<void>((resolve) => {
    const render = () => {
      state.viewport = tuiViewport(stdout);
      stdout.write(formatTuiScreen(state));
    };
    const onResize = () => render();
    const onData = (chunk: Buffer | string) => {
      const inputs = splitTuiInput(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      void (async () => {
        for (const value of inputs) {
          if (value === "\u0003" || (!state.commandMode && value === "q")) {
            cleanup();
            resolve();
            return;
          }
          await handleTuiInput(value, state, call, env);
        }
        render();
      })().catch((error) => {
        state.message = error instanceof Error ? error.message : String(error);
        render();
      });
    };
    const cleanup = () => {
      stdin.off("data", onData);
      stdout.off?.("resize", onResize);
      stdin.setRawMode?.(false);
      stdin.pause();
      stdout.write("\x1b[?25h\x1b[0m\n");
    };

    stdout.write("\x1b[?25l");
    stdout.on?.("resize", onResize);
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

type TuiView = "status" | "backend" | "today" | "week" | "search" | "logs" | "mutations" | "hosters";
type TuiCall = (name: string, args: JsonObject) => Promise<McpToolResponse>;

interface TuiPendingApply {
  label: string;
  tool: string;
  args: JsonObject;
  confirmationId?: string;
}

interface TuiViewport {
  width: number;
  height: number;
}

interface TuiState {
  views: TuiView[];
  view: TuiView;
  selected: Record<TuiView, number>;
  commandMode: boolean;
  commandBuffer: string;
  commandHistory: string[];
  commandHistoryIndex: number | null;
  message: string;
  searchQuery: string;
  searchScope?: string;
  searchLimit: number;
  logLevel: string;
  logLimit: number;
  viewport: TuiViewport;
  data: {
    status: JsonObject;
    today: JsonObject;
    week: JsonObject;
    search: JsonObject[];
    logs: JsonObject[];
    mutations: JsonObject[];
    backend: JsonObject;
    hosters: JsonObject;
  };
  pendingApply?: TuiPendingApply;
}

function initialTuiState(): TuiState {
  const views: TuiView[] = ["status", "backend", "today", "week", "search", "logs", "mutations", "hosters"];
  return {
    views,
    view: "status",
    selected: {
      status: 0,
      backend: 0,
      today: 0,
      week: 0,
      search: 0,
      logs: 0,
      mutations: 0,
      hosters: 0
    },
    commandMode: false,
    commandBuffer: "",
    commandHistory: [],
    commandHistoryIndex: null,
    message: "r refresh | / search | : command | tab switch | enter detail | q quit",
    searchQuery: "",
    searchLimit: 25,
    logLevel: "warn",
    logLimit: 50,
    viewport: { width: 120, height: 32 },
    data: {
      status: {},
      today: {},
      week: {},
      search: [],
      logs: [],
      mutations: [],
      backend: {},
      hosters: {}
    }
  };
}

async function refreshTuiState(state: TuiState, call: TuiCall): Promise<void> {
  const [status, backend, today, week, mutations, logs, hosters] = await Promise.all([
    call("hcb_status", {}),
    call("hcb_backend_status", {}),
    call("hcb_today", {}),
    call("hcb_week", {}),
    call("hcb_pending_mutations", { limit: 50 }),
    call("hcb_log", { limit: state.logLimit, level: state.logLevel }),
    call("hcb_hoster_status", {})
  ]);
  state.data.status = status.item ?? {};
  state.data.backend = backend.item ?? {};
  state.data.today = today.item ?? {};
  state.data.week = week.item ?? {};
  state.data.mutations = mutations.items ?? [];
  state.data.logs = logs.items ?? [];
  state.data.hosters = hosters.item ?? {};
  if (state.searchQuery) {
    const search = await call("hcb_search", {
      query: state.searchQuery,
      limit: state.searchLimit,
      ...(state.searchScope === undefined ? {} : { scope: state.searchScope })
    });
    state.data.search = search.items ?? [];
  }
  state.message = `refreshed ${new Date().toLocaleTimeString()}`;
  clampTuiSelection(state);
}

async function handleTuiInput(
  value: string,
  state: TuiState,
  call: TuiCall,
  env: NodeJS.ProcessEnv
): Promise<void> {
  if (state.commandMode) {
    await handleTuiCommandInput(value, state, call, env);
    return;
  }

  if (value === "\t" || value === "\x1b[C") {
    moveTuiView(state, 1);
    return;
  }
  if (value === "\x1b[D") {
    moveTuiView(state, -1);
    return;
  }
  if (value === "\x1b[A" || value === "k") {
    state.selected[state.view] = Math.max(0, state.selected[state.view] - 1);
    return;
  }
  if (value === "\x1b[B" || value === "j") {
    state.selected[state.view] = Math.min(tuiRows(state).length - 1, state.selected[state.view] + 1);
    return;
  }
  if (value === "r") {
    await refreshTuiState(state, call);
    return;
  }
  if (value === "/") {
    state.commandMode = true;
    state.commandBuffer = "search ";
    state.message = "type search query, enter to run";
    return;
  }
  if (value === ":") {
    state.commandMode = true;
    state.commandBuffer = "";
    state.message = "commands: search/logs/mutation/hoster/apply/view";
    return;
  }
  if (value === "\r" || value === "\n") {
    const row = selectedTuiRow(state);
    state.message = row ? row.label : "No selected row.";
  }
}

async function handleTuiCommandInput(
  value: string,
  state: TuiState,
  call: TuiCall,
  env: NodeJS.ProcessEnv
): Promise<void> {
  if (value === "\u0003" || value === "\x1b") {
    state.commandMode = false;
    state.commandBuffer = "";
    state.commandHistoryIndex = null;
    state.message = "command cancelled";
    return;
  }
  if (value === "\x1b[A") {
    moveTuiCommandHistory(state, -1);
    return;
  }
  if (value === "\x1b[B") {
    moveTuiCommandHistory(state, 1);
    return;
  }
  if (value === "\u007f" || value === "\b") {
    state.commandBuffer = state.commandBuffer.slice(0, -1);
    return;
  }
  if (value === "\r" || value === "\n") {
    const command = state.commandBuffer.trim();
    state.commandMode = false;
    state.commandBuffer = "";
    state.commandHistoryIndex = null;
    recordTuiCommand(state, command);
    await runTuiCommand(command, state, call, env);
    return;
  }
  if (/^[\x20-\x7e]$/.test(value)) {
    state.commandBuffer += value;
  }
}

async function runTuiCommand(
  command: string,
  state: TuiState,
  call: TuiCall,
  env: NodeJS.ProcessEnv
): Promise<void> {
  if (!command) {
    state.message = "empty command";
    return;
  }
  const [name, ...rest] = command.split(/\s+/);
  if (name === "refresh") {
    await refreshTuiState(state, call);
    return;
  }
  if (name === "search" && rest.length > 0) {
    const search = parseTuiSearchCommand(rest);
    if (!search.query) {
      throw new CliError("search requires a query.", 2);
    }
    state.searchQuery = search.query;
    state.searchScope = search.scope;
    state.searchLimit = search.limit;
    const response = await call("hcb_search", {
      query: search.query,
      limit: search.limit,
      ...(search.scope === undefined ? {} : { scope: search.scope })
    });
    state.data.search = response.items ?? [];
    state.view = "search";
    state.selected.search = 0;
    state.message = `search: ${search.query}`;
    return;
  }
  if (name === "logs" && rest.length > 0) {
    const logs = parseTuiLogsCommand(rest);
    state.logLevel = logs.level;
    state.logLimit = logs.limit;
    const response = await call("hcb_log", { level: logs.level, limit: logs.limit });
    state.data.logs = response.items ?? [];
    state.view = "logs";
    state.selected.logs = 0;
    state.message = `logs: level=${logs.level} limit=${logs.limit}`;
    return;
  }
  if (name === "mutation") {
    await runTuiMutationCommand(rest, state, call);
    return;
  }
  if (name === "view") {
    const view = rest[0];
    if (!isTuiView(view)) {
      throw new CliError("view requires status, backend, today, week, search, logs, mutations, or hosters.", 2);
    }
    state.view = view;
    state.message = `view ${view}`;
    return;
  }
  if (isTuiView(name)) {
    state.view = name;
    state.message = `view ${name}`;
    return;
  }
  if (name === "apply") {
    await runTuiApply(rest[0], state, call);
    return;
  }
  if (name === "backend") {
    await runTuiBackendCommand(rest, state, call);
    return;
  }
  if (name === "hoster") {
    await runTuiHosterCommand(rest, state, call, env);
    return;
  }

  throw new CliError(`Unknown TUI command '${name}'.`, 2);
}

async function runTuiApply(
  confirmationId: string | undefined,
  state: TuiState,
  call: TuiCall
): Promise<void> {
  if (!state.pendingApply) {
    throw new CliError("No pending dry-run to apply.", 2);
  }
  const id = confirmationId ?? state.pendingApply.confirmationId;
  if (!id) {
    throw new CliError("Pending action does not have a confirmation id.", 2);
  }
  const response = await call(state.pendingApply.tool, {
    ...state.pendingApply.args,
    dryRun: false,
    confirmationId: id
  });
  state.pendingApply = undefined;
  await refreshTuiState(state, call);
  state.message = response.message;
}

async function runTuiMutationCommand(
  args: string[],
  state: TuiState,
  call: TuiCall
): Promise<void> {
  const action = args[0];
  if (action !== "retry" && action !== "cancel") {
    throw new CliError("mutation command must be retry or cancel.", 2);
  }
  const id = args[1] ?? selectedTuiMutationId(state);
  if (!id) {
    throw new CliError(`mutation ${action} requires an id or selected mutation row.`, 2);
  }
  await runTuiDryRun(
    state,
    call,
    `mutation ${action}`,
    action === "retry" ? "hcb_retry_mutation" : "hcb_cancel_mutation",
    { id, dryRun: true }
  );
  state.view = "mutations";
}

function selectedTuiMutationId(state: TuiState): string | undefined {
  const row = state.view === "mutations" ? selectedTuiRow(state)?.item : undefined;
  return typeof row?.id === "string" ? row.id : undefined;
}

function parseTuiSearchCommand(args: string[]): { query: string; scope?: string; limit: number } {
  const rest = [...args];
  let scope: string | undefined;
  let limit = 25;
  const query: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--scope") {
      scope = parseScope(optionValue(rest[index + 1], "--scope"));
      index += 1;
      continue;
    }
    if (arg === "--limit" || arg === "-n") {
      limit = parseLimit(optionValue(rest[index + 1], "--limit"));
      index += 1;
      continue;
    }
    query.push(arg);
  }

  return { query: query.join(" ").trim(), ...(scope === undefined ? {} : { scope }), limit };
}

function parseTuiLogsCommand(args: string[]): { level: string; limit: number } {
  let level = "warn";
  let limit = 50;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--level") {
      level = parseLevel(optionValue(args[index + 1], "--level"));
      index += 1;
      continue;
    }
    if (arg === "--limit" || arg === "-n") {
      limit = parseLimit(optionValue(args[index + 1], "--limit"));
      index += 1;
      continue;
    }
    if (["debug", "info", "warn", "error"].includes(arg)) {
      level = parseLevel(arg);
      continue;
    }
    if (/^\d+$/.test(arg)) {
      limit = parseLimit(arg);
      continue;
    }
    throw new CliError(`Unknown logs option '${arg}'.`, 2);
  }

  return { level, limit };
}

async function runTuiHosterCommand(
  args: string[],
  state: TuiState,
  call: TuiCall,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const action = args[0];
  if (action === "status") {
    const response = await call("hcb_hoster_status", {});
    state.data.hosters = response.item ?? {};
    state.view = "hosters";
    state.message = response.message;
    return;
  }
  if (action === "test") {
    const response = await call("hcb_hoster_test", {
      ...(args[1] ? { id: args[1] } : {}),
      privatePayload: true
    });
    state.message = response.message;
    return;
  }
  if (action === "create") {
    const name = args.slice(1).join(" ").trim();
    if (!name) {
      throw new CliError("hoster create requires a name.", 2);
    }
    await runTuiDryRun(state, call, "hoster create", "hcb_hoster_create", { name, dryRun: true });
    return;
  }
  if (action === "export") {
    const [id, out, passphraseEnv] = args.slice(1);
    if (!id || !out) {
      throw new CliError("hoster export requires <id> <path> [passphraseEnv].", 2);
    }
    await runTuiDryRun(state, call, "hoster export", "hcb_hoster_export", {
      id,
      out,
      ...(passphraseEnv ? { passphrase: passphraseFromEnv(passphraseEnv, env) } : {}),
      dryRun: true
    });
    return;
  }
  if (action === "import") {
    const [path, passphraseEnv] = args.slice(1);
    if (!path) {
      throw new CliError("hoster import requires <path> [passphraseEnv].", 2);
    }
    await runTuiDryRun(state, call, "hoster import", "hcb_hoster_import", {
      path,
      ...(passphraseEnv ? { passphrase: passphraseFromEnv(passphraseEnv, env) } : {}),
      dryRun: true
    });
    return;
  }
  if (action === "remove") {
    const id = args[1];
    if (!id) {
      throw new CliError("hoster remove requires <id>.", 2);
    }
    await runTuiDryRun(state, call, "hoster remove", "hcb_hoster_remove", { id, dryRun: true });
    return;
  }

  throw new CliError("hoster command must be status, create, export, import, remove, or test.", 2);
}

async function runTuiBackendCommand(
  args: string[],
  state: TuiState,
  call: TuiCall
): Promise<void> {
  const action = args[0] ?? "status";
  if (action === "status") {
    const response = await call("hcb_backend_status", {});
    state.data.backend = response.item ?? {};
    state.view = "backend";
    state.message = response.message;
    return;
  }
  if (action === "set") {
    const backend = args[1];
    if (backend !== "google" && backend !== "hcb-local" && backend !== "hcb-hoster") {
      throw new CliError("backend set requires google, hcb-local, or hcb-hoster.", 2);
    }
    await runTuiDryRun(state, call, `backend set ${backend}`, "hcb_backend_set", {
      backend,
      dryRun: true
    });
    return;
  }
  throw new CliError("backend command must be status or set.", 2);
}

async function runTuiDryRun(
  state: TuiState,
  call: TuiCall,
  label: string,
  tool: string,
  args: JsonObject
): Promise<void> {
  const response = await call(tool, args);
  state.pendingApply = {
    label,
    tool,
    args,
    confirmationId: response.confirmationId
  };
  state.message = response.confirmationId
    ? `${label} dry-run ready; :apply ${response.confirmationId}`
    : `${label} dry-run ready`;
}

function moveTuiView(state: TuiState, delta: number): void {
  const index = state.views.indexOf(state.view);
  const next = (index + delta + state.views.length) % state.views.length;
  state.view = state.views[next];
  clampTuiSelection(state);
}

function clampTuiSelection(state: TuiState): void {
  for (const view of state.views) {
    state.selected[view] = Math.max(0, Math.min(tuiRowsForView(state, view).length - 1, state.selected[view]));
  }
}

function isTuiView(value: string): value is TuiView {
  return ["status", "backend", "today", "week", "search", "logs", "mutations", "hosters"].includes(value);
}

function recordTuiCommand(state: TuiState, command: string): void {
  if (!command || state.commandHistory[state.commandHistory.length - 1] === command) {
    return;
  }
  state.commandHistory.push(command);
  if (state.commandHistory.length > 50) {
    state.commandHistory.shift();
  }
}

function moveTuiCommandHistory(state: TuiState, delta: number): void {
  if (state.commandHistory.length === 0) {
    return;
  }
  const current = state.commandHistoryIndex ?? state.commandHistory.length;
  const next = Math.max(0, Math.min(state.commandHistory.length, current + delta));
  state.commandHistoryIndex = next === state.commandHistory.length ? null : next;
  state.commandBuffer = state.commandHistoryIndex === null ? "" : state.commandHistory[state.commandHistoryIndex];
}

function splitTuiInput(value: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < value.length;) {
    const escape = ["\x1b[A", "\x1b[B", "\x1b[C", "\x1b[D"].find((candidate) => value.startsWith(candidate, index));
    if (escape) {
      result.push(escape);
      index += escape.length;
      continue;
    }
    result.push(value[index]);
    index += 1;
  }
  return result;
}

function tuiViewport(stdout: Output): TuiViewport {
  return {
    width: Math.max(80, Math.min(220, stdout.columns ?? 120)),
    height: Math.max(20, Math.min(80, stdout.rows ?? 32))
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

function formatTuiScreen(state: TuiState): string {
  const rows = tuiRows(state);
  const selected = selectedTuiRow(state);
  const width = state.viewport.width;
  const listLimit = Math.max(4, Math.min(rows.length || 4, Math.floor((state.viewport.height - 12) * 0.58)));
  const detailLimit = Math.max(4, state.viewport.height - 13 - listLimit);
  const todayTasks = objectArray(state.data.today.tasks).length;
  const todayEvents = objectArray(state.data.today.events).length;
  const mutationCount = state.data.mutations.length;
  const backend = text(state.data.backend.storageBackend) || "unknown";
  const hosterCount = objectArray(state.data.hosters.profiles).length;
  const tabs = state.views
    .map((view) => view === state.view ? `[${view}]` : ` ${view} `)
    .join(" ");
  const pending = state.pendingApply
    ? `pending: ${state.pendingApply.label}${state.pendingApply.confirmationId ? ` confirmation=${state.pendingApply.confirmationId}` : ""}`
    : "pending: none";
  const command = state.commandMode ? `:${state.commandBuffer}` : "";
  const selectedIndex = state.selected[state.view];
  const listStart = Math.max(0, Math.min(selectedIndex - Math.floor(listLimit / 2), Math.max(0, rows.length - listLimit)));
  const listLines = rows.length === 0
    ? ["  No rows."]
    : rows.slice(listStart, listStart + listLimit).map((row, offset) => {
      const index = listStart + offset;
      return truncateText(`${index === selectedIndex ? ">" : " "} ${row.label}`, width - 2);
    });
  const detailLines = selected
    ? renderTuiDetail(selected.item, detailLimit, width - 2)
    : ["No detail."];

  return [
    "\x1b[2J\x1b[HHot Cross Buns 2 TUI",
    tabs,
    "keys: tab/arrow switch | j/k move | / search | : command | r refresh | q quit",
    "commands: search <q> [--scope s] [--limit n] | logs [level] [n] | backend ... | hoster ... | apply [id]",
    `Backend: ${backend} | Today: ${todayTasks} tasks, ${todayEvents} events | Pending mutations: ${mutationCount} | Hosters: ${hosterCount}`,
    pending,
    `status: ${state.message}`,
    command,
    "",
    `${state.view.toUpperCase()} (${rows.length})`,
    ...listLines,
    "",
    "DETAIL",
    ...detailLines
  ].join("\n") + "\n";
}

interface TuiRow {
  label: string;
  item: JsonObject;
}

function tuiRows(state: TuiState): TuiRow[] {
  return tuiRowsForView(state, state.view);
}

function selectedTuiRow(state: TuiState): TuiRow | undefined {
  return tuiRows(state)[state.selected[state.view]];
}

function tuiRowsForView(state: TuiState, view: TuiView): TuiRow[] {
  if (view === "status") {
    const status = state.data.status;
    const account = asObject(status.account) ?? {};
    const sync = asObject(status.sync) ?? {};
    const cache = asObject(status.cache) ?? {};
    const mcp = asObject(status.mcp) ?? {};
    return [
      tuiRow(`account ${text(account.state)}`, account),
      tuiRow(`sync ${text(sync.state)} mode=${text(sync.mode)}`, sync),
      tuiRow(`cache tasks=${text(cache.taskCount)} events=${text(cache.eventCount)} notes=${text(cache.noteCount)}`, cache),
      tuiRow(`mcp enabled=${text(mcp.enabled)} mode=${text(mcp.permissionMode)}`, mcp)
    ];
  }
  if (view === "backend") {
    const backend = state.data.backend;
    return [
      tuiRow(`backend ${text(backend.storageBackend)} googleSyncActive=${text(backend.googleSyncActive)}`, backend),
      tuiRow(`vault ${text(backend.hcbVaultPath) || "unset"}`, backend),
      tuiRow(`hosterEndpoint ${text(backend.hcbHosterEndpoint) || "unset"}`, backend),
      tuiRow(`lists task=${text(backend.taskListCount)} calendar=${text(backend.calendarCount)}`, backend)
    ];
  }
  if (view === "today") {
    return [
      ...objectArray(state.data.today.tasks).map((item) => tuiRow(`[task] ${formatCompactItem(item)}`, item)),
      ...objectArray(state.data.today.events).map((item) => tuiRow(`[event] ${formatCompactItem(item)}`, item)),
      ...objectArray(state.data.today.notes).map((item) => tuiRow(`[note] ${formatCompactItem(item)}`, item))
    ];
  }
  if (view === "week") {
    return [
      ...objectArray(state.data.week.tasks).map((item) => tuiRow(`[task] ${formatCompactItem(item)}`, item)),
      ...objectArray(state.data.week.events).map((item) => tuiRow(`[event] ${formatCompactItem(item)}`, item))
    ];
  }
  if (view === "search") {
    return state.data.search.map((item) => tuiRow(formatCompactItem(item), item));
  }
  if (view === "logs") {
    return state.data.logs.map((item) => tuiRow(text(item.formattedLine) || `${text(item.timestamp)} ${text(item.level)} ${text(item.message)}`, item));
  }
  if (view === "mutations") {
    return state.data.mutations.map((item) => tuiRow(formatCompactItem(item), item));
  }
  const profiles = objectArray(state.data.hosters.profiles);
  return [
    tuiRow(`server enabled=${text(state.data.hosters.enabled)} running=${text(state.data.hosters.running)} health=${text(state.data.hosters.health)} port=${text(state.data.hosters.port)}`, state.data.hosters),
    ...profiles.map((item) => tuiRow(`${text(item.id)} ${text(item.name)} mode=${text(item.permissionMode)} endpoint=${text(item.endpoint)}`, item))
  ];
}

function tuiRow(label: string, item: JsonObject): TuiRow {
  return {
    label: truncateText(label, 120),
    item
  };
}

function renderTuiDetail(item: JsonObject, limit: number, width: number): string[] {
  return JSON.stringify(item, null, 2)
    .split("\n")
    .slice(0, limit)
    .map((line) => truncateText(line, width));
}

function truncateText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 3))}...`;
}

export function discoverRuntime(dependencies: HcbCliDependencies = {}): RuntimeTarget {
  const env = dependencies.env ?? process.env;
  const platform = dependencies.platform ?? process.platform;
  const explicitUrl = env.HCB_MCP_URL?.trim();

  if (explicitUrl) {
    const parsed = runtimeFromUrl(explicitUrl);

    if (parsed) {
      return parsed;
    }

    throw new CliError("HCB_MCP_URL must be http://127.0.0.1:<port>.");
  }

  const files = dependencies.runtimeFilePaths ?? runtimeFileCandidates(env, platform);

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

export function runtimeFileCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform | string = process.platform
): string[] {
  const explicit = env.HCB_MCP_RUNTIME_FILE?.trim();

  if (explicit) {
    return [explicit];
  }

  const userData = env.HCB_USER_DATA_DIR?.trim();

  if (userData) {
    if (platform === "linux") {
      return [
        join(userData, HCB_MCP_RUNTIME_FILE_NAME),
        join(userData, "config", HCB_MCP_RUNTIME_FILE_NAME)
      ];
    }

    return [pathJoin(platform, userData, "config", HCB_MCP_RUNTIME_FILE_NAME)];
  }

  const home = homedir();

  if (platform === "darwin") {
    return [
      join(home, "Library", "Application Support", "Hot Cross Buns 2", "config", HCB_MCP_RUNTIME_FILE_NAME),
      join(home, "Library", "Application Support", "hot-cross-buns-2", "config", HCB_MCP_RUNTIME_FILE_NAME)
    ];
  }

  if (platform === "win32") {
    return windowsAppDataRoots(env, home).flatMap((root) => [
      win32.join(root, "Hot Cross Buns 2", "config", HCB_MCP_RUNTIME_FILE_NAME),
      win32.join(root, "hot-cross-buns-2", "config", HCB_MCP_RUNTIME_FILE_NAME)
    ]);
  }

  return [
    join(home, ".config", "Hot Cross Buns 2", HCB_MCP_RUNTIME_FILE_NAME),
    join(home, ".config", "hot-cross-buns-2", HCB_MCP_RUNTIME_FILE_NAME),
    join(home, ".config", "Hot Cross Buns 2", "config", HCB_MCP_RUNTIME_FILE_NAME),
    join(home, ".config", "hot-cross-buns-2", "config", HCB_MCP_RUNTIME_FILE_NAME)
  ];
}

export function mcpSecretStoreFileCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform | string = process.platform
): string[] {
  const explicit = env.HCB_MCP_SECRET_STORE_FILE?.trim();

  if (explicit) {
    return [explicit];
  }

  const userData = env.HCB_USER_DATA_DIR?.trim();

  if (userData && platform === "linux") {
    return [
      join(userData, "secrets.safe-storage.json"),
      join(userData, "config", "secrets.safe-storage.json")
    ];
  }

  if (userData && platform === "win32") {
    return [
      win32.join(userData, "config", "secrets.windows-safe-storage.json"),
      win32.join(userData, "secrets.windows-safe-storage.json")
    ];
  }

  const home = homedir();

  if (platform === "linux") {
    return [
      join(home, ".config", "Hot Cross Buns 2", "secrets.safe-storage.json"),
      join(home, ".config", "hot-cross-buns-2", "secrets.safe-storage.json")
    ];
  }

  if (platform === "win32") {
    return windowsAppDataRoots(env, home).flatMap((root) => [
      win32.join(root, "Hot Cross Buns 2", "config", "secrets.windows-safe-storage.json"),
      win32.join(root, "hot-cross-buns-2", "config", "secrets.windows-safe-storage.json")
    ]);
  }

  return [];
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
    if (isCliWriteCommand(command)) {
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

  if (command.command === "brief") {
    return formatDetail("brief", response.item ?? {});
  }

  if (command.command === "plan") {
    return formatDetail("plan", response.item ?? {});
  }

  if (command.command === "tail") {
    return formatLogs(response.items ?? []);
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

  if (command.command === "hoster") {
    if (isHosterWriteCommand(command)) {
      return formatWrite(command, response);
    }

    return command.action === "test" || command.action === "signal"
      ? formatDetail(command.action === "signal" ? "hoster signal" : "hoster test", response.item ?? {})
      : formatHosterStatus(response.item ?? {});
  }

  if (command.command === "backend") {
    return isBackendWriteCommand(command)
      ? formatWrite(command, response)
      : formatBackendStatus(response.item ?? {});
  }

  if (command.command === "vault") {
    return formatWrite(command, response);
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

function formatHosterStatus(item: JsonObject): string {
  const profiles = objectArray(item.profiles);
  const lines = [
    "HCB local hosters",
    `Server: enabled=${text(item.enabled)} running=${text(item.running)} health=${text(item.health)} port=${text(item.port)} configured=${text(item.configuredPort)}`
  ];

  if (item.endpoint) {
    lines.push(`Endpoint: ${text(item.endpoint)}`);
  }

  if (profiles.length === 0) {
    lines.push("Profiles: 0");
  } else {
    lines.push(`Profiles: ${profiles.length}`);
    for (const profile of profiles) {
      lines.push(`  ${text(profile.id)} ${text(profile.name)} mode=${text(profile.permissionMode)} endpoint=${text(profile.endpoint)}`);
    }
  }

  if (item.lastError) {
    lines.push(`Last error: ${text(item.lastError)}`);
  }

  return `${lines.join("\n")}\n`;
}

function formatBackendStatus(item: JsonObject): string {
  return [
    "HCB backend",
    `Backend: ${text(item.storageBackend)}`,
    `Google sync active: ${text(item.googleSyncActive)}`,
    `Vault path: ${text(item.hcbVaultPath) || "unset"}`,
    `Hoster endpoint: ${text(item.hcbHosterEndpoint) || "unset"}`,
    `Task lists: ${text(item.taskListCount)}`,
    `Calendars: ${text(item.calendarCount)}`
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
    : command.command === "hoster"
    ? `hoster ${command.action ?? "status"}`
    : command.command === "vault"
    ? `vault ${command.action ?? "export"}`
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
    kind: "hcbCliResult",
    schemaVersion: 1,
    command: command.command,
    tool: toolName(command),
    target: command.target ?? command.command,
    ...response,
    ...(applyCommand ? { applyCommand } : {})
  };
}

function writeApplyCommand(command: ParsedCommand, response: McpToolResponse): string | undefined {
  if (!isCliWriteCommand(command) || !response.dryRun || command.apply === true) {
    return undefined;
  }

  if (command.command === "google" && command.action === "save-oauth-client" && command.clientSecret !== undefined) {
    return undefined;
  }

  const args = writeCommandPrefix(command);

  if (command.id !== undefined && command.command !== "hoster") {
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

  if (command.command === "backend") {
    pushFlag(args, "--endpoint", command.endpoint);
  }

  if (command.command === "vault") {
    pushFlag(args, "--out", command.out);
    if (command.action !== "import") {
      pushFlag(args, "--path", command.path);
    }
    pushFlag(args, "--passphrase-env", command.passphraseEnv);
  }

  if (command.command === "google") {
    pushFlag(args, "--client-id", command.clientId);
    pushFlag(args, "--client-secret", command.clientSecret);
  }

  if (command.command === "mcp") {
    pushFlag(args, "--enabled", command.enabled === undefined ? undefined : String(command.enabled));
  }

  if (command.command === "hoster") {
    pushFlag(args, "--name", command.name);
    pushFlag(args, "--permission-mode", command.permissionMode);
    pushFlag(args, "--out", command.out);
    if (command.action !== "import") {
      pushFlag(args, "--path", command.path);
    }
    pushFlag(args, "--passphrase-env", command.passphraseEnv);
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

  if (command.command === "hoster") {
    const prefix = ["pnpm", "hcb", "--", "hoster", command.action ?? "status"];
    if ((command.action === "export" || command.action === "remove") && command.id) {
      prefix.push(command.id);
    }
    if (command.action === "import" && command.path) {
      prefix.push(command.path);
    }
    return prefix;
  }

  if (command.command === "backend") {
    const prefix = ["pnpm", "hcb", "--", "backend", command.action ?? "status"];
    if (command.action === "set" && command.target) {
      prefix.push(command.target);
    }
    return prefix;
  }

  if (command.command === "vault") {
    const prefix = ["pnpm", "hcb", "--", "vault", command.action ?? "export"];
    if (command.action === "import" && command.path) {
      prefix.push(command.path);
    }
    return prefix;
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
    "Usage: hcb <command> [options]  (or: pnpm hcb -- <command> [options])",
    "",
    "Commands:",
    "  doctor [--json]                         run agent-friendly diagnostics",
    "  status [--json]                         show account/sync/cache/pending status",
    "  search <query> [--scope <scope>]        search tasks, notes, events, lists, calendars",
    "  today [--json]                          show today's agenda",
    "  week [--start-date <date>] [--json]     show a seven-day agenda",
    "  brief [--json]                          show compact agent planner brief",
    "  plan [--start-date <date>] [--json]     show agent planner summary",
    "  tail [-n <limit>] [--level <level>]     tail sanitized recent logs",
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
    "  backend status                          show HCB storage backend status",
    "  backend set <backend>                   dry-run switch backend",
    "  vault export --passphrase-env <env>     dry-run export encrypted .hcbvault",
    "  vault import <path> --passphrase-env <env> dry-run import encrypted .hcbvault",
    "  google save-oauth-client [options]      dry-run save Google OAuth client config",
    "  google begin-oauth                      dry-run start Google OAuth",
    "  mcp set-enabled <true|false>            dry-run enable or disable MCP",
    "  hoster status                           show local hoster status",
    "  hoster create --name <name>             dry-run create local hoster profile",
    "  hoster export <id> --out <path>         dry-run export encrypted .hcbhost",
    "  hoster import <path>                    dry-run import encrypted .hcbhost",
    "  hoster remove <id>                      dry-run remove local hoster profile",
    "  hoster test [id]                        test signal encryption round-trip",
    "  hoster signal <id> --tool <name>        send raw local hoster signal",
    "  tui                                     open terminal dashboard",
    "  completion [bash|zsh|fish]              print shell completion",
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
    "  pnpm hcb -- brief",
    "  pnpm hcb -- plan --start-date 2026-06-04",
    "  pnpm hcb -- tail -n 50 --level warn",
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
    "  pnpm hcb -- backend status",
    "  pnpm hcb -- backend set hcb-local --apply --confirmation-id confirm-id",
    "  HCB_VAULT_PASSPHRASE='change-me-long' pnpm hcb -- vault export --passphrase-env HCB_VAULT_PASSPHRASE",
    "  pnpm hcb -- google begin-oauth --apply",
    "  pnpm hcb -- mcp set-enabled true",
    "  pnpm hcb -- hoster status",
    "  pnpm hcb -- hoster create --name local --permission-mode confirm-writes",
    "  pnpm hcb -- hoster export hoster-id --out /tmp/local.hcbhost --passphrase-env HCB_HOSTER_PASSPHRASE",
    "  hcb hoster signal hoster-id --tool hcb_status --arguments-json '{}'",
    "  hcb completion zsh > ~/.zsh/completions/_hcb",
    "  pnpm hcb -- tui",
    "  pnpm hcb -- status",
    "  pnpm hcb -- log -n 20 --level warn",
    "  pnpm hcb -- diff --json",
    "  pnpm hcb -- show task task-id"
  ].join("\n") + "\n";
}

function completionScript(shell: "bash" | "zsh" | "fish"): string {
  const commands = [
    "doctor", "status", "search", "today", "week", "brief", "plan", "tail",
    "export-diagnostics", "undo-status", "sync-now", "pending-mutations",
    "retry-mutation", "cancel-mutation", "list", "get", "create", "update",
    "convert", "rename", "complete", "reopen", "move", "delete", "undo",
    "redo", "schedule", "settings", "backend", "vault", "google", "mcp", "hoster", "tui",
    "completion", "help"
  ];
  const hosterActions = ["status", "create", "export", "import", "remove", "test", "signal"];
  const options = [
    "--json", "--limit", "--level", "--scope", "--start-date", "--apply",
    "--confirmation-id", "--name", "--permission-mode", "--out", "--path", "--endpoint",
    "--private", "--passphrase-env", "--tool", "--arguments-json", "--request-id"
  ];
  if (shell === "zsh") {
    return [
      "#compdef hcb",
      "_hcb() {",
      "  local -a commands hoster_actions options",
      `  commands=(${commands.map((item) => `${item}:`).join(" ")})`,
      `  hoster_actions=(${hosterActions.map((item) => `${item}:`).join(" ")})`,
      `  options=(${options.map((item) => `${item}`).join(" ")})`,
      "  if [[ ${words[2]} == hoster ]]; then",
      "    _describe 'hoster action' hoster_actions && return",
      "  fi",
      "  _describe 'command' commands || _values 'option' $options",
      "}",
      "_hcb",
      ""
    ].join("\n");
  }
  if (shell === "fish") {
    return [
      ...commands.map((item) => `complete -c hcb -f -n '__fish_use_subcommand' -a '${item}'`),
      ...hosterActions.map((item) => `complete -c hcb -f -n '__fish_seen_subcommand_from hoster' -a '${item}'`),
      ...options.map((item) => `complete -c hcb -l ${item.slice(2)}`),
      ""
    ].join("\n");
  }

  return [
    "_hcb_complete() {",
    "  local cur prev commands hoster_actions options",
    "  COMPREPLY=()",
    "  cur=\"${COMP_WORDS[COMP_CWORD]}\"",
    "  prev=\"${COMP_WORDS[COMP_CWORD-1]}\"",
    `  commands=\"${commands.join(" ")}\"`,
    `  hoster_actions=\"${hosterActions.join(" ")}\"`,
    `  options=\"${options.join(" ")}\"`,
    "  if [[ ${COMP_WORDS[1]} == hoster && ${COMP_CWORD} -eq 2 ]]; then",
    "    COMPREPLY=( $(compgen -W \"$hoster_actions\" -- \"$cur\") )",
    "    return 0",
    "  fi",
    "  if [[ $cur == --* ]]; then",
    "    COMPREPLY=( $(compgen -W \"$options\" -- \"$cur\") )",
    "  else",
    "    COMPREPLY=( $(compgen -W \"$commands\" -- \"$cur\") )",
    "  fi",
    "}",
    "complete -F _hcb_complete hcb",
    ""
  ].join("\n");
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
    case "brief":
      return "hcb_brief";
    case "plan":
      return "hcb_plan";
    case "tail":
      return "hcb_tail";
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
    case "backend":
      if (command.action === "status") {
        return "hcb_backend_status";
      }

      if (command.action === "set") {
        return "hcb_backend_set";
      }

      throw new CliError("Unknown backend action.", 2);
    case "vault":
      if (command.action === "export") {
        return "hcb_vault_export";
      }

      if (command.action === "import") {
        return "hcb_vault_import";
      }

      throw new CliError("Unknown vault action.", 2);
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
    case "hoster":
      if (command.action === "status") {
        return "hcb_hoster_status";
      }

      if (command.action === "create") {
        return "hcb_hoster_create";
      }

      if (command.action === "export") {
        return "hcb_hoster_export";
      }

      if (command.action === "import") {
        return "hcb_hoster_import";
      }

      if (command.action === "remove") {
        return "hcb_hoster_remove";
      }

      if (command.action === "test") {
        return "hcb_hoster_test";
      }

      throw new CliError("Unknown hoster action.", 2);
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
    command === "brief" ||
    command === "plan" ||
    command === "tail" ||
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
    command === "backend" ||
    command === "vault" ||
    command === "google" ||
    command === "mcp" ||
    command === "hoster" ||
    command === "tui" ||
    command === "completion"
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

function parseBackendAction(value: string | undefined): string {
  if (value === "status" || value === "set") {
    return value;
  }

  throw new CliError("Backend action must be status or set.", 2);
}

function parseVaultAction(value: string | undefined): string {
  if (value === "export" || value === "import") {
    return value;
  }

  throw new CliError("Vault action must be export or import.", 2);
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

function parseHosterAction(value: string | undefined): string {
  if (
    value === "status" ||
    value === "create" ||
    value === "export" ||
    value === "import" ||
    value === "remove" ||
    value === "test" ||
    value === "signal"
  ) {
    return value;
  }

  throw new CliError("Hoster action must be one of: status, create, export, import, remove, test, signal.", 2);
}

function parseCompletionShell(value: string): "bash" | "zsh" | "fish" {
  if (value === "bash" || value === "zsh" || value === "fish") {
    return value;
  }

  throw new CliError("Completion shell must be bash, zsh, or fish.", 2);
}

function parsePermissionMode(value: string | undefined): string {
  if (value === "read-only" || value === "confirm-writes" || value === "allow-writes") {
    return value;
  }

  throw new CliError("Permission mode must be read-only, confirm-writes, or allow-writes.", 2);
}

function optionValue(value: string | undefined, flag: string): string {
  if (!value || value.startsWith("--")) {
    throw new CliError(`Missing value for ${flag}.`, 2);
  }

  return value;
}

function passphraseFromEnv(name: string, env: NodeJS.ProcessEnv): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new CliError("--passphrase-env must name an environment variable.", 2);
  }
  const value = env[name];
  if (!value || value.length < 8) {
    throw new CliError(`Environment variable ${name} must contain a passphrase with at least 8 characters.`, 2);
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

function isHosterWriteCommand(command: ParsedCommand): boolean {
  return command.command === "hoster" && (
    command.action === "create" ||
    command.action === "export" ||
    command.action === "import" ||
    command.action === "remove"
  );
}

function isBackendWriteCommand(command: ParsedCommand): boolean {
  return command.command === "backend" && command.action === "set";
}

function isVaultWriteCommand(command: ParsedCommand): boolean {
  return command.command === "vault" && (command.action === "export" || command.action === "import");
}

function isCliWriteCommand(command: ParsedCommand): boolean {
  return isWriteCommand(command.command) || isHosterWriteCommand(command) || isBackendWriteCommand(command) || isVaultWriteCommand(command);
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
  rejectCreateOptions(command, ["title", "notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled", "endpoint"]);
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

  rejectCreateOptions(command, ["title", "notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "clientId", "clientSecret", "enabled", "endpoint", "out", "path", "passphraseEnv"]);
}

function validateBackendCommand(command: ParsedCommand): void {
  rejectReadOptions(command, "backend");
  rejectCreateOptions(command, ["title", "notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled", "out", "path", "privatePayload", "passphraseEnv"]);

  if (command.action === "status") {
    rejectUnsupportedOptions(command, "backend status", ["endpoint", "apply", "confirmationId"]);
    return;
  }

  if (command.target !== "google" && command.target !== "hcb-local" && command.target !== "hcb-hoster") {
    throw new CliError("Backend must be google, hcb-local, or hcb-hoster.", 2);
  }
}

function validateVaultCommand(command: ParsedCommand): void {
  rejectReadOptions(command, "vault");
  rejectCreateOptions(command, ["title", "notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled", "endpoint", "privatePayload", "name", "permissionMode"]);

  if (command.passphraseEnv === undefined) {
    throw new CliError("Missing required --passphrase-env for vault.", 2);
  }

  if (command.action === "export") {
    rejectUnsupportedOptions(command, "vault export", ["path"]);
  } else if (command.action === "import") {
    if (command.path === undefined) {
      throw new CliError("Usage: pnpm hcb -- vault import <path> --passphrase-env <env>", 2);
    }
    rejectUnsupportedOptions(command, "vault import", ["out"]);
  }
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

function validateHosterCommand(command: ParsedCommand): void {
  rejectReadOptions(command, "hoster");
  rejectCreateOptions(command, ["title", "notes", "dueDate", "taskListId", "parentId", "previousSiblingId", "priority", "plannedStart", "plannedEnd", "durationMinutes", "lockedSchedule", "snoozeUntil", "tags", "noteListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay", "guestEmails", "reminderMinutes", "colorId", "timeZone", "recurrenceFrequency", "recurrenceInterval", "recurrenceEndsOn", "recurrenceCount", "recurrenceByDay", "clearRecurrence", "patchJson", "clientId", "clientSecret", "enabled"]);

  if (command.action === "status") {
    rejectUnsupportedOptions(command, "hoster status", ["name", "permissionMode", "out", "path", "privatePayload", "passphraseEnv", "apply", "confirmationId"]);
  } else if (command.action === "create") {
    if (command.name === undefined) {
      throw new CliError("Missing required --name for hoster create.", 2);
    }
    rejectUnsupportedOptions(command, "hoster create", ["id", "out", "path", "privatePayload", "passphraseEnv"]);
  } else if (command.action === "export") {
    if (command.id === undefined || command.out === undefined) {
      throw new CliError("Usage: pnpm hcb -- hoster export <id> --out <path>", 2);
    }
    rejectUnsupportedOptions(command, "hoster export", ["name", "permissionMode", "path", "privatePayload"]);
  } else if (command.action === "import") {
    if (command.path === undefined) {
      throw new CliError("Usage: pnpm hcb -- hoster import <path>", 2);
    }
    rejectUnsupportedOptions(command, "hoster import", ["id", "name", "permissionMode", "out", "privatePayload"]);
  } else if (command.action === "remove") {
    if (command.id === undefined) {
      throw new CliError("Usage: pnpm hcb -- hoster remove <id>", 2);
    }
    rejectUnsupportedOptions(command, "hoster remove", ["name", "permissionMode", "out", "path", "privatePayload", "passphraseEnv"]);
  } else if (command.action === "test") {
    rejectUnsupportedOptions(command, "hoster test", ["name", "permissionMode", "out", "path", "passphraseEnv", "apply", "confirmationId"]);
  } else if (command.action === "signal") {
    if (command.id === undefined || command.toolName === undefined) {
      throw new CliError("Usage: hcb hoster signal <id> --tool <name> [--arguments-json '{}']", 2);
    }
    rejectUnsupportedOptions(command, "hoster signal", ["name", "permissionMode", "out", "path", "passphraseEnv", "privatePayload", "apply", "confirmationId"]);
  }
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
    case "permissionMode":
      return "--permission-mode";
    case "endpoint":
      return "--endpoint";
    case "privatePayload":
      return "--private";
    case "passphraseEnv":
      return "--passphrase-env";
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
  if (dependencies.tokenProvider) {
    return dependencies.tokenProvider;
  }

  return () => defaultMcpBearerToken(dependencies);
}

async function defaultMcpBearerToken(dependencies: HcbCliDependencies): Promise<string> {
  const env = dependencies.env ?? process.env;
  const explicitToken = env.HCB_MCP_BEARER_TOKEN?.trim();

  if (explicitToken) {
    return explicitToken;
  }

  const platform = dependencies.platform ?? process.platform;

  if (platform === "darwin") {
    return new KeychainMcpCredentialAdapter(new MacOsKeychainSecretStore()).loadBearerToken();
  }

  if (platform === "linux" || platform === "win32") {
    const loader = dependencies.safeStorageTokenLoader ?? loadSafeStorageMcpBearerToken;
    return loader({
      platform,
      secretStoreFiles: mcpSecretStoreFileCandidates(env, platform),
      helperBinary: safeStorageTokenHelperBinary(env),
      helperPath: safeStorageTokenHelperPath(env),
      env
    });
  }

  throw new CliError("HCB MCP bearer token loading is unsupported on this platform.");
}

async function loadSafeStorageMcpBearerToken(input: SafeStorageMcpTokenLoaderInput): Promise<string> {
  const storageFile = input.secretStoreFiles.find((file) => existsSync(file));

  if (!storageFile) {
    throw new CliError("HCB MCP bearer token storage was not found. Start HCB2 and enable Settings > Local MCP server.");
  }

  const helperBinary = input.helperBinary;
  const command = helperBinary ?? electronBinaryPath();
  const args = helperBinary
    ? ["--hcb-read-mcp-token-safe-storage", String(input.platform), storageFile]
    : [input.helperPath, String(input.platform), storageFile];

  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        env: input.env,
        maxBuffer: 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = firstOutputLine(stderr);
          reject(new CliError(detail ? `HCB MCP bearer token could not be read: ${detail}` : "HCB MCP bearer token could not be read."));
          return;
        }

        const token = stdout.trim();

        if (!token) {
          reject(new CliError("HCB MCP bearer token helper returned an empty token."));
          return;
        }

        resolve(token);
      }
    );
  });
}

function safeStorageTokenHelperBinary(env: NodeJS.ProcessEnv): string | undefined {
  return env.HCB_MCP_SAFE_STORAGE_BINARY?.trim() || undefined;
}

function safeStorageTokenHelperPath(env: NodeJS.ProcessEnv): string {
  const override = env.HCB_MCP_SAFE_STORAGE_HELPER?.trim();

  if (override) {
    return override;
  }

  return fileURLToPath(new URL("../../scripts/read-mcp-token-safe-storage.cjs", import.meta.url));
}

function electronBinaryPath(): string {
  try {
    const electron = createRequire(import.meta.url)("electron") as string | object;

    if (typeof electron === "string" && electron.trim()) {
      return electron;
    }
  } catch {
    // fall through to user-facing CLI error
  }

  throw new CliError("Electron safeStorage token helper is unavailable. Run from an installed repo dependency set or set HCB_MCP_BEARER_TOKEN.");
}

function windowsAppDataRoots(env: NodeJS.ProcessEnv, home: string): string[] {
  const roots = [env.APPDATA, env.LOCALAPPDATA]
    .map((root) => root?.trim())
    .filter((root): root is string => Boolean(root));

  if (roots.length > 0) {
    return roots;
  }

  return [win32.join(home, "AppData", "Roaming")];
}

function pathJoin(platform: NodeJS.Platform | string, ...parts: string[]): string {
  return platform === "win32" ? win32.join(...parts) : join(...parts);
}

function firstOutputLine(text: string): string {
  return text.trim().split(/\r?\n/, 1)[0]?.slice(0, 500) ?? "";
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
