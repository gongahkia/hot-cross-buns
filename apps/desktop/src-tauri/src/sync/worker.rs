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
            log::warn!("SyncWorker is already running");
            return;
        }

        self.running.store(true, Ordering::SeqCst);

        let interval = Duration::from_secs(self.interval_secs);
        let running = Arc::clone(&self.running);

        log::info!("SyncWorker started with interval {:?}", interval);

        let handle = tokio::spawn(async move {
            let mut backoff = MIN_BACKOFF_SECS;

            while running.load(Ordering::SeqCst) {
                match do_sync(&db_path).await {
                    Ok(()) => {
                        backoff = MIN_BACKOFF_SECS;
                        tokio::time::sleep(interval).await;
                    }
                    Err(e) => {
                        log::error!("Sync failed: {e}");
                        tokio::time::sleep(Duration::from_secs(backoff)).await;
                        backoff = (backoff * 2).min(MAX_BACKOFF_SECS);
                    }
                }
            }

            log::info!("SyncWorker loop exited");
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

        log::info!("SyncWorker stopped");
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
    use crate::sync::tracker;

    let db_file = db_path.join("tickclone.db");

    // Open a connection for reading pending changes and applying remote changes.
    let conn = rusqlite::Connection::open(&db_file)
        .map_err(|e| format!("Failed to open database for sync: {e}"))?;

    // Gather pending local changes (using epoch as the "since" marker for now).
    let pending = tracker::get_pending_changes(&conn, "1970-01-01T00:00:00Z");

    // Build a sync client.  In a real deployment the base URL and auth token
    // would come from user settings / environment.
    let client = SyncClient {
        base_url: std::env::var("TICKCLONE_SYNC_URL")
            .unwrap_or_else(|_| "http://localhost:8080".to_string()),
        auth_token: std::env::var("TICKCLONE_SYNC_TOKEN").ok(),
        device_id: "desktop-device".to_string(),
    };

    // Push local changes.
    if !pending.is_empty() {
        let push_result = client.push_changes(pending).await?;
        log::info!(
            "Push complete: {} accepted, {} rejected",
            push_result.accepted,
            push_result.rejected
        );
    }

    // Pull remote changes.
    let pull_result = client.pull_changes("1970-01-01T00:00:00Z").await?;

    if !pull_result.changes.is_empty() {
        for change in &pull_result.changes {
            if let Err(e) = tracker::apply_remote_change(&conn, change) {
                log::error!("Failed to apply remote change: {e}");
            }
        }
        log::info!("Applied {} remote changes", pull_result.changes.len());
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
