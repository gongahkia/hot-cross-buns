use serde::Serialize;
use tauri::State;

use crate::db;
use crate::state::AppState;
use crate::sync::client::SyncClient;
use crate::sync::tracker;

/// Summary returned to the frontend after a sync round-trip.
#[derive(Debug, Clone, Serialize)]
pub struct SyncStatus {
    pub pushed: u32,
    pub pulled: u32,
    pub conflicts: u32,
}

/// Perform a full sync cycle: push local changes, then pull and apply remote changes.
///
/// For now the sync server URL and auth token are hard-coded placeholders.
/// A real implementation would read these from app settings / user preferences.
#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> Result<SyncStatus, String> {
    let conn = db::get_connection(&state.db_path)?;

    // Ensure the new_value column exists before any sync operations.
    tracker::ensure_new_value_column(&conn)?;

    // 1. Gather pending local changes (everything since epoch for the first sync).
    let last_sync_at = get_last_sync_time(&conn);
    let pending = tracker::get_pending_changes(&conn, &last_sync_at);

    let client = SyncClient {
        base_url: "http://localhost:8080".to_string(),
        auth_token: None,
        device_id: "desktop-device".to_string(),
    };

    // 2. Push local changes.
    let pushed_count = if pending.is_empty() {
        0u32
    } else {
        let push_result = client.push_changes(pending).await?;
        push_result.accepted
    };

    // 3. Pull remote changes.
    let pull_result = client.pull_changes(&last_sync_at).await?;
    let pulled_count = pull_result.changes.len() as u32;

    // 4. Apply each remote change locally.
    let mut conflicts = 0u32;
    for change in &pull_result.changes {
        if let Err(_) = tracker::apply_remote_change(&conn, change) {
            conflicts += 1;
        }
    }

    // 5. Persist the new sync timestamp.
    save_last_sync_time(&conn);

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
fn save_last_sync_time(conn: &rusqlite::Connection) {
    let now = iso8601_now();
    let _ = conn.execute(
        "INSERT INTO sync_meta (entity_type, entity_id, field_name, new_value, updated_at, device_id)
         VALUES ('__sync', 'last_sync', 'timestamp', ?1, ?1, 'desktop-device')
         ON CONFLICT (entity_type, entity_id, field_name)
         DO UPDATE SET new_value = ?1, updated_at = ?1",
        rusqlite::params![now],
    );
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
