use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedFilter {
    pub id: String,
    pub name: String,
    pub config: String, // JSON string: {priorities, tagIds, dueBefore, dueAfter}
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}
