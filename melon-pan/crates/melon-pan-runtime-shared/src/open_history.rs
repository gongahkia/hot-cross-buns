//! Most-recently-opened Drive URLs / document ids.
//!
//! Persisted as plain text, one entry per line, at
//! `<config>/open-history`. New entries float to the top and the list is
//! capped at MAX_ENTRIES so the file stays small and bounded.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const MAX_ENTRIES: usize = 10;
const FILE_NAME: &str = "open-history";

pub fn history_path(config_root: &Path) -> PathBuf {
    config_root.join(FILE_NAME)
}

pub fn load_history(config_root: &Path) -> Vec<String> {
    match fs::read_to_string(history_path(config_root)) {
        Ok(raw) => raw
            .lines()
            .filter(|line| !line.trim().is_empty())
            .take(MAX_ENTRIES)
            .map(str::to_string)
            .collect(),
        Err(_) => Vec::new(),
    }
}

pub fn record_open(config_root: &Path, entry: impl Into<String>) -> io::Result<()> {
    let entry = entry.into();
    let trimmed = entry.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let mut history = load_history(config_root);
    history.retain(|existing| existing != trimmed);
    history.insert(0, trimmed.to_string());
    history.truncate(MAX_ENTRIES);
    let path = history_path(config_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, history.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "melon-pan-open-history-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn load_missing_history_returns_empty() {
        let root = temp_root("missing");
        assert_eq!(load_history(&root), Vec::<String>::new());
    }

    #[test]
    fn record_open_dedupes_and_caps_entries() {
        let root = temp_root("dedupe");
        for n in 0..12 {
            record_open(&root, format!("doc-{n}")).unwrap();
        }
        record_open(&root, "doc-3").unwrap();

        let history = load_history(&root);
        assert_eq!(history.len(), MAX_ENTRIES);
        assert_eq!(history.first().map(String::as_str), Some("doc-3"));
        assert_eq!(history.iter().filter(|entry| *entry == "doc-3").count(), 1);

        std::fs::remove_dir_all(root).unwrap();
    }
}
