use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::db;
use crate::models::SyncSettings;
use crate::state::AppState;
use crate::sync::client::{PullResult, PushResult, SyncChangePayload, SyncClient};
use crate::sync::tracker;

/// Summary returned to the frontend after a sync round-trip.
#[derive(Debug, Clone, Serialize)]
pub struct SyncStatus {
    pub pushed: u32,
    pub pulled: u32,
    pub conflicts: u32,
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
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::Bool(flag) => {
            if *flag {
                "1".to_string()
            } else {
                "0".to_string()
            }
        }
        serde_json::Value::Number(number) => number.to_string(),
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => value.to_string(),
    }
}

fn row_to_sync_settings(row: &rusqlite::Row) -> rusqlite::Result<SyncSettings> {
    let auto_sync_enabled: i32 = row.get(3)?;

    Ok(SyncSettings {
        server_url: row.get(0)?,
        auth_token: row.get(1)?,
        device_id: row.get(2)?,
        auto_sync_enabled: auto_sync_enabled != 0,
        last_synced_at: row.get(4)?,
    })
}

fn default_sync_settings() -> SyncSettings {
    SyncSettings {
        server_url: String::new(),
        auth_token: String::new(),
        device_id: Uuid::now_v7().to_string(),
        auto_sync_enabled: false,
        last_synced_at: None,
    }
}

fn save_sync_settings_record(
    conn: &rusqlite::Connection,
    settings: &SyncSettings,
) -> Result<SyncSettings, String> {
    conn.execute(
        "INSERT INTO sync_settings (id, server_url, auth_token, device_id, auto_sync_enabled, last_synced_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
           server_url = excluded.server_url,
           auth_token = excluded.auth_token,
           device_id = excluded.device_id,
           auto_sync_enabled = excluded.auto_sync_enabled,
           last_synced_at = excluded.last_synced_at",
        rusqlite::params![
            &settings.server_url,
            &settings.auth_token,
            &settings.device_id,
            if settings.auto_sync_enabled { 1 } else { 0 },
            &settings.last_synced_at,
        ],
    )
    .map_err(|e| format!("Failed to save sync settings: {}", e))?;

    Ok(settings.clone())
}

fn get_or_create_sync_settings(conn: &rusqlite::Connection) -> Result<SyncSettings, String> {
    let existing = conn
        .query_row(
            "SELECT server_url, auth_token, device_id, auto_sync_enabled, last_synced_at
             FROM sync_settings WHERE id = 1",
            [],
            row_to_sync_settings,
        )
        .optional()
        .map_err(|e| format!("Failed to load sync settings: {}", e))?;

    if let Some(settings) = existing {
        return Ok(settings);
    }

    let settings = default_sync_settings();
    save_sync_settings_record(conn, &settings)
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

/// Perform a full sync cycle: push local changes, then pull and apply remote changes.
#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> Result<SyncStatus, String> {
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

    let client = SyncClient {
        base_url: settings.server_url.clone(),
        auth_token: if settings.auth_token.is_empty() {
            None
        } else {
            Some(settings.auth_token.clone())
        },
        device_id: settings.device_id.clone(),
    };

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
    let mut conflicts = push_result.as_ref().map(|result| result.conflicts).unwrap_or(0);
    for change in &pull_result.changes {
        let local_change = transport_change_to_tracked(change);
        if tracker::apply_remote_change(&conn, &local_change).is_err() {
            conflicts += 1;
        }
    }

    // 5. Persist the new sync timestamp.
    let synced_at = iso8601_now();
    save_last_sync_time(&conn, &settings.device_id, &synced_at);
    save_last_synced_at(&conn, &settings, &synced_at)?;

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

/// Persist the current time as the last-sync timestamp.
fn save_last_sync_time(conn: &rusqlite::Connection, device_id: &str, synced_at: &str) {
    let _ = conn.execute(
        "INSERT INTO sync_meta (entity_type, entity_id, field_name, new_value, updated_at, device_id)
         VALUES ('__sync', 'last_sync', 'timestamp', ?1, ?1, ?2)
         ON CONFLICT (entity_type, entity_id, field_name)
         DO UPDATE SET new_value = ?1, updated_at = ?1",
        rusqlite::params![synced_at, device_id],
    );
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
    fn test_get_or_create_sync_settings_creates_default_record() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("failed to open connection");

        let settings = get_or_create_sync_settings(&conn).expect("failed to get sync settings");

        assert_eq!(settings.server_url, "");
        assert_eq!(settings.auth_token, "");
        assert!(!settings.device_id.is_empty());
        assert!(!settings.auto_sync_enabled);
        assert!(settings.last_synced_at.is_none());
    }

    #[test]
    fn test_save_sync_settings_persists_values() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("failed to open connection");

        let settings = SyncSettings {
            server_url: "https://sync.example.com".to_string(),
            auth_token: "secret-token".to_string(),
            device_id: "desktop-123".to_string(),
            auto_sync_enabled: true,
            last_synced_at: Some("2026-03-22T00:00:00Z".to_string()),
        };

        save_sync_settings_record(&conn, &settings).expect("failed to save sync settings");
        let loaded = get_or_create_sync_settings(&conn).expect("failed to reload sync settings");

        assert_eq!(loaded.server_url, settings.server_url);
        assert_eq!(loaded.auth_token, settings.auth_token);
        assert_eq!(loaded.device_id, settings.device_id);
        assert!(loaded.auto_sync_enabled);
        assert_eq!(loaded.last_synced_at, settings.last_synced_at);
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
}
