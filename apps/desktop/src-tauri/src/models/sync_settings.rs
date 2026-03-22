use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSettings {
    pub server_url: String,
    pub auth_token: String,
    pub device_id: String,
    pub auto_sync_enabled: bool,
    pub last_synced_at: Option<String>,
}
