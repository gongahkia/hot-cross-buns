use std::time::Duration;

/// Background sync worker that periodically pushes/pulls changes.
pub struct SyncWorker {
    /// Interval between sync attempts in seconds.
    interval_secs: u64,
    /// Current backoff duration in seconds (used on failure).
    current_backoff_secs: u64,
    /// Whether the worker loop is running.
    running: bool,
}

const DEFAULT_INTERVAL_SECS: u64 = 60;
const MIN_BACKOFF_SECS: u64 = 2;
const MAX_BACKOFF_SECS: u64 = 300;

impl SyncWorker {
    pub fn new() -> Self {
        Self {
            interval_secs: DEFAULT_INTERVAL_SECS,
            current_backoff_secs: MIN_BACKOFF_SECS,
            running: false,
        }
    }

    pub fn with_interval(mut self, secs: u64) -> Self {
        self.interval_secs = secs;
        self
    }

    /// Start the background sync loop.
    ///
    /// In a full implementation this would spawn a `tokio::task` that
    /// loops on an interval, calling `SyncClient::push_changes` and
    /// `SyncClient::pull_changes`. On failure it applies exponential
    /// backoff; on success it resets the backoff and waits for the
    /// configured interval.
    pub fn start(&mut self) {
        if self.running {
            log::warn!("SyncWorker is already running");
            return;
        }

        self.running = true;
        let interval = Duration::from_secs(self.interval_secs);

        log::info!(
            "SyncWorker started with interval {:?} (stub – no actual loop spawned)",
            interval
        );

        // TODO: spawn tokio task
        // tokio::spawn(async move {
        //     loop {
        //         match do_sync().await {
        //             Ok(_) => {
        //                 backoff = MIN_BACKOFF_SECS;
        //                 tokio::time::sleep(interval).await;
        //             }
        //             Err(e) => {
        //                 log::error!("Sync failed: {e}");
        //                 tokio::time::sleep(Duration::from_secs(backoff)).await;
        //                 backoff = (backoff * 2).min(MAX_BACKOFF_SECS);
        //             }
        //         }
        //     }
        // });
    }

    /// Stop the background sync loop.
    pub fn stop(&mut self) {
        self.running = false;
        self.current_backoff_secs = MIN_BACKOFF_SECS;
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
        self.running
    }
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
}
