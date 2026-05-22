import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

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

export interface SqliteConnection extends SqliteExecutor {
  readonly databasePath: string;
  executeTransaction(operations: readonly SqliteWriteOperation[]): void;
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

const PYTHON_SQLITE_RUNNER = String.raw`
import json
import sqlite3
import sys

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
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 30000")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection

def normalize_params(params):
    if params is None:
        return []
    return params

def row_to_dict(row):
    return {key: row[key] for key in row.keys()}

connection = None

try:
    command = json.load(sys.stdin)
    connection = connect(command["path"])
    kind = command["kind"]

    if kind == "exec":
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

class PythonBackedSqliteConnection implements SqliteConnection {
  readonly databasePath: string;
  private closed = false;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
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

  close(): void {
    this.closed = true;
  }

  private execute<T>(command: Record<string, unknown>): T {
    const stdout = execFileSync(PYTHON_BINARY, ["-c", PYTHON_SQLITE_RUNNER], {
      input: JSON.stringify(command),
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 16,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8"
      }
    });

    const response = JSON.parse(stdout) as PythonSqliteResponse<T>;

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

export function createSqliteConnection(databasePath: string): SqliteConnection {
  const parentDirectory = dirname(databasePath);

  if (!existsSync(parentDirectory)) {
    mkdirSync(parentDirectory, { recursive: true });
  }

  const connection = new PythonBackedSqliteConnection(databasePath);
  connection.exec("PRAGMA foreign_keys = ON;");
  return connection;
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

function mkTemporaryDirectory(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
