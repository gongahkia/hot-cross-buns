use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::task::JoinHandle;

/// Background sync worker that periodically pushes/pulls changes.
pub struct SyncWorker {
    /// Interval between sync attempts in seconds.
    interval_secs: u64,
    /// Current backoff duration in seconds (used on failure).
    current_backoff_secs: u64,
    /// Shared flag that controls whether the worker loop keeps running.
    running: Arc<AtomicBool>,
    /// Handle to the spawned background task (if any).
    task_handle: Option<JoinHandle<()>>,
}

const DEFAULT_INTERVAL_SECS: u64 = 60;
const MIN_BACKOFF_SECS: u64 = 2;
const MAX_BACKOFF_SECS: u64 = 300;

impl SyncWorker {
    pub fn new() -> Self {
        Self {
            interval_secs: DEFAULT_INTERVAL_SECS,
            current_backoff_secs: MIN_BACKOFF_SECS,
            running: Arc::new(AtomicBool::new(false)),
            task_handle: None,
        }
    }

    pub fn with_interval(mut self, secs: u64) -> Self {
        self.interval_secs = secs;
        self
    }

    /// Start the background sync loop.
    ///
    /// Spawns a `tokio::task` that loops on an interval, calling the sync
    /// logic. On failure it applies exponential backoff; on success it resets
    /// the backoff and waits for the configured interval.
    ///
    /// The `db_path` is the application data directory that contains the
    /// SQLite database. It is moved into the spawned task.
    pub fn start(&mut self, db_path: PathBuf) {
        if self.running.load(Ordering::SeqCst) {
            eprintln!("SyncWorker is already running");
            return;
        }

        self.running.store(true, Ordering::SeqCst);

        let interval = Duration::from_secs(self.interval_secs);
        let running = Arc::clone(&self.running);

        println!("SyncWorker started with interval {:?}", interval);

        let handle = tokio::spawn(async move {
            let mut backoff = MIN_BACKOFF_SECS;

            while running.load(Ordering::SeqCst) {
                match do_sync(&db_path).await {
                    Ok(()) => {
                        backoff = MIN_BACKOFF_SECS;
                        tokio::time::sleep(interval).await;
                    }
                    Err(e) => {
                        eprintln!("Sync failed: {e}");
                        tokio::time::sleep(Duration::from_secs(backoff)).await;
                        backoff = (backoff * 2).min(MAX_BACKOFF_SECS);
                    }
                }
            }

            println!("SyncWorker loop exited");
        });

        self.task_handle = Some(handle);
    }

    /// Stop the background sync loop.
    pub fn stop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        self.current_backoff_secs = MIN_BACKOFF_SECS;

        if let Some(handle) = self.task_handle.take() {
            handle.abort();
        }

        println!("SyncWorker stopped");
    }

    /// Calculate the next backoff duration using exponential backoff.
    pub fn next_backoff(&mut self) -> Duration {
        let backoff = self.current_backoff_secs;
        self.current_backoff_secs = (self.current_backoff_secs * 2).min(MAX_BACKOFF_SECS);
        Duration::from_secs(backoff)
    }

    /// Reset backoff to the minimum value (called on successful sync).
    pub fn reset_backoff(&mut self) {
        self.current_backoff_secs = MIN_BACKOFF_SECS;
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
}

/// Perform a single push-then-pull sync cycle.
///
/// Opens the database, gathers pending changes via the change tracker, pushes
/// them to the remote server, then pulls any remote changes and applies them.
async fn do_sync(db_path: &PathBuf) -> Result<(), String> {
    use crate::sync::client::SyncClient;
    use crate::sync::settings;
    use crate::sync::tracker;

    let db_file = db_path.join("tickclone.db");

    // Open a connection for reading pending changes and applying remote changes.
    let conn = rusqlite::Connection::open(&db_file)
        .map_err(|e| format!("Failed to open database for sync: {e}"))?;
    let sync_settings = settings::get_or_create_sync_settings(&conn)?;

    // Gather pending local changes (using epoch as the "since" marker for now).
    let pending = tracker::get_pending_changes(&conn, "1970-01-01T00:00:00Z");
    let transport_pending = pending
        .iter()
        .map(|change| {
            let new_value = match serde_json::from_str::<serde_json::Value>(&change.new_value) {
                Ok(parsed) => parsed,
                Err(_) => serde_json::Value::String(change.new_value.clone()),
            };

            crate::sync::client::SyncChangePayload {
                entity_type: change.entity_type.clone(),
                entity_id: change.entity_id.clone(),
                field_name: change.field_name.clone(),
                new_value,
                timestamp: change.updated_at.clone(),
            }
        })
        .collect::<Vec<_>>();

    // Build a sync client.  In a real deployment the base URL and auth token
    // would come from user settings / environment.
    let client = SyncClient {
        base_url: std::env::var("TICKCLONE_SYNC_URL")
            .unwrap_or_else(|_| sync_settings.server_url.clone()),
        auth_token: std::env::var("TICKCLONE_SYNC_TOKEN")
            .ok()
            .or_else(|| (!sync_settings.auth_token.is_empty()).then(|| sync_settings.auth_token.clone())),
        device_id: sync_settings.device_id.clone(),
    };

    // Push local changes.
    if !transport_pending.is_empty() {
        let push_result = client
            .push_changes(&uuid::Uuid::now_v7().to_string(), transport_pending)
            .await?;
        println!(
            "Push complete: {} accepted, {} conflicts",
            push_result.accepted,
            push_result.conflicts
        );
    }

    // Pull remote changes.
    let pull_result = client.pull_changes("1970-01-01T00:00:00Z").await?;

    if !pull_result.changes.is_empty() {
        for change in &pull_result.changes {
            let local_change = tracker::TrackedChange {
                entity_type: change.entity_type.clone(),
                entity_id: change.entity_id.clone(),
                field_name: change.field_name.clone(),
                new_value: match &change.new_value {
                    serde_json::Value::Null => String::new(),
                    serde_json::Value::Bool(flag) => {
                        if *flag {
                            "1".to_string()
                        } else {
                            "0".to_string()
                        }
                    }
                    serde_json::Value::Number(number) => number.to_string(),
                    serde_json::Value::String(text) => text.clone(),
                    serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
                        change.new_value.to_string()
                    }
                },
                updated_at: change.timestamp.clone(),
                device_id: "remote".to_string(),
            };

            if let Err(e) = tracker::apply_remote_change(&conn, &local_change) {
                eprintln!("Failed to apply remote change: {e}");
            }
        }
        println!("Applied {} remote changes", pull_result.changes.len());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exponential_backoff() {
        let mut worker = SyncWorker::new();
        assert_eq!(worker.next_backoff(), Duration::from_secs(2));
        assert_eq!(worker.next_backoff(), Duration::from_secs(4));
        assert_eq!(worker.next_backoff(), Duration::from_secs(8));
        assert_eq!(worker.next_backoff(), Duration::from_secs(16));
        assert_eq!(worker.next_backoff(), Duration::from_secs(32));
        assert_eq!(worker.next_backoff(), Duration::from_secs(64));
        assert_eq!(worker.next_backoff(), Duration::from_secs(128));
        assert_eq!(worker.next_backoff(), Duration::from_secs(256));
        // Should cap at MAX_BACKOFF_SECS (300)
        assert_eq!(worker.next_backoff(), Duration::from_secs(300));
        assert_eq!(worker.next_backoff(), Duration::from_secs(300));
    }

    #[test]
    fn test_reset_backoff() {
        let mut worker = SyncWorker::new();
        worker.next_backoff();
        worker.next_backoff();
        worker.reset_backoff();
        assert_eq!(worker.next_backoff(), Duration::from_secs(2));
    }

    #[test]
    fn test_custom_interval() {
        let worker = SyncWorker::new().with_interval(120);
        assert_eq!(worker.interval_secs, 120);
    }

    #[test]
    fn test_running_flag() {
        let worker = SyncWorker::new();
        assert!(!worker.is_running());
    }
}
