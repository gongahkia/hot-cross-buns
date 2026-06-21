import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { redactDiagnosticText, redactLogValue } from "@shared/redaction";
import type { DiagnosticsLogEntry, DiagnosticsLogLevel } from "@shared/ipc/contracts";

const levelOrder: Record<DiagnosticsLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const maxInMemoryEntries = 500;
const maxFileBytes = 2 * 1024 * 1024;
const rotationKeep = 5;
const currentLogName = "app.log";

interface AppLoggerState {
  logsDirectory?: string;
  ring: DiagnosticsLogEntry[];
  sequence: number;
}

const state: AppLoggerState = {
  ring: [],
  sequence: 0
};

export interface AppLoggerInput {
  level: DiagnosticsLogLevel;
  category: string;
  message: string;
  metadata?: object;
}

export const appLogger = {
  configure(options: { logsDirectory?: string }): void {
    state.logsDirectory = options.logsDirectory;
    ensureLogsDirectory();
  },

  debug(message: string, category = "misc", metadata?: object): void {
    log({ level: "debug", category, message, metadata });
  },

  info(message: string, category = "misc", metadata?: object): void {
    log({ level: "info", category, message, metadata });
  },

  warn(message: string, category = "misc", metadata?: object): void {
    log({ level: "warn", category, message, metadata });
  },

  error(message: string, category = "misc", metadata?: object): void {
    log({ level: "error", category, message, metadata });
  },

  recentEntries(limit = 200, minimumLevel: DiagnosticsLogLevel = "info"): DiagnosticsLogEntry[] {
    const safeLimit = Math.max(1, Math.min(500, limit));
    const threshold = levelOrder[minimumLevel];

    return state.ring
      .filter((entry) => levelOrder[entry.level] >= threshold)
      .slice(-safeLimit)
      .reverse();
  },

  retainedEntryCount(): number {
    return state.ring.length;
  },

  loadPersistedLog(): string {
    const files = persistedLogFiles();

    return files
      .map((file) => safeReadFile(file))
      .filter((text) => text.length > 0)
      .join("\n")
      .slice(-1_000_000);
  },

  clearLogs(): void {
    state.ring = [];

    for (const file of persistedLogFiles(true)) {
      try {
        rmSync(file, { force: true });
      } catch {
        // Diagnostics cannot be allowed to break app control flow.
      }
    }
  },

  logsDirectory(): string | undefined {
    return state.logsDirectory;
  }
};

export function log(input: AppLoggerInput): void {
  const timestamp = new Date().toISOString();
  const sequence = ++state.sequence;
  const category = redactDiagnosticText(input.category).slice(0, 80) || "misc";
  const message = redactDiagnosticText(input.message).slice(0, 1_000) || "event";
  const metadataLine = metadataText(input.metadata);
  const formattedLine = [
    `[${timestamp}]`,
    `[${input.level.toUpperCase()}]`,
    `[${category}]`,
    message,
    metadataLine
  ].filter(Boolean).join(" ");
  const entry: DiagnosticsLogEntry = {
    id: `log:${Date.parse(timestamp)}:${sequence}`,
    timestamp,
    level: input.level,
    category,
    message,
    ...(metadataLine.length === 0 ? {} : { metadataLine }),
    formattedLine
  };

  state.ring.push(entry);

  if (state.ring.length > maxInMemoryEntries) {
    state.ring.splice(0, state.ring.length - maxInMemoryEntries);
  }

  if (levelOrder[input.level] >= levelOrder.info) {
    appendPersistedLine(formattedLine);
  }
}

function metadataText(metadata: object | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return "";
  }

  const redacted = redactLogValue(metadata);

  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) {
    return "";
  }

  return Object.entries(redacted)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${redactDiagnosticText(key)}=${redactDiagnosticText(String(value))}`)
    .join(" ")
    .slice(0, 2_000);
}

function ensureLogsDirectory(): void {
  if (!state.logsDirectory) {
    return;
  }

  try {
    mkdirSync(state.logsDirectory, { recursive: true });
  } catch {
    // Logging is best-effort.
  }
}

function currentLogPath(): string | undefined {
  return state.logsDirectory ? join(state.logsDirectory, currentLogName) : undefined;
}

function appendPersistedLine(line: string): void {
  const file = currentLogPath();

  if (!file) {
    return;
  }

  try {
    ensureLogsDirectory();
    appendFileSync(file, `${line}\n`, "utf8");
    rotateIfNeeded(file);
  } catch {
    // Logging is best-effort.
  }
}

function rotateIfNeeded(file: string): void {
  if (!existsSync(file) || statSync(file).size <= maxFileBytes) {
    return;
  }

  for (let index = rotationKeep; index >= 1; index -= 1) {
    const source = `${file}.${index}`;
    const target = `${file}.${index + 1}`;

    if (!existsSync(source)) {
      continue;
    }

    try {
      if (index === rotationKeep) {
        rmSync(source, { force: true });
      } else {
        rmSync(target, { force: true });
        writeFileSync(target, readFileSync(source));
        rmSync(source, { force: true });
      }
    } catch {
      // Continue best-effort rotation.
    }
  }

  try {
    writeFileSync(`${file}.1`, readFileSync(file));
    writeFileSync(file, "");
  } catch {
    // Logging is best-effort.
  }
}

function persistedLogFiles(includeMissing = false): string[] {
  const file = currentLogPath();

  if (!file || !state.logsDirectory) {
    return [];
  }

  try {
    mkdirSync(state.logsDirectory, { recursive: true });
    readdirSync(state.logsDirectory);
  } catch {
    return [];
  }

  const rotated = Array.from({ length: rotationKeep }, (_, index) => `${file}.${rotationKeep - index}`);
  const files = [...rotated, file];

  return includeMissing ? files : files.filter((candidate) => existsSync(candidate));
}

function safeReadFile(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
