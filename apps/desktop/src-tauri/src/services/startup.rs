use std::time::Instant;

/// Log the elapsed time since `start` with a descriptive label.
///
/// Useful for profiling startup phases (db init, window creation, etc.).
pub fn log_startup_timing(label: &str, start: Instant) {
    let elapsed = start.elapsed();
    log::info!("[startup] {} completed in {:.2?}", label, elapsed);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn test_log_startup_timing_does_not_panic() {
        let start = Instant::now();
        // Should not panic even without a logger initialised.
        log_startup_timing("test-phase", start);
    }
}
