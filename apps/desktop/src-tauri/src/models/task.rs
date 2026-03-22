use serde::{Deserialize, Serialize};

use super::tag::Tag;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub list_id: String,
    pub parent_task_id: Option<String>,
    pub title: String,
    pub content: Option<String>,
    pub priority: i32,
    pub status: i32,
    pub due_date: Option<String>,
    pub due_timezone: Option<String>,
    pub recurrence_rule: Option<String>,
    pub sort_order: i32,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub subtasks: Vec<Task>,
    pub tags: Vec<Tag>,
}
