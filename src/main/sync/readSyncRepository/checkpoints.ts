import type { JsonValue } from "@shared/domain/localData";
import type { SqliteConnection } from "../../data/sqliteConnection";
import type { GoogleCheckpointDiagnostics } from "./types";
import { checkpointId } from "./ids";

export function readCheckpoint(
  connection: SqliteConnection,
  request: {
    accountId: string;
    resourceType: string;
    resourceId: string;
    checkpointType: string;
  }
): string | null {
  const row = connection.get<{ checkpoint_value: string }>(
    `SELECT checkpoint_value
     FROM google_sync_checkpoints
     WHERE account_id = ? AND resource_type = ? AND resource_id = ? AND checkpoint_type = ?;`,
    [request.accountId, request.resourceType, request.resourceId, request.checkpointType]
  );

  return row?.checkpoint_value ?? null;
}

export function saveCheckpoint(
  connection: SqliteConnection,
  request: {
    accountId: string;
    resourceType: string;
    resourceId: string;
    checkpointType: string;
    checkpointValue: string;
    metadata?: JsonValue;
    now: string;
  }
): void {
  const id = checkpointId(request.accountId, request.resourceType, request.resourceId, request.checkpointType);

  connection.run(
    `INSERT INTO google_sync_checkpoints (
      id, account_id, resource_type, resource_id, checkpoint_type, checkpoint_value,
      metadata_json, last_successful_sync_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, resource_type, resource_id, checkpoint_type) DO UPDATE SET
      checkpoint_value = excluded.checkpoint_value,
      metadata_json = excluded.metadata_json,
      last_successful_sync_at = excluded.last_successful_sync_at,
      updated_at = excluded.updated_at;`,
    [
      id,
      request.accountId,
      request.resourceType,
      request.resourceId,
      request.checkpointType,
      request.checkpointValue,
      JSON.stringify(request.metadata ?? {}),
      request.now,
      request.now
    ]
  );
}

export function clearCheckpoint(
  connection: SqliteConnection,
  request: {
    accountId: string;
    resourceType: string;
    resourceId: string;
    checkpointType: string;
  }
): void {
  connection.run(
    `DELETE FROM google_sync_checkpoints
     WHERE account_id = ? AND resource_type = ? AND resource_id = ? AND checkpoint_type = ?;`,
    [request.accountId, request.resourceType, request.resourceId, request.checkpointType]
  );
}

export function checkpointDiagnostics(connection: SqliteConnection): GoogleCheckpointDiagnostics {
  const row = connection.get<{
    totalCount: number;
    tasksCount: number;
    calendarCount: number;
    lastUpdatedAt: string | null;
  }>(
    `SELECT
       COUNT(*) AS totalCount,
       COALESCE(SUM(CASE WHEN resource_type = 'tasks' OR resource_type = 'task_list' THEN 1 ELSE 0 END), 0) AS tasksCount,
       COALESCE(SUM(CASE WHEN resource_type = 'calendar' THEN 1 ELSE 0 END), 0) AS calendarCount,
       MAX(updated_at) AS lastUpdatedAt
     FROM google_sync_checkpoints;`
  );

  return {
    totalCount: row?.totalCount ?? 0,
    tasksCount: row?.tasksCount ?? 0,
    calendarCount: row?.calendarCount ?? 0,
    ...(row?.lastUpdatedAt ? { lastUpdatedAt: row.lastUpdatedAt } : {})
  };
}

export function clearAllCheckpoints(connection: SqliteConnection): void {
  connection.run("DELETE FROM google_sync_checkpoints;");
}
