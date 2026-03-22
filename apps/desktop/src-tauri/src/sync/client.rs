use serde::{Deserialize, Serialize};

/// A server-compatible sync change record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncChangePayload {
    pub entity_type: String,
    pub entity_id: String,
    pub field_name: String,
    pub new_value: serde_json::Value,
    pub timestamp: String,
}

/// Request body for POST /api/v1/sync/push.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPushRequest {
    pub device_id: String,
    pub batch_id: String,
    pub changes: Vec<SyncChangePayload>,
}

/// Response body for POST /api/v1/sync/push.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    pub batch_id: String,
    pub accepted: u32,
    pub conflicts: u32,
}

/// Request body for POST /api/v1/sync/pull.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPullRequest {
    pub device_id: String,
    pub last_sync_at: String,
}

/// Response body for POST /api/v1/sync/pull.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullResult {
    pub changes: Vec<SyncChangePayload>,
    pub server_time: String,
}

/// HTTP client for communicating with the sync server.
pub struct SyncClient {
    pub base_url: String,
    pub auth_token: Option<String>,
    pub device_id: String,
}

impl SyncClient {
    /// Push local changes to the remote server.
    pub async fn push_changes(
        &self,
        batch_id: &str,
        changes: Vec<SyncChangePayload>,
    ) -> Result<PushResult, String> {
        let url = format!("{}/api/v1/sync/push", self.base_url);
        let body = SyncPushRequest {
            device_id: self.device_id.clone(),
            batch_id: batch_id.to_string(),
            changes,
        };

        let client = reqwest::Client::new();
        let mut req = client.post(&url).json(&body);

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

        let body = SyncPullRequest {
            last_sync_at: last_sync_at.to_string(),
            device_id: self.device_id.clone(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_push_request_serializes_to_server_shape() {
        let request = SyncPushRequest {
            device_id: "device-abc-123".to_string(),
            batch_id: "019513a4-7e2b-7000-8000-0000000000b1".to_string(),
            changes: vec![SyncChangePayload {
                entity_type: "task".to_string(),
                entity_id: "task-1".to_string(),
                field_name: "title".to_string(),
                new_value: json!("Synced title"),
                timestamp: "2026-03-22T14:35:00Z".to_string(),
            }],
        };

        let value = serde_json::to_value(&request).expect("serialize sync push request");

        assert_eq!(
            value,
            json!({
                "deviceId": "device-abc-123",
                "batchId": "019513a4-7e2b-7000-8000-0000000000b1",
                "changes": [
                    {
                        "entityType": "task",
                        "entityId": "task-1",
                        "fieldName": "title",
                        "newValue": "Synced title",
                        "timestamp": "2026-03-22T14:35:00Z"
                    }
                ]
            })
        );
    }

    #[test]
    fn test_pull_response_deserializes_from_server_shape() {
        let payload = json!({
            "changes": [
                {
                    "entityType": "task",
                    "entityId": "task-1",
                    "fieldName": "title",
                    "newValue": "Synced title",
                    "timestamp": "2026-03-22T14:35:00Z"
                }
            ],
            "serverTime": "2026-03-22T14:40:00Z"
        });

        let response: PullResult =
            serde_json::from_value(payload).expect("deserialize sync pull response");

        assert_eq!(response.server_time, "2026-03-22T14:40:00Z");
        assert_eq!(response.changes.len(), 1);
        assert_eq!(response.changes[0].entity_type, "task");
        assert_eq!(response.changes[0].entity_id, "task-1");
        assert_eq!(response.changes[0].field_name, "title");
        assert_eq!(response.changes[0].new_value, json!("Synced title"));
        assert_eq!(response.changes[0].timestamp, "2026-03-22T14:35:00Z");
    }
}
