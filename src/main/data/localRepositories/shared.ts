import { HcbPublicError } from "@shared/ipc/result";
import type { SqliteConnection, SqliteParams } from "../sqliteConnection";
import type { PageWindow } from "./types";

export function nullIfEmpty(value: string): string | null {
  const trimmed = value.trim();

  return trimmed.length === 0 ? null : trimmed;
}

export function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

export function googleEventIdFromLocalEventId(id: string): string {
  return id.split(":").at(-1) ?? id;
}

export function boolInt(value: boolean): number {
  return value ? 1 : 0;
}

export function pageBounds(
  cursor: string | undefined,
  requestedLimit: number | undefined,
  defaultLimit: number,
  maxLimit: number
): { limit: number; offset: number } {
  const limit = Math.max(1, Math.min(maxLimit, requestedLimit ?? defaultLimit));
  const parsed = cursor === undefined ? 0 : Number.parseInt(cursor, 10);

  return {
    limit,
    offset: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  };
}

export function pageFromRows<T>(
  items: T[],
  limit: number,
  offset: number,
  totalKnown: number
): PageWindow<T> {
  const nextOffset = offset + items.length;

  return {
    items,
    page: {
      limit,
      ...(nextOffset < totalKnown ? { nextCursor: String(nextOffset) } : {}),
      totalKnown
    }
  };
}

export function countRows(connection: SqliteConnection, sql: string, params?: SqliteParams): number {
  return connection.get<{ count: number }>(sql, params)?.count ?? 0;
}

export function dateOnlyToIso(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return `${value}T00:00:00.000Z`;
}

export function isoToDateOnly(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function validationFailure(message: string): HcbPublicError {
  return new HcbPublicError({
    code: "VALIDATION_ERROR",
    message,
    recoverable: true
  });
}

export function notFound(message: string): HcbPublicError {
  return new HcbPublicError({
    code: "VALIDATION_ERROR",
    message,
    recoverable: true
  });
}

export function validationFailed(message: string): HcbPublicError {
  return new HcbPublicError({
    code: "VALIDATION_ERROR",
    message,
    recoverable: true
  });
}

export function parseStringArray(value: string | null): string[] {
  if (value === null || value.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function parseNumberArray(value: string | null): number[] {
  if (value === null || value.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed)
      ? parsed.filter((item): item is number => Number.isInteger(item))
      : [];
  } catch {
    return [];
  }
}
