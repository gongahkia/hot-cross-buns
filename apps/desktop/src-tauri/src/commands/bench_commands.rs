use tauri::State;
use uuid::Uuid;

use crate::db;
use crate::state::AppState;

/// Return the current UTC time formatted as an ISO 8601 string (e.g. "2026-03-22T10:30:00Z").
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

/// Convert days since 1970-01-01 to (year, month, day).
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

/// Seed benchmark data: creates 10 lists and `task_count` tasks distributed
/// evenly across those lists using batch inserts within a single transaction.
///
/// This command is intended for local performance testing only.
#[tauri::command]
pub fn seed_benchmark_data(
    state: State<'_, AppState>,
    task_count: u32,
) -> Result<(), String> {
    let conn = db::get_connection(&state.db_path)?;
    let now = iso8601_now();

    // Use a transaction for atomicity and performance.
    conn.execute("BEGIN", [])
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    // Create 10 benchmark lists.
    let mut list_ids: Vec<String> = Vec::with_capacity(10);
    for i in 0..10 {
        let id = Uuid::now_v7().to_string();
        conn.execute(
            "INSERT INTO lists (id, name, color, sort_order, is_inbox, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
            rusqlite::params![
                id,
                format!("Bench List {}", i + 1),
                format!("#{:02x}{:02x}{:02x}", (i * 25) % 256, 100, 200),
                i,
                now,
                now,
            ],
        )
        .map_err(|e| {
            let _ = conn.execute("ROLLBACK", []);
            format!("Failed to insert benchmark list: {}", e)
        })?;
        list_ids.push(id);
    }

    // Create task_count tasks distributed across the 10 lists.
    // Use a prepared statement for batch insert efficiency.
    {
        let mut stmt = conn
            .prepare(
                "INSERT INTO tasks (id, list_id, parent_task_id, title, content, priority, status, \
                 sort_order, created_at, updated_at) \
                 VALUES (?1, ?2, NULL, ?3, ?4, ?5, 0, ?6, ?7, ?8)",
            )
            .map_err(|e| {
                let _ = conn.execute("ROLLBACK", []);
                format!("Failed to prepare benchmark task insert: {}", e)
            })?;

        for i in 0..task_count {
            let id = Uuid::now_v7().to_string();
            let list_id = &list_ids[(i as usize) % list_ids.len()];
            let priority = (i % 4) as i32; // cycle through 0-3

            stmt.execute(rusqlite::params![
                id,
                list_id,
                format!("Bench Task {}", i + 1),
                format!("Benchmark task content for task {}", i + 1),
                priority,
                i as i32,
                now,
                now,
            ])
            .map_err(|e| {
                let _ = conn.execute("ROLLBACK", []);
                format!("Failed to insert benchmark task {}: {}", i + 1, e)
            })?;
        }
    }

    conn.execute("COMMIT", [])
        .map_err(|e| format!("Failed to commit benchmark data: {}", e))?;

    Ok(())
}
