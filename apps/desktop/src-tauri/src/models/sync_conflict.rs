use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflict {
    pub entity_type: String,
    pub entity_id: String,
    pub field_name: String,
    pub local_value: String,
    pub remote_value: String,
    pub local_updated_at: String,
    pub remote_updated_at: String,
    pub local_device_id: Option<String>,
    pub remote_device_id: Option<String>,
    pub resolution_status: String,
    pub created_at: String,
    pub updated_at: String,
}
