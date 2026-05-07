use crate::drive::{drive_tree_cache_json, DriveItem};
use crate::fidelity::{FidelityReport, FidelityWarning, WarningKind};
use crate::json::{parse_json, JsonError, JsonValue};
use crate::rich_parse::{body_end_index_from_raw, parse_rich_document, RichParseError};
use crate::sha256::stable_content_hash;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Cap on archived current.md copies kept under `trash/` per document.
///
/// Each successful write to current.md first archives the previous content here
/// so a buggy pull or push never silently destroys local edits. The cap keeps
/// disk usage bounded; older entries fall off oldest-first.
pub const TRASH_MAX_ENTRIES: usize = 50;
pub const PRE_PUSH_MAX_ENTRIES: usize = 50;

#[derive(Debug, Clone)]
pub struct LocalCacheStore {
    root: PathBuf,
}

impl LocalCacheStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn paths_for(&self, document_id: &str) -> CachePaths {
        CachePaths::new(self.root.clone(), document_id)
    }

    pub fn drive_tree_path(&self) -> PathBuf {
        self.root.join("drive-tree.json")
    }

    pub fn initialize(&self) -> io::Result<()> {
        fs::create_dir_all(self.root.join("docs"))?;
        fs::create_dir_all(self.root.join("snapshots"))?;
        let drive_tree = self.drive_tree_path();
        if !drive_tree.exists() {
            atomic_write(drive_tree, b"{\"files\":[]}\n")?;
        }
        Ok(())
    }

    pub fn write_drive_tree(&self, items: &[DriveItem]) -> io::Result<()> {
        atomic_write(
            self.drive_tree_path(),
            drive_tree_cache_json(items).as_bytes(),
        )
    }

    pub fn write_current_doc(
        &self,
        document_id: &str,
        markdown: &str,
        docs_json: &str,
        metadata: &MetadataRecord,
    ) -> io::Result<()> {
        let paths = self.paths_for(document_id);
        fs::create_dir_all(&paths.doc_dir)?;
        fs::create_dir_all(&paths.pending_dir)?;
        fs::create_dir_all(&paths.trash_dir)?;
        archive_existing_to_trash(&paths.current_md, &paths.trash_dir)?;
        atomic_write(paths.current_md, markdown.as_bytes())?;
        atomic_write(paths.current_docs_json, docs_json.as_bytes())?;
        atomic_write(paths.meta_json, metadata.to_json().as_bytes())?;
        prune_directory(&paths.trash_dir, TRASH_MAX_ENTRIES)?;
        Ok(())
    }

    pub fn write_current_rich_doc(
        &self,
        document_id: &str,
        docs_json: &str,
        metadata: &MetadataRecord,
    ) -> io::Result<()> {
        let paths = self.paths_for(document_id);
        fs::create_dir_all(&paths.doc_dir)?;
        fs::create_dir_all(&paths.pending_dir)?;
        fs::create_dir_all(&paths.trash_dir)?;
        if archive_existing_to_trash(&paths.current_md, &paths.trash_dir)?.is_some() {
            fs::remove_file(&paths.current_md)?;
        }
        atomic_write(paths.current_docs_json, docs_json.as_bytes())?;
        atomic_write(paths.meta_json, metadata.to_json().as_bytes())?;
        prune_directory(&paths.trash_dir, TRASH_MAX_ENTRIES)?;
        Ok(())
    }

    /// Overwrites only `current.md` for `document_id`, preserving the
    /// existing `current.docs.json` and `meta.json`. The previous
    /// `current.md` is archived to `trash/` first so the operation is
    /// reversible. Used by editor-save flows that produce fresh markdown
    /// from the user's buffer without changing the cached server state.
    ///
    /// Skips the docs.json / meta.json round-trip — push_document
    /// re-reads both on its own from the cached state, so leaving them
    /// untouched is correct. The trash + atomic-write invariants match
    /// `write_current_doc`.
    pub fn overwrite_current_markdown(&self, document_id: &str, markdown: &str) -> io::Result<()> {
        let paths = self.paths_for(document_id);
        fs::create_dir_all(&paths.doc_dir)?;
        fs::create_dir_all(&paths.trash_dir)?;
        archive_existing_to_trash(&paths.current_md, &paths.trash_dir)?;
        atomic_write(paths.current_md, markdown.as_bytes())?;
        prune_directory(&paths.trash_dir, TRASH_MAX_ENTRIES)?;
        Ok(())
    }

    /// Lists archived prior versions of current.md, newest first.
    pub fn list_trash(&self, document_id: &str) -> io::Result<Vec<PathBuf>> {
        list_dir_entries(&self.paths_for(document_id).trash_dir)
    }

    /// Lists pre-push snapshots, newest first.
    pub fn list_pre_push_snapshots(&self, document_id: &str) -> io::Result<Vec<PathBuf>> {
        list_dir_entries(&self.paths_for(document_id).pre_push_dir)
    }

    /// Lists revision snapshots ({rev}.md / {rev}.docs.json pairs), newest first.
    pub fn list_revision_snapshots(&self, document_id: &str) -> io::Result<Vec<PathBuf>> {
        list_dir_entries(&self.paths_for(document_id).snapshot_dir)
    }

    /// Restores a trashed or snapshot Markdown file as the new current.md.
    ///
    /// The previous current.md is archived to trash/ before the restore so the
    /// restore itself is reversible.
    pub fn restore_to_current(&self, document_id: &str, source: &Path) -> io::Result<()> {
        let paths = self.paths_for(document_id);
        fs::create_dir_all(&paths.doc_dir)?;
        fs::create_dir_all(&paths.trash_dir)?;
        let bytes = fs::read(source)?;
        archive_existing_to_trash(&paths.current_md, &paths.trash_dir)?;
        atomic_write(paths.current_md, &bytes)?;
        prune_directory(&paths.trash_dir, TRASH_MAX_ENTRIES)?;
        Ok(())
    }

    /// Snapshot the current Markdown buffer into pre-push/<ts>.md before a
    /// batchUpdate is sent. Pre-push snapshots are the no-loss recovery point
    /// when Google rejects, mangles, or partially applies an update.
    pub fn snapshot_pre_push(&self, document_id: &str) -> io::Result<Option<PathBuf>> {
        let paths = self.paths_for(document_id);
        if !paths.current_md.exists() {
            return Ok(None);
        }
        fs::create_dir_all(&paths.pre_push_dir)?;
        let stamp = current_stamp();
        let target = paths.pre_push_dir.join(format!("{stamp}.md"));
        fs::copy(&paths.current_md, &target)?;
        prune_directory(&paths.pre_push_dir, PRE_PUSH_MAX_ENTRIES)?;
        Ok(Some(target))
    }

    pub fn read_current_markdown(&self, document_id: &str) -> io::Result<String> {
        fs::read_to_string(self.paths_for(document_id).current_md)
    }

    pub fn read_current_docs_json(&self, document_id: &str) -> io::Result<String> {
        fs::read_to_string(self.paths_for(document_id).current_docs_json)
    }

    /// Lists every document id that has a `docs/<safe_id>/meta.json` entry.
    /// Reads `documentId` from each metadata record so the original (un-sanitized)
    /// id is returned, suitable for re-issuing pull / push against Google.
    pub fn list_cached_document_ids(&self) -> io::Result<Vec<String>> {
        let docs_dir = self.root.join("docs");
        if !docs_dir.exists() {
            return Ok(Vec::new());
        }
        let mut ids = Vec::new();
        for entry in fs::read_dir(docs_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let meta_path = entry.path().join("meta.json");
            if !meta_path.exists() {
                continue;
            }
            if let Ok(raw) = fs::read_to_string(&meta_path) {
                if let Ok(metadata) = MetadataRecord::from_json(&raw) {
                    ids.push(metadata.document_id);
                }
            }
        }
        ids.sort();
        Ok(ids)
    }

    /// Returns true when current.md's mtime is later than the stored
    /// last_pushed_at. Documents that have never been pushed (no last_pushed_at)
    /// are dirty by definition.
    pub fn is_document_dirty(&self, document_id: &str) -> bool {
        let paths = self.paths_for(document_id);
        let mtime = match fs::metadata(&paths.current_md).and_then(|metadata| metadata.modified()) {
            Ok(t) => t
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
            Err(_) => return false,
        };
        let pushed = self
            .read_metadata(document_id)
            .ok()
            .and_then(|metadata| metadata.last_pushed_at)
            .and_then(|stamp| stamp.parse::<u64>().ok())
            .unwrap_or(0);
        mtime > pushed
    }

    pub fn read_metadata(&self, document_id: &str) -> Result<MetadataRecord, MetadataError> {
        let raw =
            fs::read_to_string(self.paths_for(document_id).meta_json).map_err(MetadataError::Io)?;
        MetadataRecord::from_json(&raw)
    }

    pub fn write_metadata(&self, document_id: &str, metadata: &MetadataRecord) -> io::Result<()> {
        let paths = self.paths_for(document_id);
        fs::create_dir_all(&paths.doc_dir)?;
        atomic_write(paths.meta_json, metadata.to_json().as_bytes())
    }

    /// Reads the YAML frontmatter sidecar for a document, if present.
    /// Stored verbatim (no fences) at `<doc>/frontmatter.yaml`. Used by the
    /// pull path to re-prepend frontmatter onto the Markdown projection
    /// from Docs (which never round-trips YAML natively).
    pub fn read_frontmatter(&self, document_id: &str) -> Option<String> {
        let path = self.paths_for(document_id).doc_dir.join("frontmatter.yaml");
        fs::read_to_string(path).ok()
    }

    /// Writes (or clears) the frontmatter sidecar. An empty `frontmatter`
    /// string is treated as "no frontmatter" — the file is deleted so a
    /// later read returns None rather than the empty string.
    pub fn write_frontmatter(&self, document_id: &str, frontmatter: &str) -> io::Result<()> {
        let paths = self.paths_for(document_id);
        fs::create_dir_all(&paths.doc_dir)?;
        let target = paths.doc_dir.join("frontmatter.yaml");
        if frontmatter.is_empty() {
            if target.exists() {
                fs::remove_file(target)?;
            }
            return Ok(());
        }
        atomic_write(target, frontmatter.as_bytes())
    }

    /// Reads the named-ranges sidecar for a document, if present. Stored at
    /// `<doc>/named-ranges.json` as the JSON-encoded snapshot captured before
    /// the most recent push. Used post-push to surface which anchors may have
    /// drifted (anchor text no longer matches the new body).
    pub fn read_named_ranges_sidecar(&self, document_id: &str) -> Option<String> {
        let path = self
            .paths_for(document_id)
            .doc_dir
            .join("named-ranges.json");
        fs::read_to_string(path).ok()
    }

    pub fn write_named_ranges_sidecar(&self, document_id: &str, json: &str) -> io::Result<()> {
        let paths = self.paths_for(document_id);
        fs::create_dir_all(&paths.doc_dir)?;
        atomic_write(paths.doc_dir.join("named-ranges.json"), json.as_bytes())
    }

    /// Reads the Drive comments sidecar for a document, if present. Stored at
    /// `<doc>/comments.json`, separate from `current.docs.json` because Google
    /// exposes comments through Drive rather than the Docs document resource.
    pub fn read_comments_sidecar(&self, document_id: &str) -> Option<String> {
        let path = self.paths_for(document_id).doc_dir.join("comments.json");
        fs::read_to_string(path).ok()
    }

    pub fn write_comments_sidecar(&self, document_id: &str, json: &str) -> io::Result<()> {
        let paths = self.paths_for(document_id);
        fs::create_dir_all(&paths.doc_dir)?;
        atomic_write(paths.doc_dir.join("comments.json"), json.as_bytes())
    }

    /// Path to the per-vault Obsidian asset map (relative_path → drive id)
    /// produced by the image-attachment uploader. Returned even when the
    /// file does not exist so callers can write to it on first run.
    pub fn obsidian_asset_map_path(&self) -> PathBuf {
        self.root.join("obsidian-assets.json")
    }

    pub fn read_doc_settings(&self, document_id: &str) -> Option<PerDocSettings> {
        let path = self
            .paths_for(document_id)
            .doc_dir
            .join("doc-settings.json");
        let raw = fs::read_to_string(path).ok()?;
        PerDocSettings::from_json(&raw).ok()
    }

    pub fn write_doc_settings(
        &self,
        document_id: &str,
        settings: &PerDocSettings,
    ) -> io::Result<()> {
        let paths = self.paths_for(document_id);
        fs::create_dir_all(&paths.doc_dir)?;
        atomic_write(
            paths.doc_dir.join("doc-settings.json"),
            settings.to_json().as_bytes(),
        )
    }

    pub fn record_push(&self, document_id: &str, pushed_at: &str) -> Result<(), MetadataError> {
        let metadata = self.read_metadata(document_id)?;
        let updated = metadata.with_push(pushed_at);
        self.write_metadata(document_id, &updated)
            .map_err(MetadataError::Io)
    }

    /// Pulls revisionId and body end_index out of the cached current.docs.json so
    /// callers can build batchUpdate requests without a fresh GET.
    pub fn read_current_docs_state(
        &self,
        document_id: &str,
    ) -> Result<CachedDocsState, CachedDocsStateError> {
        let raw = self
            .read_current_docs_json(document_id)
            .map_err(CachedDocsStateError::Io)?;
        let parsed = parse_rich_document(&raw).map_err(CachedDocsStateError::Parse)?;
        if parsed.revision.revision_id.is_empty() {
            return Err(CachedDocsStateError::MissingRevision);
        }
        let body_end_index = body_end_index_from_raw(&raw).unwrap_or(2);
        Ok(CachedDocsState {
            document_id: parsed.document_id,
            revision_id: parsed.revision.revision_id,
            body_end_index,
            raw,
        })
    }

    /// Compaction over the snapshot dirs. Applies two cuts in sequence:
    /// 1. Drop any file whose mtime is older than `max_age_days` (when
    ///    `Some`). 0 / None means "no age cap".
    /// 2. Trim the remaining list to the newest `keep_n` (when `Some`).
    ///
    /// Walks `trash/`, `pre-push/`, and `snapshots/` for the given doc.
    /// Returns the total number of files removed across all three dirs.
    /// Failures on individual files are logged via the OS error chain
    /// and the count omits them so callers see "best-effort" semantics.
    pub fn compact_doc_snapshots(
        &self,
        document_id: &str,
        keep_n: Option<usize>,
        max_age_days: Option<u64>,
    ) -> io::Result<usize> {
        let paths = self.paths_for(document_id);
        let mut removed = 0;
        for dir in [&paths.trash_dir, &paths.pre_push_dir, &paths.snapshot_dir] {
            removed += compact_directory(dir, keep_n, max_age_days)?;
        }
        Ok(removed)
    }

    /// Walks every cached document and compacts each one. Useful for a
    /// "compact now" button in settings or a CLI subcommand.
    pub fn compact_all_snapshots(
        &self,
        keep_n: Option<usize>,
        max_age_days: Option<u64>,
    ) -> io::Result<usize> {
        let ids = self.list_cached_document_ids()?;
        let mut total = 0;
        for id in ids {
            total += self.compact_doc_snapshots(&id, keep_n, max_age_days)?;
        }
        Ok(total)
    }

    /// Sums the on-disk size in bytes of every snapshot file under
    /// `trash/`, `pre-push/`, and `snapshots/` for one doc. Drives the
    /// diagnostics-page disk-usage row.
    pub fn snapshot_disk_usage_bytes(&self, document_id: &str) -> io::Result<u64> {
        let paths = self.paths_for(document_id);
        let mut total: u64 = 0;
        for dir in [&paths.trash_dir, &paths.pre_push_dir, &paths.snapshot_dir] {
            total = total.saturating_add(directory_size_bytes(dir)?);
        }
        Ok(total)
    }

    /// Total snapshot-dir bytes across every cached document.
    pub fn total_snapshot_disk_usage_bytes(&self) -> io::Result<u64> {
        let ids = self.list_cached_document_ids()?;
        let mut total: u64 = 0;
        for id in ids {
            total = total.saturating_add(self.snapshot_disk_usage_bytes(&id)?);
        }
        Ok(total)
    }

    pub fn write_snapshot(
        &self,
        document_id: &str,
        revision_id: &str,
        markdown: &str,
        docs_json: &str,
    ) -> io::Result<()> {
        let paths = self.paths_for(document_id);
        fs::create_dir_all(&paths.snapshot_dir)?;
        let safe_revision = sanitize_path_segment(revision_id);
        atomic_write(
            paths
                .snapshot_dir
                .join(format!("{safe_revision}.docs.json")),
            docs_json.as_bytes(),
        )?;
        atomic_write(
            paths.snapshot_dir.join(format!("{safe_revision}.md")),
            markdown.as_bytes(),
        )
    }

    pub fn write_rich_snapshot(
        &self,
        document_id: &str,
        revision_id: &str,
        docs_json: &str,
    ) -> io::Result<()> {
        let paths = self.paths_for(document_id);
        fs::create_dir_all(&paths.snapshot_dir)?;
        let safe_revision = sanitize_path_segment(revision_id);
        atomic_write(
            paths
                .snapshot_dir
                .join(format!("{safe_revision}.docs.json")),
            docs_json.as_bytes(),
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachePaths {
    pub root: PathBuf,
    pub doc_dir: PathBuf,
    pub current_md: PathBuf,
    pub current_docs_json: PathBuf,
    pub meta_json: PathBuf,
    pub pending_dir: PathBuf,
    pub trash_dir: PathBuf,
    pub pre_push_dir: PathBuf,
    pub snapshot_dir: PathBuf,
    pub operation_log: PathBuf,
}

impl CachePaths {
    fn new(root: PathBuf, document_id: &str) -> Self {
        let safe_id = sanitize_path_segment(document_id);
        let doc_dir = root.join("docs").join(&safe_id);
        let snapshot_dir = root.join("snapshots").join(&safe_id);
        Self {
            root,
            current_md: doc_dir.join("current.md"),
            current_docs_json: doc_dir.join("current.docs.json"),
            meta_json: doc_dir.join("meta.json"),
            pending_dir: doc_dir.join("pending"),
            trash_dir: doc_dir.join("trash"),
            pre_push_dir: doc_dir.join("pre-push"),
            operation_log: doc_dir.join("operation-log.jsonl"),
            doc_dir,
            snapshot_dir,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetadataRecord {
    pub document_id: String,
    pub revision_id: String,
    pub drive_modified_time: String,
    pub md_hash: String,
    pub docs_json_hash: String,
    pub last_pulled_at: String,
    pub last_pushed_at: Option<String>,
    pub last_fidelity_report: FidelityReport,
    pub title: Option<String>,
    pub imported_at: Option<u64>,
    pub source_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedDocsState {
    pub document_id: String,
    pub revision_id: String,
    pub body_end_index: u32,
    pub raw: String,
}

/// Per-document settings persisted at `<doc>/doc-settings.json`. Each field is
/// optional so a partial file from an older version still parses; missing
/// fields fall back to app-wide defaults at the call site.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PerDocSettings {
    pub font_family: Option<String>,
    pub font_size_px: Option<u32>,
    pub vim_default: Option<bool>,
    pub autosave_interval_ms: Option<u32>,
    /// When `Some`, overrides the app-level color scheme for this doc.
    /// `None` means inherit. Empty string is treated as None on parse.
    pub color_scheme: Option<String>,
}

impl PerDocSettings {
    pub fn from_json(raw: &str) -> Result<Self, JsonError> {
        let root = parse_json(raw)?;
        Ok(Self {
            font_family: root
                .get("fontFamily")
                .and_then(JsonValue::as_str)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
            font_size_px: root.get("fontSizePx").and_then(|value| match value {
                JsonValue::Number(text) => text.parse::<u32>().ok(),
                _ => None,
            }),
            vim_default: root.get("vimDefault").and_then(JsonValue::as_bool),
            autosave_interval_ms: root
                .get("autosaveIntervalMs")
                .and_then(|value| match value {
                    JsonValue::Number(text) => text.parse::<u32>().ok(),
                    _ => None,
                }),
            color_scheme: root
                .get("colorScheme")
                .and_then(JsonValue::as_str)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
        })
    }

    pub fn to_json(&self) -> String {
        let font = self
            .font_family
            .as_ref()
            .map(|value| format!("\"{}\"", json_escape_internal(value)))
            .unwrap_or_else(|| "null".to_string());
        let size = self
            .font_size_px
            .map(|n| n.to_string())
            .unwrap_or_else(|| "null".to_string());
        let vim = self
            .vim_default
            .map(|v| v.to_string())
            .unwrap_or_else(|| "null".to_string());
        let interval = self
            .autosave_interval_ms
            .map(|n| n.to_string())
            .unwrap_or_else(|| "null".to_string());
        let scheme = self
            .color_scheme
            .as_ref()
            .map(|value| format!("\"{}\"", json_escape_internal(value)))
            .unwrap_or_else(|| "null".to_string());
        format!(
            "{{\"fontFamily\":{font},\"fontSizePx\":{size},\"vimDefault\":{vim},\"autosaveIntervalMs\":{interval},\"colorScheme\":{scheme}}}\n"
        )
    }
}

fn json_escape_internal(value: &str) -> String {
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

#[derive(Debug)]
pub enum AuditComputeError {
    Io(io::Error),
    Parse(RichParseError),
}

impl std::fmt::Display for AuditComputeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuditComputeError::Io(error) => write!(f, "audit io error: {error}"),
            AuditComputeError::Parse(error) => write!(f, "audit parse error: {error:?}"),
        }
    }
}

impl std::error::Error for AuditComputeError {}

#[derive(Debug)]
pub enum CachedDocsStateError {
    Io(io::Error),
    Parse(RichParseError),
    MissingRevision,
}

impl std::fmt::Display for CachedDocsStateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CachedDocsStateError::Io(error) => {
                write!(f, "failed to read cached docs.json: {error}")
            }
            CachedDocsStateError::Parse(error) => {
                write!(f, "failed to parse cached docs.json: {error:?}")
            }
            CachedDocsStateError::MissingRevision => {
                f.write_str("cached docs.json has no revisionId; pull the document before pushing")
            }
        }
    }
}

impl std::error::Error for CachedDocsStateError {}

#[derive(Debug)]
pub enum MetadataError {
    Io(io::Error),
    Parse(JsonError),
    MissingField(&'static str),
}

impl std::fmt::Display for MetadataError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MetadataError::Io(error) => write!(f, "failed to read meta.json: {error}"),
            MetadataError::Parse(error) => write!(f, "failed to parse meta.json: {error:?}"),
            MetadataError::MissingField(name) => write!(f, "meta.json missing field: {name}"),
        }
    }
}

impl std::error::Error for MetadataError {}

impl MetadataRecord {
    pub fn from_rich_pull(
        document_id: impl Into<String>,
        revision_id: impl Into<String>,
        drive_modified_time: impl Into<String>,
        pulled_at: impl Into<String>,
        docs_json: &str,
        fidelity: FidelityReport,
    ) -> Self {
        Self {
            document_id: document_id.into(),
            revision_id: revision_id.into(),
            drive_modified_time: drive_modified_time.into(),
            md_hash: String::new(),
            docs_json_hash: stable_content_hash(docs_json),
            last_pulled_at: pulled_at.into(),
            last_pushed_at: None,
            last_fidelity_report: fidelity,
            title: None,
            imported_at: None,
            source_path: None,
        }
    }

    pub fn from_pull(
        document_id: impl Into<String>,
        revision_id: impl Into<String>,
        drive_modified_time: impl Into<String>,
        pulled_at: impl Into<String>,
        markdown: &str,
        docs_json: &str,
        fidelity: FidelityReport,
    ) -> Self {
        Self {
            document_id: document_id.into(),
            revision_id: revision_id.into(),
            drive_modified_time: drive_modified_time.into(),
            md_hash: stable_content_hash(markdown),
            docs_json_hash: stable_content_hash(docs_json),
            last_pulled_at: pulled_at.into(),
            last_pushed_at: None,
            last_fidelity_report: fidelity,
            title: None,
            imported_at: None,
            source_path: None,
        }
    }

    pub fn from_local_import(
        document_id: impl Into<String>,
        title: impl Into<String>,
        imported_at: u64,
        source_path: impl Into<String>,
        markdown: &str,
    ) -> Self {
        Self {
            document_id: document_id.into(),
            revision_id: String::new(),
            drive_modified_time: String::new(),
            md_hash: stable_content_hash(markdown),
            docs_json_hash: String::new(),
            last_pulled_at: imported_at.to_string(),
            last_pushed_at: None,
            last_fidelity_report: FidelityReport::perfect(),
            title: Some(title.into()),
            imported_at: Some(imported_at),
            source_path: Some(source_path.into()),
        }
    }

    pub fn with_push(mut self, pushed_at: impl Into<String>) -> Self {
        self.last_pushed_at = Some(pushed_at.into());
        self
    }

    pub fn from_json(raw: &str) -> Result<Self, MetadataError> {
        let root = parse_json(raw).map_err(MetadataError::Parse)?;
        let required_str = |key: &'static str| -> Result<String, MetadataError> {
            root.get(key)
                .and_then(JsonValue::as_str)
                .map(ToString::to_string)
                .ok_or(MetadataError::MissingField(key))
        };
        let optional_str = |key: &'static str| -> Option<String> {
            root.get(key)
                .and_then(JsonValue::as_str)
                .map(ToString::to_string)
        };
        let document_id = required_str("documentId")?;
        let revision_id = match root.get("revisionId") {
            Some(JsonValue::String(value)) => value.clone(),
            Some(JsonValue::Null) => String::new(),
            _ => return Err(MetadataError::MissingField("revisionId")),
        };
        let drive_modified_time = optional_str("driveModifiedTime").unwrap_or_default();
        let md_hash = optional_str("mdHash").unwrap_or_default();
        let docs_json_hash = optional_str("docsJsonHash").unwrap_or_default();
        let last_pulled_at = optional_str("lastPulledAt")
            .or_else(|| {
                root.get("importedAt").and_then(|value| match value {
                    JsonValue::Number(text) => Some(text.clone()),
                    _ => None,
                })
            })
            .unwrap_or_default();
        let last_pushed_at = root
            .get("lastPushedAt")
            .and_then(JsonValue::as_str)
            .map(ToString::to_string);
        let title = optional_str("title");
        let imported_at = root.get("importedAt").and_then(|value| match value {
            JsonValue::Number(text) => text.parse::<u64>().ok(),
            _ => None,
        });
        let source_path = optional_str("sourcePath");
        let score = root
            .path(&["lastFidelityReport", "score"])
            .and_then(|value| match value {
                JsonValue::Number(text) => text.parse::<u8>().ok(),
                _ => None,
            })
            .unwrap_or(100);
        let warnings = match root.path(&["lastFidelityReport", "warnings"]) {
            Some(JsonValue::Array(items)) => items
                .iter()
                .filter_map(|item| {
                    let kind = item.get("kind").and_then(JsonValue::as_str)?;
                    let message = item.get("message").and_then(JsonValue::as_str)?;
                    let parsed_kind = match kind {
                        "LosslessApproximation" => WarningKind::LosslessApproximation,
                        "LossyApproximation" => WarningKind::LossyApproximation,
                        "UnsupportedConstruct" => WarningKind::UnsupportedConstruct,
                        _ => return None,
                    };
                    Some(FidelityWarning::new(parsed_kind, message))
                })
                .collect(),
            _ => Vec::new(),
        };
        let last_fidelity_report = FidelityReport { score, warnings };
        Ok(Self {
            document_id,
            revision_id,
            drive_modified_time,
            md_hash,
            docs_json_hash,
            last_pulled_at,
            last_pushed_at,
            last_fidelity_report,
            title,
            imported_at,
            source_path,
        })
    }

    pub fn to_json(&self) -> String {
        let revision = if self.revision_id.is_empty() {
            "null".to_string()
        } else {
            format!("\"{}\"", json_escape(&self.revision_id))
        };
        let pushed = match &self.last_pushed_at {
            Some(value) => format!("\"{}\"", json_escape(value)),
            None => "null".to_string(),
        };
        let title = self
            .title
            .as_ref()
            .map(|value| format!(",\n  \"title\": \"{}\"", json_escape(value)))
            .unwrap_or_default();
        let imported_at = self
            .imported_at
            .map(|value| format!(",\n  \"importedAt\": {value}"))
            .unwrap_or_default();
        let source_path = self
            .source_path
            .as_ref()
            .map(|value| format!(",\n  \"sourcePath\": \"{}\"", json_escape(value)))
            .unwrap_or_default();
        let audit = if self.imported_at.is_some() {
            ",\n  \"audit\": null".to_string()
        } else {
            String::new()
        };
        let warnings = self
            .last_fidelity_report
            .warnings
            .iter()
            .map(|warning| {
                format!(
                    "{{\"kind\":\"{:?}\",\"message\":\"{}\"}}",
                    warning.kind,
                    json_escape(&warning.message)
                )
            })
            .collect::<Vec<_>>()
            .join(",");

        format!(
            concat!(
                "{{\n",
                "  \"documentId\": \"{}\",\n",
                "  \"revisionId\": {},\n",
                "  \"driveModifiedTime\": \"{}\",\n",
                "  \"mdHash\": \"{}\",\n",
                "  \"docsJsonHash\": \"{}\",\n",
                "  \"lastPulledAt\": \"{}\",\n",
                "  \"lastPushedAt\": {},\n",
                "  \"lastFidelityReport\": {{\"score\": {}, \"warnings\": [{}]}}{}{}{}{}\n",
                "}}\n"
            ),
            json_escape(&self.document_id),
            revision,
            json_escape(&self.drive_modified_time),
            json_escape(&self.md_hash),
            json_escape(&self.docs_json_hash),
            json_escape(&self.last_pulled_at),
            pushed,
            self.last_fidelity_report.score,
            warnings,
            title,
            imported_at,
            source_path,
            audit,
        )
    }
}

fn archive_existing_to_trash(current: &Path, trash_dir: &Path) -> io::Result<Option<PathBuf>> {
    if !current.exists() {
        return Ok(None);
    }
    fs::create_dir_all(trash_dir)?;
    let stamp = current_stamp();
    let target = trash_dir.join(format!("{stamp}.md"));
    fs::copy(current, &target)?;
    Ok(Some(target))
}

fn list_dir_entries(dir: &Path) -> io::Result<Vec<PathBuf>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_file())
        .collect();
    entries.sort_by(|a, b| b.cmp(a));
    Ok(entries)
}

/// Configurable compaction over `dir`. Applies an age cap (drop files
/// older than `max_age_days`) and a count cap (keep the newest `keep_n`)
/// in sequence. Returns the count of removed files. Files we can't remove
/// (perms, racy unlink) are skipped silently — best-effort only.
fn compact_directory(
    dir: &Path,
    keep_n: Option<usize>,
    max_age_days: Option<u64>,
) -> io::Result<usize> {
    if !dir.exists() {
        return Ok(0);
    }
    let now = SystemTime::now();
    let mut entries: Vec<(SystemTime, PathBuf)> = fs::read_dir(dir)?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            let modified = metadata
                .modified()
                .or_else(|_| metadata.created())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            Some((modified, entry.path()))
        })
        .collect();
    let mut removed = 0_usize;
    if let Some(days) = max_age_days {
        if days > 0 {
            let cutoff = std::time::Duration::from_secs(days * 86_400);
            entries.retain(|(modified, path)| {
                if now
                    .duration_since(*modified)
                    .map(|elapsed| elapsed > cutoff)
                    .unwrap_or(false)
                {
                    if fs::remove_file(path).is_ok() {
                        removed += 1;
                    }
                    return false;
                }
                true
            });
        }
    }
    if let Some(keep) = keep_n {
        if entries.len() > keep {
            entries.sort_by(|a, b| b.0.cmp(&a.0));
            for (_, path) in entries.into_iter().skip(keep) {
                if fs::remove_file(path).is_ok() {
                    removed += 1;
                }
            }
        }
    }
    Ok(removed)
}

fn directory_size_bytes(dir: &Path) -> io::Result<u64> {
    if !dir.exists() {
        return Ok(0);
    }
    let mut total: u64 = 0;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if metadata.is_file() {
            total = total.saturating_add(metadata.len());
        }
    }
    Ok(total)
}

fn prune_directory(dir: &Path, max_entries: usize) -> io::Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    let mut entries: Vec<(SystemTime, PathBuf)> = fs::read_dir(dir)?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            let modified = metadata
                .modified()
                .or_else(|_| metadata.created())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            Some((modified, entry.path()))
        })
        .collect();
    if entries.len() <= max_entries {
        return Ok(());
    }
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in entries.into_iter().skip(max_entries) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

fn current_stamp() -> String {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{:010}.{:09}", elapsed.as_secs(), elapsed.subsec_nanos())
}

fn atomic_write(path: impl AsRef<Path>, bytes: &[u8]) -> io::Result<()> {
    let path = path.as_ref();
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

fn sanitize_path_segment(segment: &str) -> String {
    segment
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect()
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
            _ => out.push(ch),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn metadata_round_trips_fidelity_warnings_through_json() {
        let mut report = FidelityReport::perfect();
        report = report.with_warning(FidelityWarning::new(
            WarningKind::LossyApproximation,
            "table cells lost styling",
        ));
        report = report.with_warning(FidelityWarning::new(
            WarningKind::UnsupportedConstruct,
            "smart chips dropped",
        ));
        let metadata = MetadataRecord::from_pull(
            "doc1",
            "rev1",
            "2026-05-01T00:00:00Z",
            "2026-05-01T00:00:01Z",
            "# T\n",
            "{}",
            report,
        );
        let parsed = MetadataRecord::from_json(&metadata.to_json()).unwrap();
        assert_eq!(parsed.last_fidelity_report.warnings.len(), 2);
        assert_eq!(
            parsed.last_fidelity_report.warnings[0].kind,
            WarningKind::LossyApproximation
        );
        assert_eq!(
            parsed.last_fidelity_report.warnings[1].message,
            "smart chips dropped"
        );
    }

    #[test]
    fn metadata_round_trips_through_json_and_records_push() {
        let metadata = MetadataRecord::from_pull(
            "doc1",
            "rev1",
            "2026-05-01T00:00:00Z",
            "2026-05-01T00:00:01Z",
            "# Title\n",
            "{}",
            FidelityReport::perfect(),
        );
        let pushed = metadata.with_push("2026-05-01T00:00:02Z");
        let parsed = MetadataRecord::from_json(&pushed.to_json()).unwrap();
        assert_eq!(parsed.document_id, "doc1");
        assert_eq!(parsed.revision_id, "rev1");
        assert_eq!(
            parsed.last_pushed_at.as_deref(),
            Some("2026-05-01T00:00:02Z")
        );
    }

    #[test]
    fn read_current_docs_state_returns_revision_and_body_end() {
        let root = std::env::temp_dir().join(format!(
            "melon-pan-state-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = LocalCacheStore::new(&root);
        store.initialize().unwrap();
        let docs_json = r#"{"documentId":"doc1","title":"T","revisionId":"rev42","body":{"content":[{"startIndex":1,"endIndex":17}]}}"#;
        let metadata = MetadataRecord::from_pull(
            "doc1",
            "rev42",
            "2026-05-01T00:00:00Z",
            "2026-05-01T00:00:01Z",
            "# T\n",
            docs_json,
            FidelityReport::perfect(),
        );
        store
            .write_current_doc("doc1", "# T\n", docs_json, &metadata)
            .unwrap();

        let state = store.read_current_docs_state("doc1").unwrap();
        assert_eq!(state.revision_id, "rev42");
        assert_eq!(state.body_end_index, 17);
        let parsed_meta = store.read_metadata("doc1").unwrap();
        assert_eq!(parsed_meta.revision_id, "rev42");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn write_current_doc_archives_previous_to_trash_and_restore_round_trips() {
        let root = std::env::temp_dir().join(format!(
            "melon-pan-trash-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = LocalCacheStore::new(&root);
        store.initialize().unwrap();

        let metadata = MetadataRecord::from_pull(
            "doc1",
            "rev1",
            "2026-05-01T00:00:00Z",
            "2026-05-01T00:00:01Z",
            "v1\n",
            "{}",
            FidelityReport::perfect(),
        );
        store
            .write_current_doc("doc1", "v1\n", "{}", &metadata)
            .unwrap();
        // Brief sleep so the second write gets a distinct nanosecond stamp.
        std::thread::sleep(std::time::Duration::from_millis(2));
        store
            .write_current_doc("doc1", "v2\n", "{}", &metadata)
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        store
            .write_current_doc("doc1", "v3\n", "{}", &metadata)
            .unwrap();

        let trash = store.list_trash("doc1").unwrap();
        assert_eq!(trash.len(), 2, "two prior versions should be archived");
        let oldest = trash.last().unwrap().clone();
        let oldest_contents = fs::read_to_string(&oldest).unwrap();
        assert_eq!(oldest_contents, "v1\n");

        store.restore_to_current("doc1", &oldest).unwrap();
        let restored = fs::read_to_string(store.paths_for("doc1").current_md).unwrap();
        assert_eq!(restored, "v1\n");
        // Restoring also archived the previous current.md.
        let trash_after = store.list_trash("doc1").unwrap();
        assert!(trash_after.len() >= 3);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn compact_doc_snapshots_drops_old_files_and_caps_count() {
        let root = std::env::temp_dir().join(format!(
            "melon-pan-compact-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = LocalCacheStore::new(&root);
        store.initialize().unwrap();
        let metadata = MetadataRecord::from_pull(
            "doc1",
            "rev1",
            "2026-05-01T00:00:00Z",
            "2026-05-01T00:00:01Z",
            "draft\n",
            "{}",
            FidelityReport::perfect(),
        );
        // Create five pre-push snapshots with distinct timestamps so prune
        // doesn't run during write_current_doc.
        for n in 0..5 {
            store
                .write_current_doc("doc1", &format!("v{n}\n"), "{}", &metadata)
                .unwrap();
            store.snapshot_pre_push("doc1").unwrap();
            std::thread::sleep(std::time::Duration::from_millis(3));
        }
        let pre_push = store.list_pre_push_snapshots("doc1").unwrap();
        assert!(pre_push.len() >= 4);

        // Cap to 2; expect 3+ files removed across pre-push (and possibly
        // trash from the write_current_doc archival).
        let removed = store.compact_doc_snapshots("doc1", Some(2), None).unwrap();
        assert!(removed >= 1);
        let after = store.list_pre_push_snapshots("doc1").unwrap();
        assert!(after.len() <= 2);

        let bytes = store.snapshot_disk_usage_bytes("doc1").unwrap();
        assert!(bytes > 0, "remaining snapshots should still be on disk");

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn compact_doc_snapshots_requires_no_args_to_be_a_noop() {
        // Calling with both keep_n and max_age_days as None never deletes
        // files; the helper just walks and returns 0.
        let root = std::env::temp_dir().join(format!(
            "melon-pan-compact-noop-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = LocalCacheStore::new(&root);
        store.initialize().unwrap();
        let removed = store
            .compact_doc_snapshots("doc-missing", None, None)
            .unwrap();
        assert_eq!(removed, 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn overwrite_current_markdown_archives_previous_to_trash() {
        let root = std::env::temp_dir().join(format!(
            "melon-pan-overwrite-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = LocalCacheStore::new(&root);
        store.initialize().unwrap();
        let metadata = MetadataRecord::from_pull(
            "doc1",
            "rev1",
            "2026-05-01T00:00:00Z",
            "2026-05-01T00:00:01Z",
            "v1\n",
            "{}",
            FidelityReport::perfect(),
        );
        store
            .write_current_doc("doc1", "v1\n", "{}", &metadata)
            .unwrap();

        // Overwrite — the prior v1 should land in trash before v2 lands
        // in current.md. docs.json + meta.json must NOT be touched.
        std::thread::sleep(std::time::Duration::from_millis(2));
        store
            .overwrite_current_markdown("doc1", "v2-edited\n")
            .unwrap();

        let paths = store.paths_for("doc1");
        let current = std::fs::read_to_string(&paths.current_md).unwrap();
        assert_eq!(current, "v2-edited\n");
        let docs_json = std::fs::read_to_string(&paths.current_docs_json).unwrap();
        assert_eq!(docs_json, "{}", "docs.json must not be modified");
        let trash = store.list_trash("doc1").unwrap();
        assert_eq!(trash.len(), 1);
        let archived = std::fs::read_to_string(&trash[0]).unwrap();
        assert_eq!(archived, "v1\n");

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn snapshot_pre_push_archives_buffer() {
        let root = std::env::temp_dir().join(format!(
            "melon-pan-prepush-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = LocalCacheStore::new(&root);
        store.initialize().unwrap();
        let metadata = MetadataRecord::from_pull(
            "doc1",
            "rev1",
            "2026-05-01T00:00:00Z",
            "2026-05-01T00:00:01Z",
            "draft\n",
            "{}",
            FidelityReport::perfect(),
        );
        store
            .write_current_doc("doc1", "draft\n", "{}", &metadata)
            .unwrap();
        let path = store.snapshot_pre_push("doc1").unwrap().expect("path");
        assert_eq!(fs::read_to_string(&path).unwrap(), "draft\n");
        assert_eq!(store.list_pre_push_snapshots("doc1").unwrap().len(), 1);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn initializes_and_writes_dual_format_doc() {
        let root = std::env::temp_dir().join(format!(
            "melon-pan-core-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = LocalCacheStore::new(&root);
        store.initialize().unwrap();
        assert_eq!(
            fs::read_to_string(store.drive_tree_path()).unwrap(),
            "{\"files\":[]}\n"
        );

        let metadata = MetadataRecord::from_pull(
            "doc/1",
            "rev:1",
            "2026-05-01T00:00:00Z",
            "2026-05-01T00:00:01Z",
            "# Title\n",
            "{\"body\":[]}",
            FidelityReport::perfect(),
        );
        store
            .write_current_doc("doc/1", "# Title\n", "{\"body\":[]}", &metadata)
            .unwrap();
        store
            .write_snapshot("doc/1", "rev:1", "# Title\n", "{\"body\":[]}")
            .unwrap();

        let paths = store.paths_for("doc/1");
        assert!(paths.current_md.exists());
        assert!(paths.current_docs_json.exists());
        assert!(paths.meta_json.exists());
        assert!(paths.pending_dir.exists());
        assert!(paths.snapshot_dir.join("rev_1.md").exists());
        assert!(paths.snapshot_dir.join("rev_1.docs.json").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn initialize_preserves_existing_drive_tree() {
        let root = std::env::temp_dir().join(format!(
            "melon-pan-core-drive-tree-preserve-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = LocalCacheStore::new(&root);
        store.initialize().unwrap();
        let existing = "{\"files\":[{\"id\":\"doc1\",\"name\":\"Doc\",\"mimeType\":\"application/vnd.google-apps.document\",\"parents\":[\"root\"],\"modifiedTime\":null,\"trashed\":false,\"editable\":true}]}\n";
        fs::write(store.drive_tree_path(), existing).unwrap();

        store.initialize().unwrap();

        assert_eq!(
            fs::read_to_string(store.drive_tree_path()).unwrap(),
            existing
        );
        fs::remove_dir_all(root).unwrap();
    }
}
