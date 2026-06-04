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
    | "list"
    | "get"
    | "create"
    | "update"
    | "rename"
    | "complete"
    | "reopen"
    | "move"
    | "help";
  json: boolean;
  limit?: number;
  level?: string;
  kind?: string;
  id?: string;
  target?: string;
  apply?: boolean;
  confirmationId?: string;
  title?: string;
  notes?: string;
  dueDate?: string;
  taskListId?: string;
  body?: string;
  details?: string;
  logLimit?: number;
  mutationLimit?: number;
  query?: string;
  scope?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  calendarId?: string;
  allDay?: boolean;
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
      parsed.scope = parseScope(value);
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
      throw new CliError(`Usage: pnpm hcb -- ${command} task <id>`, 2);
    }

    validateTaskStateCommand(parsed);
  } else if (command === "move") {
    parsed.target = parseTaskStateTarget(positional[0], command);
    parsed.id = positional[1];

    if (!parsed.id || positional.length !== 2) {
      throw new CliError("Usage: pnpm hcb -- move task <id> --task-list-id <id>", 2);
    }

    validateMoveCommand(parsed);
  } else if (positional.length > 0) {
    throw new CliError(`Unexpected argument '${positional[0]}'.`, 2);
  }

  if (parsed.scope !== undefined && command !== "search") {
    throw new CliError(`--scope is only supported by search.`, 2);
  }

  if (parsed.startDate !== undefined && command !== "week" && command !== "create" && command !== "update") {
    throw new CliError(`--start-date is only supported by week, create event, and update event.`, 2);
  }

  if ((parsed.logLimit !== undefined || parsed.mutationLimit !== undefined) && command !== "doctor" && command !== "export-diagnostics") {
    throw new CliError("--log-limit and --mutation-limit are only supported by doctor and export-diagnostics.", 2);
  }

  if (hasWriteOnlyOptions(parsed) && !isWriteCommand(command)) {
    throw new CliError("Write options are only supported by create, update, rename, complete, reopen, and move.", 2);
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

  if (command.id !== undefined) {
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

  if (command.command === "week" && command.startDate !== undefined) {
    args.startDate = command.startDate;
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
  }

  if (command.command === "update") {
    args.patch = updatePatch(command);
  }

  if (command.command === "move" && command.taskListId !== undefined) {
    args.taskListId = command.taskListId;
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

function formatWrite(command: ParsedCommand, response: McpToolResponse): string {
  const target = command.target ?? "item";
  const state = response.applied ? "applied" : response.dryRun ? "dry-run" : "preview";
  const lines = [
    `HCB ${command.command} ${target}: ${state}`,
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
    target: command.target ?? "item",
    ...response,
    ...(applyCommand ? { applyCommand } : {})
  };
}

function writeApplyCommand(command: ParsedCommand, response: McpToolResponse): string | undefined {
  if (!isWriteCommand(command.command) || !response.dryRun || command.apply === true) {
    return undefined;
  }

  const args = ["pnpm", "hcb", "--", command.command, command.target ?? "item"];

  if (command.id !== undefined) {
    args.push(command.id);
  }

  if (command.command === "create" || command.command === "rename" || command.command === "update") {
    pushFlag(args, "--title", command.title);
  }

  if ((command.command === "create" || command.command === "update") && command.target === "task") {
    pushFlag(args, "--notes", command.notes);
    pushFlag(args, "--due-date", command.dueDate);
    pushFlag(args, "--task-list-id", command.taskListId);
  }

  if ((command.command === "create" || command.command === "update") && command.target === "note") {
    pushFlag(args, "--body", command.body);
  }

  if ((command.command === "create" || command.command === "update") && command.target === "event") {
    pushFlag(args, "--start-date", command.startDate);
    pushFlag(args, "--end-date", command.endDate);
    pushFlag(args, "--details", command.details);
    pushFlag(args, "--location", command.location);
    pushFlag(args, "--calendar-id", command.calendarId);

    if (command.allDay === true) {
      args.push("--all-day");
    }
  }

  if (command.command === "move") {
    pushFlag(args, "--task-list-id", command.taskListId);
  }

  args.push("--apply");
  pushFlag(args, "--confirmation-id", response.confirmationId);
  return shellJoin(args);
}

function pushFlag(args: string[], flag: string, value: string | undefined): void {
  if (value === undefined) {
    return;
  }

  args.push(flag, value);
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
    "  list <target> [--json]                  list task-lists, calendars, or note-lists",
    "  get <kind> <id> [--json]                get a task, event, or note",
    "  create <kind> [options]                 dry-run create a task, note, event, or list",
    "  update <kind> <id> [options]            dry-run update a task, note, or event",
    "  rename <kind> <id> --title <title>      dry-run rename a task-list or note-list",
    "  complete task <id>                      dry-run complete a task",
    "  reopen task <id>                        dry-run reopen a task",
    "  move task <id> --task-list-id <id>      dry-run move a task",
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
    "  pnpm hcb -- list task-lists",
    "  pnpm hcb -- list note-lists",
    "  pnpm hcb -- get task task-id",
    "  pnpm hcb -- create note --title 'Draft' --body 'Body'",
    "  pnpm hcb -- create task-list --title 'Errands'",
    "  pnpm hcb -- create note --title 'Draft' --body 'Body' --apply --confirmation-id confirm-id",
    "  pnpm hcb -- update task task-id --title 'Next title'",
    "  pnpm hcb -- rename task-list list-id --title 'Errands'",
    "  pnpm hcb -- complete task task-id",
    "  pnpm hcb -- move task task-id --task-list-id list-id",
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
    case "rename":
      if (command.target === "task-list") {
        return "hcb_rename_task_list";
      }

      if (command.target === "note-list") {
        return "hcb_rename_note_list";
      }

      throw new CliError("Unknown rename target.", 2);
    case "complete":
      return "hcb_complete_task";
    case "reopen":
      return "hcb_reopen_task";
    case "move":
      return "hcb_move_task";
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
    command === "list" ||
    command === "get" ||
    command === "create" ||
    command === "update" ||
    command === "rename" ||
    command === "complete" ||
    command === "reopen" ||
    command === "move"
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

function parseDueDate(value: string | undefined): string {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new CliError("Due date must be an ISO-8601 date or date-time.", 2);
  }

  return value;
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

function parseRenameTarget(value: string | undefined): string {
  if (value === "task-list" || value === "note-list") {
    return value;
  }

  throw new CliError("Rename target must be one of: task-list, note-list.", 2);
}

function parseTaskStateTarget(value: string | undefined, command: string): string {
  if (value === "task") {
    return value;
  }

  throw new CliError(`${command} target must be task.`, 2);
}

function optionValue(value: string | undefined, flag: string): string {
  if (!value || value.startsWith("--")) {
    throw new CliError(`Missing value for ${flag}.`, 2);
  }

  return value;
}

function hasWriteOnlyOptions(command: ParsedCommand): boolean {
  return (
    command.apply === true ||
    command.confirmationId !== undefined ||
    command.title !== undefined ||
    command.notes !== undefined ||
    command.dueDate !== undefined ||
    command.taskListId !== undefined ||
    command.body !== undefined ||
    command.details !== undefined ||
    command.endDate !== undefined ||
    command.location !== undefined ||
    command.calendarId !== undefined ||
    command.allDay === true
  );
}

function isWriteCommand(command: ParsedCommand["command"]): boolean {
  return (
    command === "create" ||
    command === "update" ||
    command === "rename" ||
    command === "complete" ||
    command === "reopen" ||
    command === "move"
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
    rejectCreateOptions(command, ["body", "details", "startDate", "endDate", "location", "calendarId", "allDay"]);
    return;
  }

  if (command.target === "note") {
    rejectCreateOptions(command, ["notes", "dueDate", "taskListId", "details", "startDate", "endDate", "location", "calendarId", "allDay"]);
    return;
  }

  if (command.target === "event") {
    rejectCreateOptions(command, ["notes", "dueDate", "taskListId", "body"]);
    command.startDate = requiredCreateText(command.startDate, "--start-date", "event");
    validateCreateEventDates(command);
    return;
  }

  if (command.target === "task-list" || command.target === "note-list") {
    rejectCreateOptions(command, ["notes", "dueDate", "taskListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay"]);
  }
}

function validateUpdateCommand(command: ParsedCommand): void {
  rejectReadOptions(command, "update");

  if (command.target === "task") {
    rejectCreateOptions(command, ["body", "details", "startDate", "endDate", "location", "calendarId", "allDay"]);
    requireAnyUpdateField(command, ["title", "notes", "dueDate", "taskListId"], "task");
    command.title = optionalCreateText(command.title, "--title", "task");
    return;
  }

  if (command.target === "note") {
    rejectCreateOptions(command, ["notes", "dueDate", "taskListId", "details", "startDate", "endDate", "location", "calendarId", "allDay"]);
    requireAnyUpdateField(command, ["title", "body"], "note");
    command.title = optionalCreateText(command.title, "--title", "note");
    return;
  }

  if (command.target === "event") {
    rejectCreateOptions(command, ["notes", "dueDate", "taskListId", "body"]);
    requireAnyUpdateField(command, ["title", "details", "startDate", "endDate", "location", "calendarId", "allDay"], "event");
    command.title = optionalCreateText(command.title, "--title", "event");
    validateUpdateEventDates(command);
  }
}

function validateRenameCommand(command: ParsedCommand): void {
  rejectReadOptions(command, "rename");
  command.title = requiredCreateText(command.title, "--title", command.target ?? "item");
  rejectCreateOptions(command, ["notes", "dueDate", "taskListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay"]);
}

function validateTaskStateCommand(command: ParsedCommand): void {
  rejectReadOptions(command, command.command);
  rejectCreateOptions(command, ["title", "notes", "dueDate", "taskListId", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay"]);
}

function validateMoveCommand(command: ParsedCommand): void {
  rejectReadOptions(command, "move");
  command.taskListId = requiredCreateText(command.taskListId, "--task-list-id", "move task");
  rejectCreateOptions(command, ["title", "notes", "dueDate", "body", "details", "startDate", "endDate", "location", "calendarId", "allDay"]);
}

function rejectReadOptions(command: ParsedCommand, name: string): void {
  if (command.limit !== undefined) {
    throw new CliError(`--limit is not supported by ${name}.`, 2);
  }

  if (command.level !== undefined) {
    throw new CliError(`--level is not supported by ${name}.`, 2);
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

  if (command.body !== undefined) {
    patch.body = command.body;
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

  return patch;
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
