use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::db;
use crate::models::{SyncConflict, SyncSettings};
use crate::state::AppState;
use crate::sync::client::{PullResult, PushResult, SyncChangePayload, SyncClient};
use crate::sync::settings::{get_or_create_sync_settings, save_sync_settings_record};
use crate::sync::tracker;

/// Summary returned to the frontend after a sync round-trip.
#[derive(Debug, Clone, Serialize)]
pub struct SyncStatus {
    pub pushed: u32,
    pub pulled: u32,
    pub conflicts: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncHealth {
    pub pending_changes: u32,
    pub conflict_count: u32,
    pub last_sync_error: Option<String>,
}

fn tracked_change_to_transport(
    change: &tracker::TrackedChange,
) -> Result<SyncChangePayload, String> {
    let new_value = match serde_json::from_str::<serde_json::Value>(&change.new_value) {
        Ok(parsed) => parsed,
        Err(_) => serde_json::Value::String(change.new_value.clone()),
    };

    Ok(SyncChangePayload {
        entity_type: change.entity_type.clone(),
        entity_id: change.entity_id.clone(),
        field_name: change.field_name.clone(),
        new_value,
        timestamp: change.updated_at.clone(),
    })
}

fn transport_change_to_tracked(change: &SyncChangePayload) -> tracker::TrackedChange {
    tracker::TrackedChange {
        entity_type: change.entity_type.clone(),
        entity_id: change.entity_id.clone(),
        field_name: change.field_name.clone(),
        new_value: json_value_to_sql_text(&change.new_value),
        updated_at: change.timestamp.clone(),
        device_id: "remote".to_string(),
    }
}

fn json_value_to_sql_text(value: &serde_json::Value) -> String {
    value.to_string()
}

fn sync_client_from_settings(settings: &SyncSettings) -> SyncClient {
    SyncClient {
        base_url: settings.server_url.clone(),
        auth_token: if settings.auth_token.is_empty() {
            None
        } else {
            Some(settings.auth_token.clone())
        },
        device_id: settings.device_id.clone(),
    }
}

#[tauri::command]
pub fn get_sync_settings(state: State<'_, AppState>) -> Result<SyncSettings, String> {
    let conn = db::get_connection(&state.db_path)?;
    get_or_create_sync_settings(&conn)
}

#[tauri::command]
pub fn save_sync_settings(
    state: State<'_, AppState>,
    server_url: String,
    auth_token: String,
    device_id: Option<String>,
    auto_sync_enabled: bool,
    last_synced_at: Option<String>,
) -> Result<SyncSettings, String> {
    let conn = db::get_connection(&state.db_path)?;
    let existing = get_or_create_sync_settings(&conn)?;

    let resolved_device_id = device_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or(existing.device_id);

    let settings = SyncSettings {
        server_url: server_url.trim().to_string(),
        auth_token: auth_token.trim().to_string(),
        device_id: resolved_device_id,
        auto_sync_enabled,
        last_synced_at,
    };

    save_sync_settings_record(&conn, &settings)
}

#[tauri::command]
pub fn get_sync_health(state: State<'_, AppState>) -> Result<SyncHealth, String> {
    let conn = db::get_connection(&state.db_path)?;

    Ok(SyncHealth {
        pending_changes: tracker::count_pending_changes(&conn)?,
        conflict_count: tracker::count_sync_conflicts(&conn)?,
        last_sync_error: get_last_sync_error(&conn),
    })
}

#[tauri::command]
pub fn list_sync_conflicts(state: State<'_, AppState>) -> Result<Vec<SyncConflict>, String> {
    let conn = db::get_connection(&state.db_path)?;
    tracker::list_sync_conflicts(&conn)
}

#[tauri::command]
pub fn resolve_sync_conflict(
    state: State<'_, AppState>,
    entity_type: String,
    entity_id: String,
    field_name: String,
    resolution: String,
) -> Result<(), String> {
    let conn = db::get_connection(&state.db_path)?;
    let conflict = tracker::get_conflict(&conn, &entity_type, &entity_id, &field_name)?
        .ok_or_else(|| "Sync conflict not found".to_string())?;

    match resolution.as_str() {
        "keep_local" => {
            let local_value = get_latest_local_value(
                &conn,
                &conflict.entity_type,
                &conflict.entity_id,
                &conflict.field_name,
            )?
            .unwrap_or(conflict.local_value.clone());

            tracker::record_change(
                &conn,
                &conflict.entity_type,
                &conflict.entity_id,
                &conflict.field_name,
                &local_value,
            )?;
            tracker::resolve_conflict_status(
                &conn,
                &conflict.entity_type,
                &conflict.entity_id,
                &conflict.field_name,
                "resolved_keep_local",
            )?;
        }
        "apply_remote" => {
            let remote_change = tracker::TrackedChange {
                entity_type: conflict.entity_type.clone(),
                entity_id: conflict.entity_id.clone(),
                field_name: conflict.field_name.clone(),
                new_value: conflict.remote_value.clone(),
                updated_at: conflict.remote_updated_at.clone(),
                device_id: conflict
                    .remote_device_id
                    .clone()
                    .unwrap_or_else(|| "remote".to_string()),
            };

            tracker::apply_remote_change_force(&conn, &remote_change)?;
            tracker::resolve_conflict_status(
                &conn,
                &conflict.entity_type,
                &conflict.entity_id,
                &conflict.field_name,
                "resolved_apply_remote",
            )?;
        }
        other => {
            return Err(format!("Unknown sync conflict resolution: {}", other));
        }
    }

    Ok(())
}

#[tauri::command]
pub fn dismiss_sync_conflict(
    state: State<'_, AppState>,
    entity_type: String,
    entity_id: String,
    field_name: String,
) -> Result<(), String> {
    let conn = db::get_connection(&state.db_path)?;
    tracker::resolve_conflict_status(&conn, &entity_type, &entity_id, &field_name, "dismissed")
}

/// Perform a full sync cycle: push local changes, then pull and apply remote changes.
#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> Result<SyncStatus, String> {
    let result = run_sync(&state).await;

    if let Ok(conn) = db::get_connection(&state.db_path) {
        match &result {
            Ok(_) => {
                let _ = clear_last_sync_error(&conn);
            }
            Err(err) => {
                let _ = save_last_sync_error(&conn, err);
            }
        }
    }

    result
}

async fn run_sync(state: &State<'_, AppState>) -> Result<SyncStatus, String> {
    let conn = db::get_connection(&state.db_path)?;
    let settings = get_or_create_sync_settings(&conn)?;

    if settings.server_url.trim().is_empty() {
        return Err("Sync server URL is not configured".to_string());
    }

    // Ensure the new_value column exists before any sync operations.
    tracker::ensure_new_value_column(&conn)?;

    // 1. Gather pending local changes (everything since epoch for the first sync).
    let last_sync_at = get_last_sync_time(&conn);
    let pending = tracker::get_pending_changes(&conn, &last_sync_at);
    let transport_pending = pending
        .iter()
        .map(tracked_change_to_transport)
        .collect::<Result<Vec<_>, _>>()?;

    let client = sync_client_from_settings(&settings);

    // 2. Push local changes.
    let batch_id = Uuid::now_v7().to_string();
    let push_result = if transport_pending.is_empty() {
        None
    } else {
        Some(client.push_changes(&batch_id, transport_pending).await?)
    };

    let pushed_count = if let Some(PushResult { accepted, .. }) = &push_result {
        *accepted
    } else {
        0u32
    };

    // 3. Pull remote changes.
    let pull_result: PullResult = client.pull_changes(&last_sync_at).await?;
    let pulled_count = pull_result.changes.len() as u32;

    // 4. Apply each remote change locally.
    for change in &pull_result.changes {
        let local_change = transport_change_to_tracked(change);
        tracker::apply_remote_change(&conn, &local_change)?;
    }

    // 5. Persist the new sync timestamp.
    let synced_at = resolved_sync_watermark(&pull_result);
    save_last_sync_time(&conn, &settings.device_id, &synced_at);
    save_last_synced_at(&conn, &settings, &synced_at)?;
    clear_last_sync_error(&conn)?;

    let conflicts = tracker::count_sync_conflicts(&conn)?;

    Ok(SyncStatus {
        pushed: pushed_count,
        pulled: pulled_count,
        conflicts,
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Read the last successful sync timestamp from a simple key-value store in
/// sync_meta.  Returns the epoch string if no prior sync has been recorded.
fn get_last_sync_time(conn: &rusqlite::Connection) -> String {
    conn.query_row(
        "SELECT new_value FROM sync_meta WHERE entity_type = '__sync' AND entity_id = 'last_sync' AND field_name = 'timestamp'",
        [],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn get_latest_local_value(
    conn: &rusqlite::Connection,
    entity_type: &str,
    entity_id: &str,
    field_name: &str,
) -> Result<Option<String>, String> {
    let device_id = get_or_create_sync_settings(conn)?.device_id;
    conn.query_row(
        "SELECT new_value FROM sync_meta
         WHERE entity_type = ?1 AND entity_id = ?2 AND field_name = ?3 AND device_id = ?4",
        rusqlite::params![entity_type, entity_id, field_name, device_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("Failed to read latest local sync value: {}", e))
}

/// Persist the current time as the last-sync timestamp.
fn save_last_sync_time(conn: &rusqlite::Connection, device_id: &str, synced_at: &str) {
    let _ = tracker::ensure_new_value_column(conn);
    let _ = conn.execute(
        "INSERT INTO sync_meta (entity_type, entity_id, field_name, new_value, updated_at, device_id)
         VALUES ('__sync', 'last_sync', 'timestamp', ?1, ?1, ?2)
         ON CONFLICT (entity_type, entity_id, field_name)
         DO UPDATE SET new_value = ?1, updated_at = ?1",
        rusqlite::params![synced_at, device_id],
    );
}

fn save_last_sync_error(conn: &rusqlite::Connection, message: &str) -> Result<(), String> {
    let device_id = get_or_create_sync_settings(conn)?.device_id;
    let _ = tracker::ensure_new_value_column(conn);
    conn.execute(
        "INSERT INTO sync_meta (entity_type, entity_id, field_name, new_value, updated_at, device_id)
         VALUES ('__sync', 'last_error', 'message', ?1, ?2, ?3)
         ON CONFLICT (entity_type, entity_id, field_name)
         DO UPDATE SET new_value = excluded.new_value, updated_at = excluded.updated_at, device_id = excluded.device_id",
        rusqlite::params![message, iso8601_now(), device_id],
    )
    .map_err(|e| format!("Failed to save last sync error: {}", e))?;

    Ok(())
}

fn clear_last_sync_error(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "DELETE FROM sync_meta
         WHERE entity_type = '__sync' AND entity_id = 'last_error' AND field_name = 'message'",
        [],
    )
    .map_err(|e| format!("Failed to clear last sync error: {}", e))?;

    Ok(())
}

fn get_last_sync_error(conn: &rusqlite::Connection) -> Option<String> {
    conn.query_row(
        "SELECT new_value FROM sync_meta
         WHERE entity_type = '__sync' AND entity_id = 'last_error' AND field_name = 'message'",
        [],
        |row| row.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

fn save_last_synced_at(
    conn: &rusqlite::Connection,
    settings: &SyncSettings,
    synced_at: &str,
) -> Result<SyncSettings, String> {
    let mut updated = settings.clone();
    updated.last_synced_at = Some(synced_at.to_string());
    save_sync_settings_record(conn, &updated)
}

fn resolved_sync_watermark(pull_result: &PullResult) -> String {
    if pull_result.server_time.trim().is_empty() {
        iso8601_now()
    } else {
        pull_result.server_time.clone()
    }
}

fn iso8601_now() -> String {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("SystemTime before UNIX EPOCH");
    let secs = dur.as_secs();

    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    let (year, month, day) = days_to_ymd(days as i64);

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds
    )
}

fn days_to_ymd(epoch_days: i64) -> (i64, u32, u32) {
    let z = epoch_days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use serde_json::json;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn setup_test_db() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().expect("failed to create temp dir");
        let db_path = tmp.path().to_path_buf();
        db::init_db(&db_path).expect("failed to init test db");
        (tmp, db_path)
    }

    #[test]
    fn test_tracked_change_translates_to_server_transport_shape() {
        let tracked = tracker::TrackedChange {
            entity_type: "task".to_string(),
            entity_id: "task-1".to_string(),
            field_name: "title".to_string(),
            new_value: "Synced title".to_string(),
            updated_at: "2026-03-22T14:35:00Z".to_string(),
            device_id: "desktop-123".to_string(),
        };

        let payload = tracked_change_to_transport(&tracked).expect("translate tracked change");

        assert_eq!(payload.entity_type, "task");
        assert_eq!(payload.entity_id, "task-1");
        assert_eq!(payload.field_name, "title");
        assert_eq!(payload.new_value, json!("Synced title"));
        assert_eq!(payload.timestamp, "2026-03-22T14:35:00Z");
    }

    #[test]
    fn test_pull_response_change_translates_to_local_apply_record() {
        let payload = SyncChangePayload {
            entity_type: "task".to_string(),
            entity_id: "task-1".to_string(),
            field_name: "priority".to_string(),
            new_value: json!(3),
            timestamp: "2026-03-22T14:35:00Z".to_string(),
        };

        let tracked = transport_change_to_tracked(&payload);

        assert_eq!(tracked.entity_type, "task");
        assert_eq!(tracked.entity_id, "task-1");
        assert_eq!(tracked.field_name, "priority");
        assert_eq!(tracked.new_value, "3");
        assert_eq!(tracked.updated_at, "2026-03-22T14:35:00Z");
        assert_eq!(tracked.device_id, "remote");
    }

    #[test]
    fn test_pull_response_string_change_preserves_json_encoding() {
        let payload = SyncChangePayload {
            entity_type: "task".to_string(),
            entity_id: "task-1".to_string(),
            field_name: "title".to_string(),
            new_value: json!("Draft spec"),
            timestamp: "2026-03-22T14:35:00Z".to_string(),
        };

        let tracked = transport_change_to_tracked(&payload);

        assert_eq!(tracked.new_value, "\"Draft spec\"");
    }

    #[test]
    fn test_save_last_sync_time_uses_persisted_device_id() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("failed to open connection");
        let settings = SyncSettings {
            server_url: "https://sync.example.com".to_string(),
            auth_token: "secret-token".to_string(),
            device_id: "desktop-123".to_string(),
            auto_sync_enabled: true,
            last_synced_at: None,
        };

        save_sync_settings_record(&conn, &settings).expect("save sync settings");
        save_last_sync_time(&conn, &settings.device_id, "2026-03-22T15:00:00Z");

        let device_id: String = conn
            .query_row(
                "SELECT device_id FROM sync_meta
                 WHERE entity_type = '__sync' AND entity_id = 'last_sync' AND field_name = 'timestamp'",
                [],
                |row| row.get(0),
            )
            .expect("read persisted last sync device id");

        assert_eq!(device_id, "desktop-123");
    }

    #[test]
    fn test_sync_client_uses_persisted_device_id_for_push_and_pull() {
        let settings = SyncSettings {
            server_url: "https://sync.example.com".to_string(),
            auth_token: "secret-token".to_string(),
            device_id: "desktop-123".to_string(),
            auto_sync_enabled: true,
            last_synced_at: None,
        };

        let client = sync_client_from_settings(&settings);

        assert_eq!(client.device_id, "desktop-123");
        assert_eq!(client.base_url, "https://sync.example.com");
        assert_eq!(client.auth_token.as_deref(), Some("secret-token"));
    }

    #[test]
    fn test_resolved_sync_watermark_prefers_server_time() {
        let pull_result = PullResult {
            changes: Vec::new(),
            server_time: "2026-03-22T15:10:00Z".to_string(),
        };

        assert_eq!(
            resolved_sync_watermark(&pull_result),
            "2026-03-22T15:10:00Z".to_string()
        );
    }

    #[test]
    fn test_resolved_sync_watermark_falls_back_when_server_time_missing() {
        let pull_result = PullResult {
            changes: Vec::new(),
            server_time: "   ".to_string(),
        };

        let resolved = resolved_sync_watermark(&pull_result);
        assert!(!resolved.trim().is_empty());
        assert!(resolved.ends_with('Z'));
    }
}
