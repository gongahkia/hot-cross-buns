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
  command: "status" | "log" | "diff" | "show" | "doctor" | "help";
  json: boolean;
  limit?: number;
  level?: string;
  kind?: string;
  id?: string;
  logLimit?: number;
  mutationLimit?: number;
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

  if (command !== "status" && command !== "log" && command !== "diff" && command !== "show" && command !== "doctor") {
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
  } else if (positional.length > 0) {
    throw new CliError(`Unexpected argument '${positional[0]}'.`, 2);
  }

  return parsed;
}

export async function callCommand(
  command: ParsedCommand,
  dependencies: HcbCliDependencies = {}
): Promise<McpToolResponse> {
  const tool = toolName(command.command);
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

  return callMcpTool(tool, args, dependencies);
}

export async function callMcpTool(
  name: string,
  argumentsObject: JsonObject,
  dependencies: HcbCliDependencies = {}
): Promise<McpToolResponse> {
  const target = discoverRuntime(dependencies);
  const token = await tokenProvider(dependencies)();
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
  if (command.json) {
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

function helpText(): string {
  return [
    "Usage: pnpm hcb -- <command> [options]",
    "",
    "Commands:",
    "  doctor [--json]                         run agent-friendly diagnostics",
    "  status [--json]                         show account/sync/cache/pending status",
    "  log [-n <limit>] [--level <level>]      show sanitized recent logs",
    "  diff [--limit <limit>] [--json]         show pending local-to-Google mutations",
    "  show <kind> [id] [--json]               show task, event, note, mutation, or diagnostics",
    "  help                                    show this help",
    "",
    "Examples:",
    "  pnpm hcb -- doctor",
    "  pnpm hcb -- status",
    "  pnpm hcb -- log -n 20 --level warn",
    "  pnpm hcb -- diff --json",
    "  pnpm hcb -- show task task-id"
  ].join("\n") + "\n";
}

function toolName(command: ParsedCommand["command"]): string {
  switch (command) {
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
    default:
      throw new CliError("Help does not call MCP.");
  }
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

function text(value: unknown): string {
  if (value === undefined || value === null) {
    return "unknown";
  }

  return String(value);
}
