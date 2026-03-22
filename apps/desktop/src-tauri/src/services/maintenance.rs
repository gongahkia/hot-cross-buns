use rusqlite::Connection;

/// Run an incremental vacuum if the database has reclaimable pages.
///
/// This is lighter than a full VACUUM and can run without locking
/// the entire database for an extended period.
pub fn vacuum_if_needed(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA incremental_vacuum;")
        .map_err(|e| format!("incremental_vacuum failed: {}", e))
}

/// Run ANALYZE to refresh SQLite's query planner statistics.
pub fn analyze_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("ANALYZE;")
        .map_err(|e| format!("ANALYZE failed: {}", e))
}

/// Permanently remove rows that were soft-deleted more than `days` ago.
///
/// Targets the `tasks` and `lists` tables which use a `deleted_at` column
/// for soft-delete semantics.
pub fn purge_old_data(conn: &Connection, days: u32) -> Result<u64, String> {
    let threshold = format!("-{} days", days);
    let mut total_deleted: u64 = 0;

    let tables = ["tasks", "lists"];
    for table in &tables {
        let sql = format!(
            "DELETE FROM {} WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?1)",
            table
        );
        let count = conn
            .execute(&sql, rusqlite::params![threshold])
            .map_err(|e| format!("purge {} failed: {}", table, e))?;
        total_deleted += count as u64;
    }

    log::info!(
        "Purged {} rows older than {} days from soft-deleted tables",
        total_deleted,
        days
    );

    Ok(total_deleted)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tasks (
                id TEXT PRIMARY KEY,
                deleted_at TEXT
            );
            CREATE TABLE lists (
                id TEXT PRIMARY KEY,
                deleted_at TEXT
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_vacuum_if_needed() {
        let conn = setup_db();
        assert!(vacuum_if_needed(&conn).is_ok());
    }

    #[test]
    fn test_analyze_tables() {
        let conn = setup_db();
        assert!(analyze_tables(&conn).is_ok());
    }

    #[test]
    fn test_purge_old_data() {
        let conn = setup_db();

        // Insert a row deleted 100 days ago
        conn.execute(
            "INSERT INTO tasks (id, deleted_at) VALUES ('old', datetime('now', '-100 days'))",
            [],
        )
        .unwrap();

        // Insert a row deleted 1 day ago
        conn.execute(
            "INSERT INTO tasks (id, deleted_at) VALUES ('recent', datetime('now', '-1 day'))",
            [],
        )
        .unwrap();

        // Insert a non-deleted row
        conn.execute(
            "INSERT INTO tasks (id, deleted_at) VALUES ('active', NULL)",
            [],
        )
        .unwrap();

        let purged = purge_old_data(&conn, 30).unwrap();
        assert_eq!(purged, 1); // only the 100-day-old row

        // Verify 'recent' and 'active' still exist
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }
}
