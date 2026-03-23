use std::collections::HashMap;

use rusqlite::params;
use tauri::State;
use uuid::Uuid;

use crate::db;
use crate::models::{Tag, Task};
use crate::state::AppState;
use crate::sync::changes;

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

/// Build a Task from a row returned by the standard SELECT column order.
fn row_to_task(row: &rusqlite::Row) -> rusqlite::Result<Task> {
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
}

const TASK_COLUMNS: &str = "id, list_id, parent_task_id, title, content, priority, status, \
    due_date, due_timezone, recurrence_rule, sort_order, completed_at, created_at, updated_at, deleted_at";

/// Fetch tags for a set of task IDs and return them grouped by task_id.
fn fetch_tags_for_tasks(
    conn: &rusqlite::Connection,
    task_ids: &[String],
) -> Result<HashMap<String, Vec<Tag>>, String> {
    if task_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders: Vec<String> = (1..=task_ids.len()).map(|i| format!("?{}", i)).collect();
    let sql = format!(
        "SELECT tt.task_id, t.id, t.name, t.color, t.created_at \
         FROM task_tags tt JOIN tags t ON t.id = tt.tag_id \
         WHERE tt.task_id IN ({}) AND t.deleted_at IS NULL",
        placeholders.join(", ")
    );

    let params_boxed: Vec<Box<dyn rusqlite::types::ToSql>> = task_ids
        .iter()
        .map(|id| Box::new(id.clone()) as Box<dyn rusqlite::types::ToSql>)
        .collect();
    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        params_boxed.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare tag query: {}", e))?;

    let rows = stmt
        .query_map(params_refs.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                Tag {
                    id: row.get(1)?,
                    name: row.get(2)?,
                    color: row.get(3)?,
                    created_at: row.get(4)?,
                    deleted_at: None,
                },
            ))
        })
        .map_err(|e| format!("Failed to query tags: {}", e))?;

    let mut map: HashMap<String, Vec<Tag>> = HashMap::new();
    for row_result in rows {
        let (task_id, tag) = row_result.map_err(|e| format!("Failed to read tag row: {}", e))?;
        map.entry(task_id).or_default().push(tag);
    }
    Ok(map)
}

/// Load a single task by ID, including its subtasks and tags.
fn load_task_full(conn: &rusqlite::Connection, id: &str) -> Result<Task, String> {
    let sql = format!(
        "SELECT {} FROM tasks WHERE id = ?1 AND deleted_at IS NULL",
        TASK_COLUMNS
    );
    let mut task = conn
        .query_row(&sql, params![id], row_to_task)
        .map_err(|e| format!("Task not found: {}", e))?;

    // Load subtasks.
    let subtask_sql = format!(
        "SELECT {} FROM tasks WHERE parent_task_id = ?1 AND deleted_at IS NULL ORDER BY sort_order",
        TASK_COLUMNS
    );
    let mut stmt = conn
        .prepare(&subtask_sql)
        .map_err(|e| format!("Failed to prepare subtask query: {}", e))?;
    let subtasks: Vec<Task> = stmt
        .query_map(params![id], row_to_task)
        .map_err(|e| format!("Failed to query subtasks: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read subtask row: {}", e))?;

    // Collect all IDs for tag lookup.
    let mut all_ids: Vec<String> = vec![task.id.clone()];
    for st in &subtasks {
        all_ids.push(st.id.clone());
    }

    let tag_map = fetch_tags_for_tasks(conn, &all_ids)?;

    task.tags = tag_map.get(&task.id).cloned().unwrap_or_default();
    task.subtasks = subtasks
        .into_iter()
        .map(|mut st| {
            st.tags = tag_map.get(&st.id).cloned().unwrap_or_default();
            st
        })
        .collect();

    Ok(task)
}

fn get_active_subtask_ids(
    conn: &rusqlite::Connection,
    parent_task_id: &str,
) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id FROM tasks WHERE parent_task_id = ?1 AND deleted_at IS NULL ORDER BY sort_order",
        )
        .map_err(|e| format!("Failed to prepare subtask id query: {}", e))?;

    let rows = stmt
        .query_map(params![parent_task_id], |row| row.get(0))
        .map_err(|e| format!("Failed to query subtask ids: {}", e))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read subtask id row: {}", e))
}

#[tauri::command]
pub fn create_task(
    state: State<'_, AppState>,
    list_id: String,
    title: String,
    content: Option<String>,
    priority: Option<i32>,
    due_date: Option<String>,
    due_timezone: Option<String>,
    recurrence_rule: Option<String>,
    parent_task_id: Option<String>,
) -> Result<Task, String> {
    let conn = db::get_connection(&state.db_path)?;

    // Validate nesting depth: subtasks cannot themselves have subtasks (depth <= 1).
    if let Some(ref parent_id) = parent_task_id {
        let parent_has_parent: bool = conn
            .query_row(
                "SELECT parent_task_id IS NOT NULL FROM tasks WHERE id = ?1 AND deleted_at IS NULL",
                params![parent_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Parent task not found: {}", e))?;

        if parent_has_parent {
            return Err("Subtask nesting beyond one level is not allowed".to_string());
        }
    }

    let id = Uuid::now_v7().to_string();
    let now = iso8601_now();
    let priority = priority.unwrap_or(0);

    conn.execute(
        "INSERT INTO tasks (id, list_id, parent_task_id, title, content, priority, status, \
         due_date, due_timezone, recurrence_rule, sort_order, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?9, 0, ?10, ?11)",
        params![
            id,
            list_id,
            parent_task_id,
            title,
            content,
            priority,
            due_date,
            due_timezone,
            recurrence_rule,
            now,
            now,
        ],
    )
    .map_err(|e| format!("Failed to insert task: {}", e))?;

    let task = load_task_full(&conn, &id)?;
    changes::record_task_upsert(&conn, &task)?;

    Ok(task)
}

#[tauri::command]
pub fn get_tasks_by_list(
    state: State<'_, AppState>,
    list_id: String,
    include_completed: bool,
) -> Result<Vec<Task>, String> {
    let conn = db::get_connection(&state.db_path)?;

    // Fetch top-level tasks for this list.
    let base_filter = if include_completed {
        "list_id = ?1 AND parent_task_id IS NULL AND deleted_at IS NULL"
    } else {
        "list_id = ?1 AND parent_task_id IS NULL AND deleted_at IS NULL AND status = 0"
    };
    let sql = format!(
        "SELECT {} FROM tasks WHERE {} ORDER BY sort_order",
        TASK_COLUMNS, base_filter
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare task query: {}", e))?;
    let top_tasks: Vec<Task> = stmt
        .query_map(params![list_id], row_to_task)
        .map_err(|e| format!("Failed to query tasks: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read task row: {}", e))?;

    if top_tasks.is_empty() {
        return Ok(Vec::new());
    }

    let top_ids: Vec<String> = top_tasks.iter().map(|t| t.id.clone()).collect();

    // Fetch all subtasks for these top-level tasks in one query.
    let subtask_filter = if include_completed {
        "parent_task_id IS NOT NULL AND deleted_at IS NULL"
    } else {
        "parent_task_id IS NOT NULL AND deleted_at IS NULL AND status = 0"
    };

    let placeholders: Vec<String> = (1..=top_ids.len()).map(|i| format!("?{}", i)).collect();
    let subtask_sql = format!(
        "SELECT {} FROM tasks WHERE parent_task_id IN ({}) AND {} ORDER BY sort_order",
        TASK_COLUMNS,
        placeholders.join(", "),
        subtask_filter
    );

    let sub_params_boxed: Vec<Box<dyn rusqlite::types::ToSql>> = top_ids
        .iter()
        .map(|id| Box::new(id.clone()) as Box<dyn rusqlite::types::ToSql>)
        .collect();
    let sub_params_refs: Vec<&dyn rusqlite::types::ToSql> =
        sub_params_boxed.iter().map(|p| p.as_ref()).collect();

    let mut sub_stmt = conn
        .prepare(&subtask_sql)
        .map_err(|e| format!("Failed to prepare subtask query: {}", e))?;
    let all_subtasks: Vec<Task> = sub_stmt
        .query_map(sub_params_refs.as_slice(), row_to_task)
        .map_err(|e| format!("Failed to query subtasks: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read subtask row: {}", e))?;

    // Group subtasks by parent_task_id.
    let mut subtask_map: HashMap<String, Vec<Task>> = HashMap::new();
    for st in all_subtasks {
        if let Some(ref pid) = st.parent_task_id {
            subtask_map.entry(pid.clone()).or_default().push(st);
        }
    }

    // Collect all task IDs (top + subtasks) for tag lookup.
    let mut all_ids: Vec<String> = top_ids.clone();
    for subs in subtask_map.values() {
        for st in subs {
            all_ids.push(st.id.clone());
        }
    }

    let tag_map = fetch_tags_for_tasks(&conn, &all_ids)?;

    // Assemble the final result.
    let tasks = top_tasks
        .into_iter()
        .map(|mut t| {
            t.tags = tag_map.get(&t.id).cloned().unwrap_or_default();
            t.subtasks = subtask_map
                .remove(&t.id)
                .unwrap_or_default()
                .into_iter()
                .map(|mut st| {
                    st.tags = tag_map.get(&st.id).cloned().unwrap_or_default();
                    st
                })
                .collect();
            t
        })
        .collect();

    Ok(tasks)
}

#[tauri::command]
pub fn get_task(state: State<'_, AppState>, id: String) -> Result<Task, String> {
    let conn = db::get_connection(&state.db_path)?;
    load_task_full(&conn, &id)
}

/// Shared helper: query top-level tasks matching a date filter, attach subtasks + tags.
fn fetch_tasks_by_date_filter(
    conn: &rusqlite::Connection,
    date_filter: &str,
) -> Result<Vec<Task>, String> {
    let sql = format!(
        "SELECT {} FROM tasks WHERE deleted_at IS NULL AND status = 0 \
         AND parent_task_id IS NULL AND {} \
         ORDER BY priority DESC, sort_order ASC",
        TASK_COLUMNS, date_filter
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare date query: {}", e))?;
    let top_tasks: Vec<Task> = stmt
        .query_map([], row_to_task)
        .map_err(|e| format!("Failed to query tasks: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read task row: {}", e))?;

    if top_tasks.is_empty() {
        return Ok(Vec::new());
    }

    let top_ids: Vec<String> = top_tasks.iter().map(|t| t.id.clone()).collect();

    // Fetch subtasks for these top-level tasks.
    let placeholders: Vec<String> = (1..=top_ids.len()).map(|i| format!("?{}", i)).collect();
    let subtask_sql = format!(
        "SELECT {} FROM tasks WHERE parent_task_id IN ({}) \
         AND deleted_at IS NULL AND status = 0 ORDER BY sort_order",
        TASK_COLUMNS,
        placeholders.join(", ")
    );

    let sub_params_boxed: Vec<Box<dyn rusqlite::types::ToSql>> = top_ids
        .iter()
        .map(|id| Box::new(id.clone()) as Box<dyn rusqlite::types::ToSql>)
        .collect();
    let sub_params_refs: Vec<&dyn rusqlite::types::ToSql> =
        sub_params_boxed.iter().map(|p| p.as_ref()).collect();

    let mut sub_stmt = conn
        .prepare(&subtask_sql)
        .map_err(|e| format!("Failed to prepare subtask query: {}", e))?;
    let all_subtasks: Vec<Task> = sub_stmt
        .query_map(sub_params_refs.as_slice(), row_to_task)
        .map_err(|e| format!("Failed to query subtasks: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read subtask row: {}", e))?;

    // Group subtasks by parent_task_id.
    let mut subtask_map: HashMap<String, Vec<Task>> = HashMap::new();
    for st in all_subtasks {
        if let Some(ref pid) = st.parent_task_id {
            subtask_map.entry(pid.clone()).or_default().push(st);
        }
    }

    // Collect all task IDs (top + subtasks) for tag lookup.
    let mut all_ids: Vec<String> = top_ids.clone();
    for subs in subtask_map.values() {
        for st in subs {
            all_ids.push(st.id.clone());
        }
    }

    let tag_map = fetch_tags_for_tasks(conn, &all_ids)?;

    // Assemble the final result.
    let tasks = top_tasks
        .into_iter()
        .map(|mut t| {
            t.tags = tag_map.get(&t.id).cloned().unwrap_or_default();
            t.subtasks = subtask_map
                .remove(&t.id)
                .unwrap_or_default()
                .into_iter()
                .map(|mut st| {
                    st.tags = tag_map.get(&st.id).cloned().unwrap_or_default();
                    st
                })
                .collect();
            t
        })
        .collect();

    Ok(tasks)
}

#[tauri::command]
pub fn get_tasks_due_today(state: State<'_, AppState>) -> Result<Vec<Task>, String> {
    let conn = db::get_connection(&state.db_path)?;
    fetch_tasks_by_date_filter(&conn, "date(due_date) = date('now')")
}

#[tauri::command]
pub fn get_overdue_tasks(state: State<'_, AppState>) -> Result<Vec<Task>, String> {
    let conn = db::get_connection(&state.db_path)?;
    fetch_tasks_by_date_filter(&conn, "date(due_date) < date('now')")
}

#[tauri::command]
pub fn update_task(
    state: State<'_, AppState>,
    id: String,
    title: Option<String>,
    content: Option<String>,
    priority: Option<i32>,
    status: Option<i32>,
    due_date: Option<String>,
    due_timezone: Option<String>,
    recurrence_rule: Option<String>,
    sort_order: Option<i32>,
) -> Result<Task, String> {
    let conn = db::get_connection(&state.db_path)?;
    let now = iso8601_now();

    let mut set_clauses: Vec<String> = Vec::new();
    let mut params_boxed: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref v) = title {
        set_clauses.push(format!("title = ?{}", params_boxed.len() + 1));
        params_boxed.push(Box::new(v.clone()));
    }
    if let Some(ref v) = content {
        set_clauses.push(format!("content = ?{}", params_boxed.len() + 1));
        params_boxed.push(Box::new(v.clone()));
    }
    if let Some(v) = priority {
        set_clauses.push(format!("priority = ?{}", params_boxed.len() + 1));
        params_boxed.push(Box::new(v));
    }
    if let Some(v) = status {
        set_clauses.push(format!("status = ?{}", params_boxed.len() + 1));
        params_boxed.push(Box::new(v));

        // Auto-set completed_at when marking as complete (1) or clearing it (0).
        if v == 1 {
            set_clauses.push(format!("completed_at = ?{}", params_boxed.len() + 1));
            params_boxed.push(Box::new(now.clone()));
        } else {
            set_clauses.push(format!("completed_at = ?{}", params_boxed.len() + 1));
            params_boxed.push(Box::new(None::<String>));
        }
    }
    if let Some(ref v) = due_date {
        set_clauses.push(format!("due_date = ?{}", params_boxed.len() + 1));
        params_boxed.push(Box::new(v.clone()));
    }
    if let Some(ref v) = due_timezone {
        set_clauses.push(format!("due_timezone = ?{}", params_boxed.len() + 1));
        params_boxed.push(Box::new(v.clone()));
    }
    if let Some(ref v) = recurrence_rule {
        set_clauses.push(format!("recurrence_rule = ?{}", params_boxed.len() + 1));
        params_boxed.push(Box::new(v.clone()));
    }
    if let Some(v) = sort_order {
        set_clauses.push(format!("sort_order = ?{}", params_boxed.len() + 1));
        params_boxed.push(Box::new(v));
    }

    if set_clauses.is_empty() {
        return Err("No fields to update".to_string());
    }

    // Always bump updated_at.
    set_clauses.push(format!("updated_at = ?{}", params_boxed.len() + 1));
    params_boxed.push(Box::new(now));

    let id_idx = params_boxed.len() + 1;
    params_boxed.push(Box::new(id.clone()));

    let sql = format!(
        "UPDATE tasks SET {} WHERE id = ?{} AND deleted_at IS NULL",
        set_clauses.join(", "),
        id_idx
    );

    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        params_boxed.iter().map(|p| p.as_ref()).collect();

    let rows_affected = conn
        .execute(&sql, params_refs.as_slice())
        .map_err(|e| format!("Failed to update task: {}", e))?;

    if rows_affected == 0 {
        return Err("Task not found or already deleted".to_string());
    }

    let task = load_task_full(&conn, &id)?;

    if let Some(ref value) = title {
        changes::record_field_change(&conn, "task", &task.id, "title", value)?;
    }
    if let Some(ref value) = content {
        changes::record_field_change(&conn, "task", &task.id, "content", value)?;
    }
    if let Some(value) = priority {
        changes::record_field_change(&conn, "task", &task.id, "priority", &value)?;
    }
    if let Some(value) = status {
        changes::record_field_change(&conn, "task", &task.id, "status", &value)?;
        changes::record_field_change(&conn, "task", &task.id, "completed_at", &task.completed_at)?;
    }
    if let Some(ref value) = due_date {
        changes::record_field_change(&conn, "task", &task.id, "due_date", value)?;
    }
    if let Some(ref value) = due_timezone {
        changes::record_field_change(&conn, "task", &task.id, "due_timezone", value)?;
    }
    if let Some(ref value) = recurrence_rule {
        changes::record_field_change(&conn, "task", &task.id, "recurrence_rule", value)?;
    }
    if let Some(value) = sort_order {
        changes::record_field_change(&conn, "task", &task.id, "sort_order", &value)?;
    }

    Ok(task)
}

#[tauri::command]
pub fn delete_task(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = db::get_connection(&state.db_path)?;
    let now = iso8601_now();
    let subtask_ids = get_active_subtask_ids(&conn, &id)?;

    // Soft-delete the task itself.
    let rows_affected = conn
        .execute(
            "UPDATE tasks SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![now, id],
        )
        .map_err(|e| format!("Failed to soft-delete task: {}", e))?;

    if rows_affected == 0 {
        return Err("Task not found or already deleted".to_string());
    }

    // Soft-delete all subtasks of this task.
    conn.execute(
        "UPDATE tasks SET deleted_at = ?1, updated_at = ?1 WHERE parent_task_id = ?2 AND deleted_at IS NULL",
        params![now, id],
    )
    .map_err(|e| format!("Failed to soft-delete subtasks: {}", e))?;

    changes::record_deleted_at(&conn, "task", &id, &now)?;
    for subtask_id in subtask_ids {
        changes::record_deleted_at(&conn, "task", &subtask_id, &now)?;
    }

    Ok(())
}

#[tauri::command]
pub fn get_tasks_in_range(
    state: State<'_, AppState>,
    start_date: String,
    end_date: String,
) -> Result<Vec<Task>, String> {
    let conn = db::get_connection(&state.db_path)?;

    let sql = format!(
        "SELECT {} FROM tasks WHERE deleted_at IS NULL AND due_date >= ?1 AND due_date <= ?2 \
         ORDER BY due_date, priority DESC",
        TASK_COLUMNS
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare range query: {}", e))?;
    let top_tasks: Vec<Task> = stmt
        .query_map(params![start_date, end_date], row_to_task)
        .map_err(|e| format!("Failed to query tasks in range: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read task row: {}", e))?;

    if top_tasks.is_empty() {
        return Ok(Vec::new());
    }

    // Collect all task IDs for tag lookup.
    let all_ids: Vec<String> = top_tasks.iter().map(|t| t.id.clone()).collect();
    let tag_map = fetch_tags_for_tasks(&conn, &all_ids)?;

    let tasks = top_tasks
        .into_iter()
        .map(|mut t| {
            t.tags = tag_map.get(&t.id).cloned().unwrap_or_default();
            t
        })
        .collect();

    Ok(tasks)
}

#[tauri::command]
pub fn move_task(
    state: State<'_, AppState>,
    id: String,
    new_list_id: String,
    new_sort_order: i32,
) -> Result<Task, String> {
    let conn = db::get_connection(&state.db_path)?;
    let now = iso8601_now();
    let subtask_ids = get_active_subtask_ids(&conn, &id)?;

    // Verify the target list exists and is not deleted.
    conn.query_row(
        "SELECT id FROM lists WHERE id = ?1 AND deleted_at IS NULL",
        params![new_list_id],
        |_row| Ok(()),
    )
    .map_err(|_| "Target list not found or deleted".to_string())?;

    // Move the task.
    let rows_affected = conn
        .execute(
            "UPDATE tasks SET list_id = ?1, sort_order = ?2, updated_at = ?3 WHERE id = ?4 AND deleted_at IS NULL",
            params![new_list_id, new_sort_order, now, id],
        )
        .map_err(|e| format!("Failed to move task: {}", e))?;

    if rows_affected == 0 {
        return Err("Task not found or already deleted".to_string());
    }

    // Also move subtasks to the new list.
    conn.execute(
        "UPDATE tasks SET list_id = ?1, updated_at = ?2 WHERE parent_task_id = ?3 AND deleted_at IS NULL",
        params![new_list_id, now, id],
    )
    .map_err(|e| format!("Failed to move subtasks: {}", e))?;

    let task = load_task_full(&conn, &id)?;
    changes::record_field_change(&conn, "task", &task.id, "list_id", &new_list_id)?;
    changes::record_field_change(&conn, "task", &task.id, "sort_order", &new_sort_order)?;
    for subtask_id in subtask_ids {
        changes::record_field_change(&conn, "task", &subtask_id, "list_id", &new_list_id)?;
    }

    Ok(task)
}

#[tauri::command]
pub fn preview_recurrence(
    rule: String,
    start_date: String,
    count: u32,
) -> Result<Vec<String>, String> {
    crate::services::recurrence::expand_rrule(&rule, &start_date, &start_date, count as usize)
}

#[tauri::command]
pub fn search_tasks(state: State<'_, AppState>, query: String) -> Result<Vec<Task>, String> {
    let conn = db::get_connection(&state.db_path)?;

    let sql = format!(
        "SELECT {} FROM tasks JOIN tasks_fts ON tasks.rowid = tasks_fts.rowid \
         WHERE tasks_fts MATCH ?1 AND tasks.deleted_at IS NULL \
         ORDER BY rank LIMIT 50",
        TASK_COLUMNS
            .split(", ")
            .map(|col| format!("tasks.{}", col))
            .collect::<Vec<_>>()
            .join(", ")
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare search query: {}", e))?;
    let tasks: Vec<Task> = stmt
        .query_map(params![query], row_to_task)
        .map_err(|e| format!("Failed to search tasks: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read search result row: {}", e))?;

    if tasks.is_empty() {
        return Ok(Vec::new());
    }

    // Attach tags to search results.
    let all_ids: Vec<String> = tasks.iter().map(|t| t.id.clone()).collect();
    let tag_map = fetch_tags_for_tasks(&conn, &all_ids)?;

    let tasks = tasks
        .into_iter()
        .map(|mut t| {
            t.tags = tag_map.get(&t.id).cloned().unwrap_or_default();
            t
        })
        .collect();

    Ok(tasks)
}

/// Complete a recurring task: advances its due_date to the next occurrence
/// based on its recurrence_rule, keeping the task open. Returns the updated task.
#[tauri::command]
pub fn complete_recurring_task(state: State<'_, AppState>, id: String) -> Result<Task, String> {
    let conn = db::get_connection(&state.db_path)?;
    let now = iso8601_now();

    // Load the task to inspect its recurrence_rule and due_date.
    let task = load_task_full(&conn, &id)?;

    let rrule = task
        .recurrence_rule
        .as_deref()
        .ok_or_else(|| "Task has no recurrence rule".to_string())?;

    let due_date = task
        .due_date
        .as_deref()
        .ok_or_else(|| "Recurring task has no due date".to_string())?;

    // Compute the next occurrence after the current due date.
    let next = crate::services::recurrence::next_occurrence(rrule, due_date, due_date)?
        .ok_or_else(|| "No further occurrences for this recurrence rule".to_string())?;

    // Advance the due date and keep the task open (status = 0).
    conn.execute(
        "UPDATE tasks SET status = 0, completed_at = NULL, due_date = ?1, updated_at = ?2 \
         WHERE id = ?3 AND deleted_at IS NULL",
        params![next, now, id],
    )
    .map_err(|e| format!("Failed to advance recurring task: {}", e))?;

    let updated_task = load_task_full(&conn, &id)?;
    changes::record_field_change(
        &conn,
        "task",
        &updated_task.id,
        "status",
        &updated_task.status,
    )?;
    changes::record_field_change(
        &conn,
        "task",
        &updated_task.id,
        "completed_at",
        &updated_task.completed_at,
    )?;
    changes::record_field_change(
        &conn,
        "task",
        &updated_task.id,
        "due_date",
        &updated_task.due_date,
    )?;

    Ok(updated_task)
}
