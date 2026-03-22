use serde::{Deserialize, Serialize};

/// A single field-level change record used for sync.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeRecord {
    pub entity_type: String,
    pub entity_id: String,
    pub field_name: String,
    pub new_value: String,
    pub updated_at: String,
    pub device_id: String,
}

/// Result returned from a push operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushResult {
    pub accepted: u32,
    pub rejected: u32,
}

/// Result returned from a pull operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullResult {
    pub changes: Vec<ChangeRecord>,
}

/// HTTP client for communicating with the sync server.
pub struct SyncClient {
    pub base_url: String,
    pub auth_token: Option<String>,
    pub device_id: String,
}

impl SyncClient {
    /// Push local changes to the remote server.
    pub async fn push_changes(&self, changes: Vec<ChangeRecord>) -> Result<PushResult, String> {
        let url = format!("{}/api/v1/sync/push", self.base_url);

        let client = reqwest::Client::new();
        let mut req = client.post(&url).json(&changes);

        if let Some(ref token) = self.auth_token {
            req = req.header("Authorization", format!("Bearer {}", token));
        }

        let resp = req
            .send()
            .await
            .map_err(|e| format!("Push request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Push failed with status: {}", resp.status()));
        }

        resp.json::<PushResult>()
            .await
            .map_err(|e| format!("Failed to parse push response: {}", e))
    }

    /// Pull remote changes that occurred after `last_sync_at`.
    pub async fn pull_changes(&self, last_sync_at: &str) -> Result<PullResult, String> {
        let url = format!("{}/api/v1/sync/pull", self.base_url);

        #[derive(Serialize)]
        struct PullRequest<'a> {
            last_sync_at: &'a str,
            device_id: &'a str,
        }

        let body = PullRequest {
            last_sync_at,
            device_id: &self.device_id,
        };

        let client = reqwest::Client::new();
        let mut req = client.post(&url).json(&body);

        if let Some(ref token) = self.auth_token {
            req = req.header("Authorization", format!("Bearer {}", token));
        }

        let resp = req
            .send()
            .await
            .map_err(|e| format!("Pull request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Pull failed with status: {}", resp.status()));
        }

        resp.json::<PullResult>()
            .await
            .map_err(|e| format!("Failed to parse pull response: {}", e))
    }
}
