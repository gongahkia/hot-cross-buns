import type { JsonValue } from "@shared/domain/localData";
import type { SqliteConnection } from "../../data/sqliteConnection";

export function parseJsonValue(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return {};
  }
}

export function parseJsonStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function parseJsonNumberArray(value: string): number[] {
  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed)
      ? parsed.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
      : [];
  } catch {
    return [];
  }
}

export function countRows(connection: SqliteConnection, sql: string): number {
  return connection.get<{ count: number }>(sql)?.count ?? 0;
}
