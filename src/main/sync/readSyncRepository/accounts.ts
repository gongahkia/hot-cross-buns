import { sanitizeGoogleAccountConnectionStatus } from "../../google";
import type { SqliteConnection } from "../../data/sqliteConnection";
import type { GoogleAccountConnectionStatusDto } from "../../google";
import { parseJsonStringArray } from "./json";

interface GoogleAccountRow extends Record<string, unknown> {
  id: string;
  google_account_id: string | null;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  locale: string | null;
  time_zone: string | null;
  connection_state: GoogleAccountConnectionStatusDto["connectionState"];
  granted_scopes_json: string;
  last_authenticated_at: string | null;
  updated_at: string;
}

export function upsertAccountStatus(
  connection: SqliteConnection,
  status: GoogleAccountConnectionStatusDto
): void {
  connection.run(
    `INSERT INTO google_accounts (
      id, google_account_id, email, display_name, avatar_url, locale, time_zone,
      connection_state, granted_scopes_json, missing_scopes_json, last_authenticated_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      google_account_id = excluded.google_account_id,
      email = excluded.email,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      locale = excluded.locale,
      time_zone = excluded.time_zone,
      connection_state = excluded.connection_state,
      granted_scopes_json = excluded.granted_scopes_json,
      missing_scopes_json = excluded.missing_scopes_json,
      last_authenticated_at = excluded.last_authenticated_at,
      updated_at = excluded.updated_at,
      deleted_at = NULL;`,
    [
      status.accountId,
      status.googleAccountId ?? null,
      status.email ?? null,
      status.displayName ?? null,
      status.avatarUrl ?? null,
      status.locale ?? null,
      status.timeZone ?? null,
      status.connectionState,
      JSON.stringify(status.grantedScopes),
      JSON.stringify(status.missingScopes),
      status.lastAuthenticatedAt ?? null,
      status.updatedAt
    ]
  );
}

export function latestAccountStatus(
  connection: SqliteConnection
): GoogleAccountConnectionStatusDto | null {
  const row = connection.get<GoogleAccountRow>(
    `SELECT
       id,
       google_account_id,
       email,
       display_name,
       avatar_url,
       locale,
       time_zone,
       connection_state,
       granted_scopes_json,
       last_authenticated_at,
       updated_at
     FROM google_accounts
     WHERE deleted_at IS NULL
     ORDER BY updated_at DESC
     LIMIT 1;`
  );

  return row === undefined ? null : accountStatusFromRow(row);
}

export function accountStatuses(
  connection: SqliteConnection
): GoogleAccountConnectionStatusDto[] {
  const rows = connection.query<GoogleAccountRow>(
    `SELECT
       id,
       google_account_id,
       email,
       display_name,
       avatar_url,
       locale,
       time_zone,
       connection_state,
       granted_scopes_json,
       last_authenticated_at,
       updated_at
     FROM google_accounts
     WHERE deleted_at IS NULL
     ORDER BY connection_state = 'connected' DESC, updated_at DESC, id ASC;`
  );

  return rows.map(accountStatusFromRow);
}

export function accountStatus(
  connection: SqliteConnection,
  accountId: string
): GoogleAccountConnectionStatusDto | null {
  const row = connection.get<GoogleAccountRow>(
    `SELECT
       id,
       google_account_id,
       email,
       display_name,
       avatar_url,
       locale,
       time_zone,
       connection_state,
       granted_scopes_json,
       last_authenticated_at,
       updated_at
     FROM google_accounts
     WHERE deleted_at IS NULL
       AND id = ?
     LIMIT 1;`,
    [accountId]
  );

  return row === undefined ? null : accountStatusFromRow(row);
}

function accountStatusFromRow(row: GoogleAccountRow): GoogleAccountConnectionStatusDto {
  return sanitizeGoogleAccountConnectionStatus({
    accountId: row.id,
    ...(row.google_account_id === null ? {} : { googleAccountId: row.google_account_id }),
    ...(row.email === null ? {} : { email: row.email }),
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    locale: row.locale,
    timeZone: row.time_zone,
    connectionState: row.connection_state,
    grantedScopes: parseJsonStringArray(row.granted_scopes_json),
    ...(row.last_authenticated_at === null ? {} : { lastAuthenticatedAt: row.last_authenticated_at }),
    updatedAt: row.updated_at
  });
}
