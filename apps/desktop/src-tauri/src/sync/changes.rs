use serde::{Deserialize, Serialize};

use crate::models::{Area, List, Tag, Task};

use super::tracker;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagSnapshot {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: String,
    pub deleted_at: Option<String>,
}

pub fn record_serialized_change<T: Serialize>(
    conn: &rusqlite::Connection,
    entity_type: &str,
    entity_id: &str,
    field_name: &str,
    value: &T,
) -> Result<(), String> {
    let json = serde_json::to_string(value)
        .map_err(|e| format!("Failed to serialize sync change value: {}", e))?;
    tracker::record_change(conn, entity_type, entity_id, field_name, &json)
}

pub fn record_area_upsert(conn: &rusqlite::Connection, area: &Area) -> Result<(), String> {
    record_serialized_change(conn, "area", &area.id, "_upsert", area)
}

pub fn record_list_upsert(conn: &rusqlite::Connection, list: &List) -> Result<(), String> {
    record_serialized_change(conn, "list", &list.id, "_upsert", list)
}

pub fn record_task_upsert(conn: &rusqlite::Connection, task: &Task) -> Result<(), String> {
    record_serialized_change(conn, "task", &task.id, "_upsert", task)
}

pub fn record_tag_upsert(conn: &rusqlite::Connection, tag: &Tag) -> Result<(), String> {
    let snapshot = TagSnapshot {
        id: tag.id.clone(),
        name: tag.name.clone(),
        color: tag.color.clone(),
        created_at: tag.created_at.clone(),
        deleted_at: tag.deleted_at.clone(),
    };

    record_serialized_change(conn, "tag", &tag.id, "_upsert", &snapshot)
}

pub fn record_field_change<T: Serialize>(
    conn: &rusqlite::Connection,
    entity_type: &str,
    entity_id: &str,
    field_name: &str,
    value: &T,
) -> Result<(), String> {
    record_serialized_change(conn, entity_type, entity_id, field_name, value)
}

pub fn record_deleted_at(
    conn: &rusqlite::Connection,
    entity_type: &str,
    entity_id: &str,
    deleted_at: &str,
) -> Result<(), String> {
    record_field_change(conn, entity_type, entity_id, "deleted_at", &deleted_at)
}

pub fn task_tag_entity_id(task_id: &str, tag_id: &str) -> String {
    format!("{}:{}", task_id, tag_id)
}

pub fn parse_task_tag_entity_id(entity_id: &str) -> Result<(String, String), String> {
    let (task_id, tag_id) = entity_id
        .split_once(':')
        .ok_or_else(|| format!("Invalid task_tag entity id: {}", entity_id))?;

    if task_id.is_empty() || tag_id.is_empty() {
        return Err(format!("Invalid task_tag entity id: {}", entity_id));
    }

    Ok((task_id.to_string(), tag_id.to_string()))
}

pub fn record_task_tag_presence(
    conn: &rusqlite::Connection,
    task_id: &str,
    tag_id: &str,
    present: bool,
) -> Result<(), String> {
    let entity_id = task_tag_entity_id(task_id, tag_id);
    record_field_change(conn, "task_tag", &entity_id, "present", &present)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::models::{List, Tag, Task};
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn setup_test_db() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().expect("failed to create temp dir");
        let db_path = tmp.path().to_path_buf();
        db::init_db(&db_path).expect("failed to init test db");
        (tmp, db_path)
    }

    #[test]
    fn test_record_task_upsert_stores_snapshot_json() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("failed to open connection");
        let task = Task {
            id: "task-1".to_string(),
            list_id: "list-1".to_string(),
            parent_task_id: None,
            title: "Draft spec".to_string(),
            content: Some("Ship sync".to_string()),
            priority: 2,
            status: 0,
            start_date: None,
            due_date: Some("2026-03-23T09:00:00Z".to_string()),
            due_timezone: Some("Asia/Singapore".to_string()),
            recurrence_rule: None,
            sort_order: 4,
            heading_id: None,
            completed_at: None,
            created_at: "2026-03-22T00:00:00Z".to_string(),
            updated_at: "2026-03-22T00:00:00Z".to_string(),
            deleted_at: None,
            scheduled_start: None,
            scheduled_end: None,
            estimated_minutes: None,
            subtasks: Vec::new(),
            tags: Vec::new(),
        };

        record_task_upsert(&conn, &task).expect("record task upsert");

        let snapshot: String = conn
            .query_row(
                "SELECT new_value FROM sync_meta WHERE entity_type = 'task' AND entity_id = 'task-1' AND field_name = '_upsert'",
                [],
                |row| row.get(0),
            )
            .expect("read upsert snapshot");

        let decoded: serde_json::Value =
            serde_json::from_str(&snapshot).expect("decode stored task snapshot");
        assert_eq!(decoded["title"], "Draft spec");
        assert_eq!(decoded["listId"], "list-1");
        assert_eq!(decoded["priority"], 2);
    }

    #[test]
    fn test_record_task_tag_presence_uses_composite_entity_id() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("failed to open connection");

        record_task_tag_presence(&conn, "task-1", "tag-1", true).expect("record task_tag change");

        let change: (String, String, String) = conn
            .query_row(
                "SELECT entity_id, field_name, new_value FROM sync_meta WHERE entity_type = 'task_tag'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read task_tag change");

        assert_eq!(change.0, "task-1:tag-1");
        assert_eq!(change.1, "present");
        assert_eq!(change.2, "true");
        assert_eq!(
            parse_task_tag_entity_id(&change.0).expect("parse entity id"),
            ("task-1".to_string(), "tag-1".to_string())
        );
    }

    #[test]
    fn test_record_tag_upsert_tracks_deleted_at_field_in_snapshot_shape() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("failed to open connection");
        let tag = Tag {
            id: "tag-1".to_string(),
            name: "Urgent".to_string(),
            color: Some("#ff0000".to_string()),
            created_at: "2026-03-22T00:00:00Z".to_string(),
            deleted_at: None,
        };

        record_tag_upsert(&conn, &tag).expect("record tag upsert");

        let snapshot: String = conn
            .query_row(
                "SELECT new_value FROM sync_meta WHERE entity_type = 'tag' AND entity_id = 'tag-1' AND field_name = '_upsert'",
                [],
                |row| row.get(0),
            )
            .expect("read tag snapshot");

        let decoded: serde_json::Value =
            serde_json::from_str(&snapshot).expect("decode stored tag snapshot");
        assert_eq!(decoded["name"], "Urgent");
        assert_eq!(decoded["deletedAt"], serde_json::Value::Null);
    }

    #[test]
    fn test_record_list_deleted_at_serializes_as_json_string() {
        let (_tmp, db_path) = setup_test_db();
        let conn = db::get_connection(&db_path).expect("failed to open connection");
        let list = List {
            id: "list-1".to_string(),
            name: "Inbox".to_string(),
            color: None,
            sort_order: 0,
            is_inbox: true,
            area_id: None,
            description: None,
            created_at: "2026-03-22T00:00:00Z".to_string(),
            updated_at: "2026-03-22T00:00:00Z".to_string(),
            deleted_at: None,
        };

        record_list_upsert(&conn, &list).expect("record list upsert");
        record_deleted_at(&conn, "list", "list-1", "2026-03-23T00:00:00Z")
            .expect("record deleted_at");

        let raw_value: String = conn
            .query_row(
                "SELECT new_value FROM sync_meta WHERE entity_type = 'list' AND entity_id = 'list-1' AND field_name = 'deleted_at'",
                [],
                |row| row.get(0),
            )
            .expect("read deleted_at change");

        assert_eq!(raw_value, "\"2026-03-23T00:00:00Z\"");
    }
}
