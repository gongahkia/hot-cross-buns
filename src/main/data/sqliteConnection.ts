import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { Database, Statement } from "better-sqlite3";

export type SqlitePrimitive = string | number | boolean | null;
export type SqliteParams = readonly SqlitePrimitive[] | Record<string, SqlitePrimitive>;

export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | null;
}

export interface SqliteWriteOperation {
  kind: "exec" | "run";
  sql: string;
  params?: SqliteParams;
}

export interface SqliteWriteExecutor {
  exec(sql: string): void;
  run(sql: string, params?: SqliteParams): SqliteRunResult;
}

export interface SqliteExecutor extends SqliteWriteExecutor {
  query<T extends Record<string, unknown>>(sql: string, params?: SqliteParams): T[];
  get<T extends Record<string, unknown>>(sql: string, params?: SqliteParams): T | undefined;
}

export interface SqlitePreparedStatement {
  run(params?: SqliteParams): SqliteRunResult;
  query<T extends Record<string, unknown>>(params?: SqliteParams): T[];
  get<T extends Record<string, unknown>>(params?: SqliteParams): T | undefined;
}

export interface SqliteConnection extends SqliteExecutor {
  readonly databasePath: string;
  readonly adapterKind: "better-sqlite3" | "python-subprocess-compat";
  prepare(sql: string): SqlitePreparedStatement;
  executeTransaction(operations: readonly SqliteWriteOperation[]): void;
  pragma<T extends Record<string, unknown>>(sql: string): T[];
  close(): void;
}

export interface TemporarySqliteConnection {
  connection: SqliteConnection;
  databasePath: string;
  directory: string;
  cleanup: () => void;
}

export interface AppSqliteConnectionOptions {
  appSupportDirectory: string;
  filename?: string;
}

export class SqliteExecutionError extends Error {
  readonly sqliteType: string | undefined;

  constructor(message: string, sqliteType?: string) {
    super(message);
    this.name = "SqliteExecutionError";
    this.sqliteType = sqliteType;
  }
}

const DEFAULT_DATABASE_FILENAME = "hot-cross-buns-2.sqlite3";
const PYTHON_BINARY = process.env.HCB_SQLITE_PYTHON ?? "python3";
const nodeRequire = createRequire(__filename);

const PRODUCTION_PRAGMAS = [
  "foreign_keys = ON",
  "journal_mode = WAL",
  "synchronous = NORMAL",
  "temp_store = MEMORY",
  "cache_size = -65536",
  "mmap_size = 268435456",
  "busy_timeout = 30000"
] as const;

class BetterSqliteConnection implements SqliteConnection {
  readonly databasePath: string;
  readonly adapterKind = "better-sqlite3" as const;
  private readonly database: Database;
  private readonly statementCache = new Map<string, Statement>();
  private closed = false;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    const DatabaseConstructor = loadBetterSqlite3();
    this.database = new DatabaseConstructor(databasePath);
    this.applyProductionPragmas();
  }

  exec(sql: string): void {
    this.ensureOpen();

    try {
      this.database.exec(sql);
    } catch (error) {
      throw sqliteError(error);
    }
  }

  query<T extends Record<string, unknown>>(sql: string, params?: SqliteParams): T[] {
    return this.prepare(sql).query<T>(params);
  }

  get<T extends Record<string, unknown>>(sql: string, params?: SqliteParams): T | undefined {
    return this.prepare(sql).get<T>(params);
  }

  run(sql: string, params?: SqliteParams): SqliteRunResult {
    return this.prepare(sql).run(params);
  }

  prepare(sql: string): SqlitePreparedStatement {
    this.ensureOpen();

    try {
      let statement = this.statementCache.get(sql);

      if (statement === undefined) {
        statement = this.database.prepare(sql);
        this.statementCache.set(sql, statement);
      }

      return new BetterSqlitePreparedStatement(statement);
    } catch (error) {
      throw sqliteError(error);
    }
  }

  executeTransaction(operations: readonly SqliteWriteOperation[]): void {
    this.ensureOpen();

    if (operations.length === 0) {
      return;
    }

    try {
      this.database.exec("BEGIN IMMEDIATE;");

      try {
        for (const operation of operations) {
          if (operation.kind === "exec") {
            this.database.exec(operation.sql);
          } else {
            runPreparedStatement(this.cachedStatement(operation.sql), operation.params);
          }
        }

        this.database.exec("COMMIT;");
      } catch (error) {
        try {
          this.database.exec("ROLLBACK;");
        } catch {
          // Preserve the original SQLite error.
        }

        throw error;
      }
    } catch (error) {
      throw sqliteError(error);
    }
  }

  pragma<T extends Record<string, unknown>>(sql: string): T[] {
    this.ensureOpen();

    try {
      return this.database.pragma(sql, { simple: false }) as T[];
    } catch (error) {
      throw sqliteError(error);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.statementCache.clear();
    this.database.close();
    this.closed = true;
  }

  private cachedStatement(sql: string): Statement {
    let statement = this.statementCache.get(sql);

    if (statement === undefined) {
      statement = this.database.prepare(sql);
      this.statementCache.set(sql, statement);
    }

    return statement;
  }

  private applyProductionPragmas(): void {
    for (const pragma of PRODUCTION_PRAGMAS) {
      this.database.pragma(pragma);
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new SqliteExecutionError("SQLite connection is closed");
    }
  }
}

class BetterSqlitePreparedStatement implements SqlitePreparedStatement {
  constructor(private readonly statement: Statement) {}

  run(params?: SqliteParams): SqliteRunResult {
    try {
      return runPreparedStatement(this.statement, params);
    } catch (error) {
      throw sqliteError(error);
    }
  }

  query<T extends Record<string, unknown>>(params?: SqliteParams): T[] {
    try {
      const normalizedParams = normalizeParams(params);

      return (normalizedParams === undefined
        ? this.statement.all()
        : this.statement.all(normalizedParams)) as T[];
    } catch (error) {
      throw sqliteError(error);
    }
  }

  get<T extends Record<string, unknown>>(params?: SqliteParams): T | undefined {
    try {
      const normalizedParams = normalizeParams(params);

      return (normalizedParams === undefined
        ? this.statement.get()
        : this.statement.get(normalizedParams)) as T | undefined;
    } catch (error) {
      throw sqliteError(error);
    }
  }
}

const PYTHON_SQLITE_RUNNER = String.raw`
import json
import sqlite3
import sys

CONNECTION_PRAGMAS = (
    "PRAGMA foreign_keys = ON",
    "PRAGMA synchronous = NORMAL",
    "PRAGMA temp_store = MEMORY",
    "PRAGMA cache_size = -65536",
    "PRAGMA mmap_size = 268435456",
    "PRAGMA busy_timeout = 30000",
)

def split_sql_script(script):
    statements = []
    buffer = ""
    for line in script.splitlines(True):
        buffer += line
        if sqlite3.complete_statement(buffer):
            statement = buffer.strip()
            if statement:
                statements.append(statement)
            buffer = ""
    if buffer.strip():
        statements.append(buffer.strip())
    return statements

def connect(path):
    connection = sqlite3.connect(path, timeout=30)
    connection.row_factory = sqlite3.Row
    for pragma in CONNECTION_PRAGMAS:
        connection.execute(pragma)
    return connection

def normalize_params(params):
    if params is None:
        return []
    if isinstance(params, list):
        return [int(value) if isinstance(value, bool) else value for value in params]
    if isinstance(params, dict):
        return {key: int(value) if isinstance(value, bool) else value for key, value in params.items()}
    return params

def row_to_dict(row):
    return {key: row[key] for key in row.keys()}

connection = None

try:
    command = json.load(sys.stdin)
    connection = connect(command["path"])
    kind = command["kind"]

    if kind == "initialize":
        connection.execute("PRAGMA journal_mode = WAL")
        result = {"changes": connection.total_changes}
    elif kind == "exec":
        connection.executescript(command["sql"])
        connection.commit()
        result = {"changes": connection.total_changes}
    elif kind == "query":
        cursor = connection.execute(command["sql"], normalize_params(command.get("params")))
        result = {"rows": [row_to_dict(row) for row in cursor.fetchall()]}
    elif kind == "run":
        cursor = connection.execute(command["sql"], normalize_params(command.get("params")))
        connection.commit()
        result = {
            "changes": max(cursor.rowcount, 0),
            "lastInsertRowid": cursor.lastrowid,
        }
    elif kind == "pragma":
        cursor = connection.execute("PRAGMA " + command["sql"])
        result = {"rows": [row_to_dict(row) for row in cursor.fetchall()]}
    elif kind == "transaction":
        operation_results = []
        connection.isolation_level = None
        connection.execute("BEGIN IMMEDIATE")
        try:
            for operation in command["operations"]:
                if operation["kind"] == "exec":
                    for statement in split_sql_script(operation["sql"]):
                        connection.execute(statement)
                    operation_results.append({"changes": connection.total_changes})
                elif operation["kind"] == "run":
                    cursor = connection.execute(
                        operation["sql"],
                        normalize_params(operation.get("params")),
                    )
                    operation_results.append({
                        "changes": max(cursor.rowcount, 0),
                        "lastInsertRowid": cursor.lastrowid,
                    })
                else:
                    raise ValueError("Unsupported transaction operation")
            connection.execute("COMMIT")
        except Exception:
            try:
                connection.execute("ROLLBACK")
            except Exception:
                pass
            raise
        result = {"operations": operation_results}
    else:
        raise ValueError("Unsupported SQLite command kind")

    print(json.dumps({"ok": True, "result": result}, separators=(",", ":")))
except Exception as error:
    print(json.dumps({
        "ok": False,
        "error": {
            "type": type(error).__name__,
            "message": str(error),
        },
    }, separators=(",", ":")))
finally:
    if connection is not None:
        connection.close()
`;

interface PythonSqliteResponse<T> {
  ok: boolean;
  result?: T;
  error?: {
    type: string;
    message: string;
  };
}

class PythonCompatSqliteConnection implements SqliteConnection {
  readonly adapterKind = "python-subprocess-compat" as const;
  private closed = false;

  constructor(readonly databasePath: string) {
    this.execute<{ changes: number }>({ kind: "initialize", path: this.databasePath });
  }

  exec(sql: string): void {
    this.ensureOpen();
    this.execute<{ changes: number }>({ kind: "exec", path: this.databasePath, sql });
  }

  query<T extends Record<string, unknown>>(sql: string, params?: SqliteParams): T[] {
    this.ensureOpen();
    return this.execute<{ rows: T[] }>({
      kind: "query",
      path: this.databasePath,
      sql,
      params
    }).rows;
  }

  get<T extends Record<string, unknown>>(sql: string, params?: SqliteParams): T | undefined {
    return this.query<T>(sql, params)[0];
  }

  run(sql: string, params?: SqliteParams): SqliteRunResult {
    this.ensureOpen();
    return this.execute<SqliteRunResult>({
      kind: "run",
      path: this.databasePath,
      sql,
      params
    });
  }

  prepare(sql: string): SqlitePreparedStatement {
    return new PythonCompatPreparedStatement(this, sql);
  }

  executeTransaction(operations: readonly SqliteWriteOperation[]): void {
    this.ensureOpen();

    if (operations.length === 0) {
      return;
    }

    this.execute<{ operations: SqliteRunResult[] }>({
      kind: "transaction",
      path: this.databasePath,
      operations
    });
  }

  pragma<T extends Record<string, unknown>>(sql: string): T[] {
    this.ensureOpen();
    return this.execute<{ rows: T[] }>({
      kind: "pragma",
      path: this.databasePath,
      sql
    }).rows;
  }

  close(): void {
    this.closed = true;
  }

  private execute<T>(command: Record<string, unknown>): T {
    let stdout: string;

    try {
      stdout = execFileSync(PYTHON_BINARY, ["-c", PYTHON_SQLITE_RUNNER], {
        input: JSON.stringify(command),
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 16,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8"
        }
      });
    } catch (error) {
      throw pythonSqliteSubprocessError(error);
    }

    let response: PythonSqliteResponse<T>;

    try {
      response = JSON.parse(stdout) as PythonSqliteResponse<T>;
    } catch {
      throw new SqliteExecutionError(
        "SQLite compatibility runner returned invalid JSON",
        "PythonSqliteProtocolError"
      );
    }

    if (!response.ok || response.result === undefined) {
      throw new SqliteExecutionError(
        response.error?.message ?? "SQLite command failed",
        response.error?.type
      );
    }

    return response.result;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new SqliteExecutionError("SQLite connection is closed");
    }
  }
}

function pythonSqliteSubprocessError(error: unknown): SqliteExecutionError {
  const processError = error as Error & {
    signal?: string | null;
    status?: number | null;
    stderr?: Buffer | string;
  };
  const stderr = processOutputText(processError.stderr);
  const detail = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-1)[0];
  const reason = processError.signal
    ? `interrupted by ${processError.signal}`
    : processError.status === null || processError.status === undefined
      ? "failed"
      : `exited with ${processError.status}`;

  return new SqliteExecutionError(
    `SQLite compatibility runner ${reason}${detail ? `: ${detail}` : ""}`,
    "PythonSqliteSubprocessError"
  );
}

function processOutputText(output: Buffer | string | undefined): string {
  if (output === undefined) {
    return "";
  }

  return Buffer.isBuffer(output) ? output.toString("utf8") : output;
}

class PythonCompatPreparedStatement implements SqlitePreparedStatement {
  constructor(
    private readonly connection: PythonCompatSqliteConnection,
    private readonly sql: string
  ) {}

  run(params?: SqliteParams): SqliteRunResult {
    return this.connection.run(this.sql, params);
  }

  query<T extends Record<string, unknown>>(params?: SqliteParams): T[] {
    return this.connection.query<T>(this.sql, params);
  }

  get<T extends Record<string, unknown>>(params?: SqliteParams): T | undefined {
    return this.connection.get<T>(this.sql, params);
  }
}

export function createSqliteConnection(databasePath: string): SqliteConnection {
  const parentDirectory = dirname(databasePath);

  if (!existsSync(parentDirectory)) {
    mkdirSync(parentDirectory, { recursive: true });
  }

  try {
    return new BetterSqliteConnection(databasePath);
  } catch (error) {
    if (!isNativeBindingLoadFailure(error)) {
      throw error;
    }

    return new PythonCompatSqliteConnection(databasePath);
  }
}

export function createAppSqliteConnection(
  options: AppSqliteConnectionOptions
): SqliteConnection {
  const databaseDirectory = join(options.appSupportDirectory, "data");
  const databasePath = join(databaseDirectory, options.filename ?? DEFAULT_DATABASE_FILENAME);

  return createSqliteConnection(databasePath);
}

export function createTemporarySqliteConnection(
  prefix = "hcb2-sqlite-"
): TemporarySqliteConnection {
  const directory = mkTemporaryDirectory(prefix);
  const databasePath = join(directory, DEFAULT_DATABASE_FILENAME);
  const connection = createSqliteConnection(databasePath);

  return {
    connection,
    databasePath,
    directory,
    cleanup: () => {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

function runPreparedStatement(statement: Statement, params?: SqliteParams): SqliteRunResult {
  const normalizedParams = normalizeParams(params);
  const result =
    normalizedParams === undefined ? statement.run() : statement.run(normalizedParams);

  return {
    changes: result.changes,
    lastInsertRowid:
      typeof result.lastInsertRowid === "number"
        ? result.lastInsertRowid
        : Number(result.lastInsertRowid)
  };
}

function normalizeParams(
  params: SqliteParams | undefined
): readonly (string | number | null)[] | Record<string, string | number | null> | undefined {
  if (params === undefined) {
    return undefined;
  }

  if (Array.isArray(params)) {
    return params.map(sqliteValue);
  }

  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, sqliteValue(value)])
  );
}

function sqliteValue(value: SqlitePrimitive): string | number | null {
  return typeof value === "boolean" ? Number(value) : value;
}

function sqliteError(error: unknown): SqliteExecutionError {
  if (error instanceof SqliteExecutionError) {
    return error;
  }

  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: string };

    return new SqliteExecutionError(error.message, errorWithCode.code ?? error.name);
  }

  return new SqliteExecutionError("SQLite command failed");
}

function isNativeBindingLoadFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const errorWithCode = error as Error & { code?: string };
  const message = `${errorWithCode.message} ${errorWithCode.code ?? ""}`.toLowerCase();

  return (
    message.includes("node_module_version") ||
    message.includes("was compiled against a different node.js version") ||
    message.includes("cannot find module") ||
    message.includes("better_sqlite3.node")
  );
}

function loadBetterSqlite3(): new (filename: string) => Database {
  return nodeRequire("better-sqlite3") as new (filename: string) => Database;
}

function mkTemporaryDirectory(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
