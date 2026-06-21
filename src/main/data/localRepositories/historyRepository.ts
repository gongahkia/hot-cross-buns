import { randomUUID } from "node:crypto";
import type { DiagnosticsHistoryEntry } from "@shared/ipc/contracts";
import { redactDiagnosticText, redactLogValue } from "@shared/redaction";
import type { SqliteConnection } from "../sqliteConnection";

export interface LocalHistoryRecordInput {
  kind: string;
  summary: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

export class LocalHistoryRepository {
  constructor(private readonly connection: SqliteConnection) {}

  record(input: LocalHistoryRecordInput): void {
    const timestamp = input.timestamp ?? new Date().toISOString();
    const kind = redactDiagnosticText(input.kind).slice(0, 120) || "event";
    const summary = redactDiagnosticText(input.summary).slice(0, 1_000) || "History event";
    const resourceId = input.resourceId ? redactDiagnosticText(input.resourceId).slice(0, 256) : null;
    const metadata = redactLogValue(input.metadata ?? {});

    try {
      this.connection.run(
        `INSERT INTO local_history_entries
          (id, timestamp, kind, resource_id, summary, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?);`,
        [
          `history:${Date.parse(timestamp)}:${randomUUID()}`,
          timestamp,
          kind,
          resourceId,
          summary,
          JSON.stringify(metadata)
        ]
      );
    } catch {
      // History must not break user-facing mutations.
    }
  }

  listRecent(limit = 100): DiagnosticsHistoryEntry[] {
    const safeLimit = Math.max(1, Math.min(500, limit));

    return this.connection
      .query<{
        id: string;
        timestamp: string;
        kind: string;
        resourceId: string | null;
        summary: string;
        metadataJson: string;
      }>(
        `SELECT
           id,
           timestamp,
           kind,
           resource_id AS resourceId,
           summary,
           metadata_json AS metadataJson
         FROM local_history_entries
         ORDER BY timestamp DESC, id DESC
         LIMIT ?;`,
        [safeLimit]
      )
      .map((row) => {
        const metadataLine = metadataLineFromJson(row.metadataJson);

        return {
          id: row.id,
          timestamp: row.timestamp,
          kind: row.kind,
          summary: row.summary,
          ...(row.resourceId === null ? {} : { resourceId: row.resourceId }),
          ...(metadataLine.length === 0 ? {} : { metadataLine })
        };
      });
  }

  count(): number {
    return this.connection.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM local_history_entries;"
    )?.count ?? 0;
  }

  enforceRetention(limit: number): void {
    const safeLimit = Math.max(100, Math.min(50_000, limit));

    try {
      this.connection.run(
        `DELETE FROM local_history_entries
         WHERE id NOT IN (
           SELECT id
           FROM local_history_entries
           ORDER BY timestamp DESC, id DESC
           LIMIT ?
         );`,
        [safeLimit]
      );
    } catch {
      // Retention is best-effort.
    }
  }
}

function metadataLineFromJson(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "";
    }

    return Object.entries(parsed)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${redactDiagnosticText(key)}=${redactDiagnosticText(String(nested))}`)
      .join(" ")
      .slice(0, 2_000);
  } catch {
    return "";
  }
}
