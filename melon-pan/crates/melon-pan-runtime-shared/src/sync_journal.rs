//! Append-only journal of sync events (pull, push, drain, conflict).
//!
//! Stored as JSON-Lines at `<cache_root>/sync-journal.jsonl` so it grows
//! linearly and is easy to tail. The macOS app reads the tail to surface
//! recent activity across every document the user has touched.

use melon_pan_core::{parse_json, JsonError, JsonValue};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const FILE_NAME: &str = "sync-journal.jsonl";
const MAX_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncEventKind {
    Pull,
    Push,
    Drain,
    Conflict,
    Error,
    Import,
    /// Audit-triangle drift detected by the 60s background sweep. Logged
    /// once per clean→drift transition so the journal stays signal-rich;
    /// repeat ticks of a still-drifting doc do not re-emit.
    Drift,
}

impl SyncEventKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            SyncEventKind::Pull => "pull",
            SyncEventKind::Push => "push",
            SyncEventKind::Drain => "drain",
            SyncEventKind::Conflict => "conflict",
            SyncEventKind::Error => "error",
            SyncEventKind::Import => "import",
            SyncEventKind::Drift => "drift",
        }
    }

    pub fn parse(value: &str) -> SyncEventKind {
        match value {
            "pull" => SyncEventKind::Pull,
            "push" => SyncEventKind::Push,
            "drain" => SyncEventKind::Drain,
            "conflict" => SyncEventKind::Conflict,
            "import" => SyncEventKind::Import,
            "drift" => SyncEventKind::Drift,
            _ => SyncEventKind::Error,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncEvent {
    pub timestamp_unix: u64,
    pub kind: SyncEventKind,
    pub document_id: String,
    pub revision: String,
    pub message: String,
}

impl SyncEvent {
    pub fn new(
        kind: SyncEventKind,
        document_id: impl Into<String>,
        revision: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            timestamp_unix: now_unix(),
            kind,
            document_id: document_id.into(),
            revision: revision.into(),
            message: message.into(),
        }
    }

    pub fn to_json_line(&self) -> String {
        format!(
            "{{\"ts\":{},\"kind\":\"{}\",\"document_id\":\"{}\",\"revision\":\"{}\",\"message\":\"{}\"}}\n",
            self.timestamp_unix,
            self.kind.as_str(),
            json_escape(&self.document_id),
            json_escape(&self.revision),
            json_escape(&self.message),
        )
    }

    pub fn from_json_line(raw: &str) -> Result<Self, JsonError> {
        let root = parse_json(raw)?;
        let timestamp_unix = root
            .get("ts")
            .and_then(|value| match value {
                JsonValue::Number(text) => text.parse::<u64>().ok(),
                _ => None,
            })
            .unwrap_or(0);
        let kind = root
            .get("kind")
            .and_then(JsonValue::as_str)
            .map(SyncEventKind::parse)
            .unwrap_or(SyncEventKind::Error);
        let document_id = root
            .get("document_id")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        let revision = root
            .get("revision")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        let message = root
            .get("message")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .to_string();
        Ok(SyncEvent {
            timestamp_unix,
            kind,
            document_id,
            revision,
            message,
        })
    }
}

pub fn append_event(cache_root: &Path, event: &SyncEvent) -> io::Result<()> {
    fs::create_dir_all(cache_root)?;
    let path = cache_root.join(FILE_NAME);
    rotate_if_needed(&path)?;
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(event.to_json_line().as_bytes())?;
    Ok(())
}

pub fn read_recent_events(cache_root: &Path, limit: usize) -> io::Result<Vec<SyncEvent>> {
    let path = cache_root.join(FILE_NAME);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path)?;
    let mut events: Vec<SyncEvent> = raw
        .lines()
        .rev()
        .filter_map(|line| {
            if line.trim().is_empty() {
                None
            } else {
                SyncEvent::from_json_line(line).ok()
            }
        })
        .take(limit)
        .collect();
    events.sort_by(|a, b| b.timestamp_unix.cmp(&a.timestamp_unix));
    Ok(events)
}

pub fn clear_events(cache_root: &Path, retain_days_secs: u64) -> io::Result<usize> {
    let path = cache_root.join(FILE_NAME);
    if !path.exists() {
        return Ok(0);
    }
    let raw = fs::read_to_string(&path)?;
    let lines: Vec<&str> = raw.lines().collect();
    if retain_days_secs == 0 {
        fs::write(&path, "")?;
        return Ok(lines.iter().filter(|line| !line.trim().is_empty()).count());
    }

    let cutoff = now_unix().saturating_sub(retain_days_secs);
    let mut kept = Vec::new();
    for line in &lines {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(event) = SyncEvent::from_json_line(line) {
            if event.timestamp_unix >= cutoff {
                kept.push(*line);
            }
        }
    }
    let removed = lines
        .iter()
        .filter(|line| !line.trim().is_empty())
        .count()
        .saturating_sub(kept.len());
    let mut out = kept.join("\n");
    if !out.is_empty() {
        out.push('\n');
    }
    fs::write(&path, out)?;
    Ok(removed)
}

pub fn journal_path(cache_root: &Path) -> PathBuf {
    cache_root.join(FILE_NAME)
}

/// Rotates the journal to `.jsonl.1` once it exceeds MAX_BYTES so disk usage
/// stays bounded. The previous rotation is overwritten.
fn rotate_if_needed(path: &Path) -> io::Result<()> {
    let size = match fs::metadata(path) {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if size < MAX_BYTES {
        return Ok(());
    }
    let rotated = path.with_extension("jsonl.1");
    let _ = fs::remove_file(&rotated);
    fs::rename(path, rotated)
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn json_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ch if ch.is_control() => out.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => out.push(ch),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "melon-pan-sync-journal-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn round_trips_event_through_json_line() {
        let event = SyncEvent {
            timestamp_unix: 1_700_000_000,
            kind: SyncEventKind::Push,
            document_id: "doc/1".to_string(),
            revision: "rev:42".to_string(),
            message: "queued: revision conflict".to_string(),
        };
        let line = event.to_json_line();
        let parsed = SyncEvent::from_json_line(line.trim()).unwrap();
        assert_eq!(parsed, event);
    }

    #[test]
    fn read_recent_events_orders_newest_first() {
        let dir = temp_root("order");
        fs::create_dir_all(&dir).unwrap();
        for i in 1..=3 {
            let mut event = SyncEvent::new(
                SyncEventKind::Pull,
                format!("doc-{i}"),
                format!("rev-{i}"),
                format!("pulled doc-{i}"),
            );
            event.timestamp_unix = 1_000 + i as u64;
            append_event(&dir, &event).unwrap();
        }
        let events = read_recent_events(&dir, 5).unwrap();
        assert_eq!(events.len(), 3);
        assert!(events[0].timestamp_unix > events[2].timestamp_unix);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn clear_events_truncates_when_retention_is_zero() {
        let root = temp_root("clear-all");
        append_event(
            &root,
            &SyncEvent::new(SyncEventKind::Push, "doc", "rev", "one"),
        )
        .unwrap();
        append_event(
            &root,
            &SyncEvent::new(SyncEventKind::Pull, "doc", "rev", "two"),
        )
        .unwrap();

        assert_eq!(clear_events(&root, 0).unwrap(), 2);
        assert!(read_recent_events(&root, 10).unwrap().is_empty());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn read_recent_events_ignores_rotated_journal() {
        let root = temp_root("rotation");
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("sync-journal.jsonl.1"),
            SyncEvent {
                timestamp_unix: 1,
                kind: SyncEventKind::Push,
                document_id: "old".to_string(),
                revision: "rev".to_string(),
                message: "rotated".to_string(),
            }
            .to_json_line(),
        )
        .unwrap();
        append_event(
            &root,
            &SyncEvent::new(SyncEventKind::Pull, "new", "rev", "active"),
        )
        .unwrap();

        let events = read_recent_events(&root, 10).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].document_id, "new");

        fs::remove_dir_all(root).unwrap();
    }
}
