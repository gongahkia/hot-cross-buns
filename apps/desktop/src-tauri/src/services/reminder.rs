/// Desktop notification support: check for tasks due soon and mark them as notified.

use rusqlite::Connection;

use crate::models::task::Task;

/// Query tasks whose `due_date` falls within the next 15 minutes and that have
/// not yet been marked as notified.  Returns a list of matching [`Task`] structs.
///
/// The implementation relies on an optional `notified_at` column that may not
/// exist in older schema versions – if the column is missing the query silently
/// returns an empty vec so the rest of the app is unaffected.
pub fn check_due_tasks(conn: &Connection) -> Vec<Task> {
    // We compare ISO-8601 datetime strings directly – SQLite handles this fine
    // as long as both sides use the same format.
    let sql = r#"
        SELECT id, list_id, parent_task_id, title, content, priority, status,
               due_date, due_timezone, recurrence_rule, sort_order,
               completed_at, created_at, updated_at, deleted_at
        FROM tasks
        WHERE deleted_at IS NULL
          AND status = 0
          AND due_date IS NOT NULL
          AND datetime(due_date) IS NOT NULL
          AND datetime(due_date) <= datetime('now', '+15 minutes')
          AND datetime(due_date) >= datetime('now')
          AND id NOT IN (SELECT task_id FROM notified_tasks)
    "#;

    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows = stmt.query_map([], |row| {
        Ok(Task {
            id: row.get(0)?,
            list_id: row.get(1)?,
            parent_task_id: row.get(2)?,
            title: row.get(3)?,
            content: row.get(4)?,
            priority: row.get(5)?,
            status: row.get(6)?,
            due_date: row.get(7)?,
            due_timezone: row.get(8)?,
            recurrence_rule: row.get(9)?,
            sort_order: row.get(10)?,
            completed_at: row.get(11)?,
            created_at: row.get(12)?,
            updated_at: row.get(13)?,
            deleted_at: row.get(14)?,
            subtasks: Vec::new(),
            tags: Vec::new(),
        })
    });

    match rows {
        Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
        Err(_) => Vec::new(),
    }
}

/// Record that a notification was already sent for `task_id` so that
/// [`check_due_tasks`] will not return it again.
///
/// Creates the `notified_tasks` table if it does not already exist.
pub fn mark_notified(conn: &Connection, task_id: &str) {
    // Ensure the bookkeeping table exists.
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS notified_tasks (
            task_id TEXT PRIMARY KEY,
            notified_at TEXT NOT NULL
        );",
    );

    let _ = conn.execute(
        "INSERT OR IGNORE INTO notified_tasks (task_id, notified_at) VALUES (?1, datetime('now'))",
        [task_id],
    );
}

/// Clear the notified marker for a task so it can be surfaced again if its
/// due date or completion state changes.
pub fn clear_notified(conn: &Connection, task_id: &str) {
    let _ = conn.execute("DELETE FROM notified_tasks WHERE task_id = ?1", [task_id]);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn setup_test_db() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().expect("failed to create temp dir");
        let db_path = tmp.path().to_path_buf();
        let conn = db::init_db(&db_path).expect("failed to init db");

        conn.execute(
            "INSERT INTO lists (id, name, color, sort_order, is_inbox, created_at, updated_at)
             VALUES ('list-1', 'Inbox', NULL, 0, 1, datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert list");

        (tmp, db_path)
    }

    #[test]
    fn test_check_due_tasks_returns_due_soon_items_once() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("open db");

        conn.execute(
            "INSERT INTO tasks (id, list_id, title, priority, status, due_date, sort_order, created_at, updated_at)
             VALUES ('task-1', 'list-1', 'Soon', 0, 0, datetime('now', '+10 minutes'), 0, datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert task");

        let due = check_due_tasks(&conn);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, "task-1");

        mark_notified(&conn, "task-1");
        let after_mark = check_due_tasks(&conn);
        assert!(after_mark.is_empty());
    }

    #[test]
    fn test_clear_notified_rearms_task() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("open db");

        conn.execute(
            "INSERT INTO tasks (id, list_id, title, priority, status, due_date, sort_order, created_at, updated_at)
             VALUES ('task-1', 'list-1', 'Soon', 0, 0, datetime('now', '+5 minutes'), 0, datetime('now'), datetime('now'))",
            [],
        )
        .expect("insert task");

        mark_notified(&conn, "task-1");
        clear_notified(&conn, "task-1");

        let due = check_due_tasks(&conn);
        assert_eq!(due.len(), 1);
    }
}
