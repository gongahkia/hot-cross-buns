use crate::encoding::json_escape;
use crate::storage::LocalCacheStore;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingMutation {
    pub id: String,
    pub document_id: String,
    pub originating_revision_id: String,
    pub created_at: String,
    pub batch_update_json: String,
    pub attempts: u32,
}

impl PendingMutation {
    pub fn new(
        id: impl Into<String>,
        document_id: impl Into<String>,
        originating_revision_id: impl Into<String>,
        created_at: impl Into<String>,
        batch_update_json: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            document_id: document_id.into(),
            originating_revision_id: originating_revision_id.into(),
            created_at: created_at.into(),
            batch_update_json: batch_update_json.into(),
            attempts: 0,
        }
    }

    pub fn to_json(&self) -> String {
        format!(
            concat!(
                "{{\n",
                "  \"id\": \"{}\",\n",
                "  \"documentId\": \"{}\",\n",
                "  \"originatingRevisionId\": \"{}\",\n",
                "  \"createdAt\": \"{}\",\n",
                "  \"attempts\": {},\n",
                "  \"batchUpdate\": {}\n",
                "}}\n"
            ),
            json_escape(&self.id),
            json_escape(&self.document_id),
            json_escape(&self.originating_revision_id),
            json_escape(&self.created_at),
            self.attempts,
            self.batch_update_json,
        )
    }
}

pub fn enqueue_pending_mutation(
    store: &LocalCacheStore,
    mutation: &PendingMutation,
) -> io::Result<PathBuf> {
    let paths = store.paths_for(&mutation.document_id);
    fs::create_dir_all(&paths.pending_dir)?;
    let pending_path = paths
        .pending_dir
        .join(format!("{}.json", sanitize_file_stem(&mutation.id)));
    atomic_write(&pending_path, mutation.to_json().as_bytes())?;
    Ok(pending_path)
}

pub fn list_pending_mutation_files(
    store: &LocalCacheStore,
    document_id: &str,
) -> io::Result<Vec<PathBuf>> {
    let paths = store.paths_for(document_id);
    let mut files = Vec::new();
    if !paths.pending_dir.exists() {
        return Ok(files);
    }
    for entry in fs::read_dir(paths.pending_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
            files.push(path);
        }
    }
    files.sort();
    Ok(files)
}

pub fn mark_pending_mutation_failed(
    store: &LocalCacheStore,
    document_id: &str,
    pending_file: &Path,
) -> io::Result<PathBuf> {
    let paths = store.paths_for(document_id);
    let failed_dir = paths.pending_dir.join("failed");
    fs::create_dir_all(&failed_dir)?;
    let file_name = pending_file
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "pending file has no name"))?;
    let failed_path = failed_dir.join(file_name);
    fs::rename(pending_file, &failed_path)?;
    Ok(failed_path)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(tmp, path)
}

fn sanitize_file_stem(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn queues_lists_and_marks_failed_pending_mutations() {
        let root = std::env::temp_dir().join(format!(
            "melon-pan-pending-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = LocalCacheStore::new(&root);
        store.initialize().unwrap();
        let mutation = PendingMutation::new(
            "01/test",
            "doc1",
            "rev1",
            "2026-05-01T00:00:00Z",
            "{\"requests\":[]}",
        );

        let pending_path = enqueue_pending_mutation(&store, &mutation).unwrap();
        assert!(pending_path.ends_with("01_test.json"));
        let pending = list_pending_mutation_files(&store, "doc1").unwrap();
        assert_eq!(pending.len(), 1);
        let failed_path = mark_pending_mutation_failed(&store, "doc1", &pending[0]).unwrap();
        assert!(failed_path.ends_with("failed/01_test.json"));

        fs::remove_dir_all(root).unwrap();
    }
}
