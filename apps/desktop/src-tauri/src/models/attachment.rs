use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub task_id: String,
    pub filename: String,
    pub file_path: String,
    pub mime_type: Option<String>,
    pub size: i64,
    pub created_at: String,
}
