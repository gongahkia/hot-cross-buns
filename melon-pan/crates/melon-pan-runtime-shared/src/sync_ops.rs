//! Pull / drive / drain orchestration shared by every Melon Pan app.
//!
//! Markdown push and Obsidian import were removed in the rich-docs-only
//! cut. `push_document` is intentionally a stub returning
//! `SyncError::RichPushUnsupported` until the rich operation compiler
//! (per RICHTEXT-TODO `rich_batch.rs`) lands. Pull, drive-tree refresh,
//! and pending-drain are unchanged in semantics — they just consume the
//! `RichDocument` model rather than the legacy `DocsDocument`.

use crate::sync_journal::{append_event, SyncEvent, SyncEventKind};
use melon_pan_core::{
    append_envelope, apply_operation, archive_log, classify_conflict, clear_log, compile_batch,
    drive_comments_sidecar_json, effective_envelopes, has_pending, list_pending_mutation_files,
    parse_json, parse_rich_document, persist_pulled_document, read_envelopes, utf16_len, validate,
    BatchCompileError, CachedDocsStateError, ConflictReport, DestructiveConflict, FidelityWarning,
    JsonValue, LocalCacheStore, MetadataError, OperationOutcome, PulledDocument, RichBlock,
    RichDocument, RichInline, RichNodeId, RichOperation, RichOperationEnvelope, RichParagraph,
    RichTable,
};
use melon_pan_net::{
    DocsClient, DocsTransportError, DriveClient, DriveCommentsClient, HttpClient, HttpError,
};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug)]
pub enum SyncError {
    Unauthorized,
    RichPushUnsupported(String),
    NoCachedState(CachedDocsStateError),
    Transport(DocsTransportError),
    /// Server rejected the batch because the local cached
    /// `requiredRevisionId` no longer matches Google's tip. Caller
    /// should re-pull and either re-emit edits against the new
    /// revision or discard the local operation log.
    RevisionRejected {
        message: String,
    },
    Persist(String),
    Metadata(MetadataError),
    Other(String),
}

impl std::fmt::Display for SyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyncError::Unauthorized => f.write_str("HTTP 401: token rejected"),
            SyncError::RichPushUnsupported(message) => write!(f, "{message}"),
            SyncError::NoCachedState(error) => write!(f, "{error}"),
            SyncError::Transport(error) => write!(f, "{error}"),
            SyncError::RevisionRejected { message } => write!(f, "{message}"),
            SyncError::Persist(message) => write!(f, "{message}"),
            SyncError::Metadata(error) => write!(f, "{error}"),
            SyncError::Other(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for SyncError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullReport {
    pub document_id: String,
    pub revision_id: String,
    pub body_end_index: u32,
    pub plain_text: String,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PushOutcome {
    Pushed {
        revision_before: String,
        revision_after: String,
        plain_text: String,
    },
    QueuedRevisionConflict {
        pending_path: PathBuf,
    },
    QueuedTransportFailure {
        pending_path: PathBuf,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushReport {
    pub outcome: PushOutcome,
    pub fidelity_warnings: Vec<FidelityWarning>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DrainReport {
    pub cleared_pending: usize,
    pub revision_after: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConflictResolutionReport {
    pub canceled_operations: usize,
    pub remaining_pending: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommentRefreshReport {
    pub document_id: String,
    pub comment_count: usize,
}

/// Pages through Drive (optionally filtered to `parent_id`) and rewrites
/// `<cache>/drive-tree.json` so the macOS sidebar can re-read the latest tree.
pub fn refresh_drive_tree(
    access_token: &str,
    parent_id: Option<&str>,
    cache_root: &Path,
) -> Result<usize, SyncError> {
    let store = LocalCacheStore::new(cache_root);
    store
        .initialize()
        .map_err(|error| SyncError::Other(format!("failed to initialize cache: {error}")))?;
    let http = HttpClient::new(access_token.to_string())
        .map_err(|error| SyncError::Other(format!("HTTP client: {error}")))?;
    let drive = DriveClient::new(http);
    let items = match drive.list_all(parent_id) {
        Ok(items) => items,
        Err(melon_pan_net::DriveTransportError::Http(HttpError::Status {
            status: 401, ..
        })) => return Err(SyncError::Unauthorized),
        Err(error) => return Err(SyncError::Other(error.to_string())),
    };
    store
        .write_drive_tree(&items)
        .map_err(|error| SyncError::Persist(error.to_string()))?;
    Ok(items.len())
}

pub fn pull_document(
    access_token: &str,
    document_id: &str,
    cache_root: &Path,
) -> Result<PullReport, SyncError> {
    let store = LocalCacheStore::new(cache_root);
    store
        .initialize()
        .map_err(|error| SyncError::Other(format!("failed to initialize cache: {error}")))?;
    let http = HttpClient::new(access_token.to_string())
        .map_err(|error| SyncError::Other(format!("HTTP client: {error}")))?;
    let docs = DocsClient::new(http);
    let (parsed, raw) = match docs.get(document_id) {
        Ok(value) => value,
        Err(DocsTransportError::Http {
            source: HttpError::Status { status: 401, .. },
            ..
        }) => {
            return Err(SyncError::Unauthorized);
        }
        Err(error) => return Err(SyncError::Transport(error)),
    };
    let pulled_at = current_timestamp();
    let title = parsed.title.clone();
    let pulled = PulledDocument {
        document: parsed,
        raw_docs_json: raw,
        drive_modified_time: "unknown".to_string(),
        pulled_at,
    };
    let result = persist_pulled_document(&store, pulled)
        .map_err(|error| SyncError::Persist(error.to_string()))?;
    let _ = append_event(
        cache_root,
        &SyncEvent::new(
            SyncEventKind::Pull,
            &result.document_id,
            &result.revision_id,
            "pulled".to_string(),
        ),
    );
    Ok(PullReport {
        document_id: result.document_id,
        revision_id: result.revision_id,
        // body_end_index is no longer surfaced from rich-parse; rich-batch
        // uses stable IDs + rich_index conversions instead. Reported as 0.
        body_end_index: 0,
        plain_text: result.plain_text,
        title,
    })
}

pub fn refresh_document_comments(
    access_token: &str,
    document_id: &str,
    cache_root: &Path,
) -> Result<CommentRefreshReport, SyncError> {
    let store = LocalCacheStore::new(cache_root);
    store
        .initialize()
        .map_err(|error| SyncError::Other(format!("failed to initialize cache: {error}")))?;
    let http = HttpClient::new(access_token.to_string())
        .map_err(|error| SyncError::Other(format!("HTTP client: {error}")))?;
    let comments_client = DriveCommentsClient::new(http);
    let comments = match comments_client.list_all(document_id) {
        Ok(comments) => comments,
        Err(melon_pan_net::DriveCommentsTransportError::Http(HttpError::Status {
            status: 401,
            ..
        })) => return Err(SyncError::Unauthorized),
        Err(error) => return Err(SyncError::Other(error.to_string())),
    };
    let fetched_at = current_timestamp();
    let sidecar = drive_comments_sidecar_json(document_id, &fetched_at, &comments);
    store
        .write_comments_sidecar(document_id, &sidecar)
        .map_err(|error| SyncError::Persist(error.to_string()))?;
    Ok(CommentRefreshReport {
        document_id: document_id.to_string(),
        comment_count: comments.len(),
    })
}

/// Push the queued operation log to Google Docs.
///
/// 1. Read `<doc>/operation-log.jsonl`.
/// 2. Parse the cached `current.docs.json` into a RichDocument so the
///    compiler can resolve paragraph IDs to body indexes.
/// 3. Compile envelopes to a single batchUpdate keyed on
///    `requiredRevisionId` from the cache.
/// 4. POST to `documents.batchUpdate`.
/// 5. Re-pull, persist, run `rich_validate::validate`.
/// 6. On `all_clear`: archive the log, clear it, record_push.
///    Otherwise: leave the log in place so the user can retry/debug.
pub fn push_document(
    access_token: &str,
    document_id: &str,
    cache_root: &Path,
) -> Result<PushReport, SyncError> {
    let store = LocalCacheStore::new(cache_root);
    store
        .initialize()
        .map_err(|error| SyncError::Other(format!("failed to initialize cache: {error}")))?;

    let envelopes = read_envelopes(&store, document_id)
        .map_err(|error| SyncError::Other(format!("operation log read: {error}")))?;
    let effective = effective_envelopes(&envelopes);
    if effective.is_empty() {
        return Err(SyncError::RichPushUnsupported(
            "no queued operations to push; edit the document first".to_string(),
        ));
    }

    let cached_raw = store
        .read_current_docs_json(document_id)
        .map_err(|error| SyncError::Other(format!("read current.docs.json: {error}")))?;
    let before_doc: RichDocument = parse_rich_document(&cached_raw)
        .map_err(|error| SyncError::Other(format!("parse cached doc: {error:?}")))?;
    let revision_before = before_doc.revision.revision_id.clone();

    let request = match compile_batch(&before_doc, document_id, &revision_before, &effective) {
        Ok(request) => request,
        Err(BatchCompileError::EmptyBatch) => {
            return Err(SyncError::RichPushUnsupported(
                "all queued operations were no-ops; nothing to push".to_string(),
            ));
        }
        Err(error) => {
            return Err(SyncError::RichPushUnsupported(format!(
                "batch compile failed: {error}"
            )));
        }
    };

    let http = HttpClient::new(access_token.to_string())
        .map_err(|error| SyncError::Other(format!("HTTP client: {error}")))?;
    let docs = DocsClient::new(http);

    match docs.batch_update(&request) {
        Ok(_response) => {}
        Err(DocsTransportError::Http {
            source: HttpError::Status { status: 401, .. },
            ..
        }) => {
            return Err(SyncError::Unauthorized);
        }
        Err(DocsTransportError::Http {
            request_url,
            source: HttpError::Status { status: 400, body },
        }) => {
            // Docs API returns 400 when requiredRevisionId is stale.
            // The body's error message includes "revision" or
            // "required_revision_id"; match generously so future Google
            // copy changes don't break detection. Anything else 400-shaped
            // bubbles up as a generic transport error.
            let lower = body.to_ascii_lowercase();
            if lower.contains("revision") || lower.contains("required_revision_id") {
                return Err(SyncError::RevisionRejected { message: body });
            }
            return Err(SyncError::Transport(DocsTransportError::Http {
                request_url,
                source: HttpError::Status { status: 400, body },
            }));
        }
        Err(error) => {
            return Err(SyncError::Transport(error));
        }
    }

    // Re-pull so we can validate the post-write state.
    let (parsed_after, raw_after) = match docs.get(document_id) {
        Ok(value) => value,
        Err(DocsTransportError::Http {
            source: HttpError::Status { status: 401, .. },
            ..
        }) => {
            return Err(SyncError::Unauthorized);
        }
        Err(error) => return Err(SyncError::Transport(error)),
    };

    let pulled_at = current_timestamp();
    let pulled = PulledDocument {
        document: parsed_after.clone(),
        raw_docs_json: raw_after,
        drive_modified_time: "unknown".to_string(),
        pulled_at: pulled_at.clone(),
    };
    let persisted = persist_pulled_document(&store, pulled)
        .map_err(|error| SyncError::Persist(error.to_string()))?;

    let op_pairs: Vec<(String, RichOperation)> = effective
        .iter()
        .map(|env| (env.operation_id.clone(), env.op.clone()))
        .collect();
    let report = validate(&before_doc, &parsed_after, &op_pairs);
    let unexpected_diffs = post_write_unexpected_diffs(&before_doc, &parsed_after, &effective);

    let mut warnings: Vec<FidelityWarning> = Vec::new();
    for outcome in &report.operations {
        if let OperationOutcome::Failed {
            operation_id,
            reason,
        } = outcome
        {
            warnings.push(FidelityWarning::new(
                melon_pan_core::WarningKind::LossyApproximation,
                format!("op {operation_id} failed validation: {reason}"),
            ));
        }
    }
    for dropped in &report.dropped_named_ranges {
        warnings.push(FidelityWarning::new(
            melon_pan_core::WarningKind::LossyApproximation,
            format!("named range '{dropped}' dropped on push"),
        ));
    }
    for diff in &unexpected_diffs {
        warnings.push(FidelityWarning::new(
            melon_pan_core::WarningKind::LossyApproximation,
            format!("unexpected post-write diff: {diff}"),
        ));
    }

    if report.all_clear && unexpected_diffs.is_empty() {
        // Archive log first so a crash between archive and clear leaves
        // recoverable state, then clear.
        let _ = archive_log(&store, document_id, &pulled_at);
        let _ = clear_log(&store, document_id);
        store
            .record_push(document_id, &pulled_at)
            .map_err(SyncError::Metadata)?;
    }

    let _ = append_event(
        cache_root,
        &SyncEvent::new(
            SyncEventKind::Push,
            document_id,
            &persisted.revision_id,
            if report.all_clear && unexpected_diffs.is_empty() {
                format!("pushed from {revision_before}")
            } else {
                format!(
                    "pushed from {revision_before} with {} validation issue(s)",
                    warnings.len()
                )
            },
        ),
    );

    Ok(PushReport {
        outcome: PushOutcome::Pushed {
            revision_before,
            revision_after: persisted.revision_id,
            plain_text: persisted.plain_text,
        },
        fidelity_warnings: warnings,
    })
}

fn post_write_unexpected_diffs(
    before: &RichDocument,
    after: &RichDocument,
    envelopes: &[RichOperationEnvelope],
) -> Vec<String> {
    let mut expected = before.clone();
    for envelope in envelopes {
        if let Err(error) = apply_operation(&mut expected, &envelope.op) {
            return vec![format!(
                "could not replay {} locally for full-document validation: {error:?}",
                envelope.operation_id
            )];
        }
    }

    let expected_signature = document_signature(&expected);
    let actual_signature = document_signature(after);
    if expected_signature == actual_signature {
        return Vec::new();
    }

    let mut diffs = Vec::new();
    let max_len = expected_signature.len().max(actual_signature.len());
    for index in 0..max_len {
        let expected = expected_signature
            .get(index)
            .map(String::as_str)
            .unwrap_or("<missing>");
        let actual = actual_signature
            .get(index)
            .map(String::as_str)
            .unwrap_or("<missing>");
        if expected != actual {
            diffs.push(format!(
                "block {index}: expected {expected:?}, got {actual:?}"
            ));
            if diffs.len() >= 5 {
                break;
            }
        }
    }
    diffs
}

fn document_signature(document: &RichDocument) -> Vec<String> {
    let mut out = Vec::new();
    for tab in &document.tabs {
        out.push(format!("tab:{}:{}", tab.index, tab.title));
        collect_block_signature(&tab.body.blocks, &mut out);
    }
    out
}

fn collect_block_signature(blocks: &[RichBlock], out: &mut Vec<String>) {
    for block in blocks {
        match block {
            RichBlock::Paragraph(paragraph) => {
                out.push(format!(
                    "p:{:?}:{}",
                    paragraph.style.named_style,
                    paragraph_text_signature(paragraph)
                ));
            }
            RichBlock::Table(table) => {
                out.push(format!("table:{}x{}", table.rows.len(), table.columns));
                for (row_index, row) in table.rows.iter().enumerate() {
                    out.push(format!("row:{row_index}:{}", row.cells.len()));
                    for (cell_index, cell) in row.cells.iter().enumerate() {
                        out.push(format!(
                            "cell:{row_index}:{cell_index}:{}x{}",
                            cell.row_span, cell.column_span
                        ));
                        collect_block_signature(&cell.content, out);
                    }
                }
            }
            RichBlock::SectionBreak(section) => {
                out.push(format!("section:{}", section.identity.raw_hash));
            }
            RichBlock::Unsupported(unsupported) => {
                out.push(format!("unsupported:{}", unsupported.description));
            }
        }
    }
}

fn paragraph_text_signature(paragraph: &RichParagraph) -> String {
    let mut out = String::new();
    for inline in &paragraph.inlines {
        match inline {
            RichInline::TextRun(run) => out.push_str(&run.text),
            RichInline::InlineObjectRef(object) => {
                out.push_str("[inline:");
                out.push_str(&object.object_id);
                out.push(']');
            }
            RichInline::Unsupported(unsupported) => {
                out.push_str("[unsupported:");
                out.push_str(&unsupported.description);
                out.push(']');
            }
            _ => out.push_str("[rich-inline]"),
        }
    }
    out
}

/// Append an editor-emitted operation envelope to the doc's log. The app
/// editor calls this on every edit; push_document drains the log on save.
pub fn append_operation(
    cache_root: &Path,
    document_id: &str,
    envelope: &RichOperationEnvelope,
) -> Result<(), SyncError> {
    let store = LocalCacheStore::new(cache_root);
    store
        .initialize()
        .map_err(|error| SyncError::Other(format!("failed to initialize cache: {error}")))?;
    melon_pan_core::append_envelope(&store, document_id, envelope)
        .map_err(|error| SyncError::Other(format!("append op: {error}")))
}

/// Classify queued local edits against the current cached remote revision.
///
/// Callers should first pull after a `requiredRevisionId` rejection. The
/// pull writes the remote tip to `current.docs.json`, while the base
/// revision is recovered from the revision snapshot named by the first
/// queued operation's `baseRevisionId`.
pub fn classify_cached_conflict(
    cache_root: &Path,
    document_id: &str,
) -> Result<ConflictReport, SyncError> {
    let store = LocalCacheStore::new(cache_root);
    store
        .initialize()
        .map_err(|error| SyncError::Other(format!("failed to initialize cache: {error}")))?;

    let raw_envelopes = read_envelopes(&store, document_id)
        .map_err(|error| SyncError::Other(format!("operation log read: {error}")))?;
    let envelopes = effective_envelopes(&raw_envelopes);
    if envelopes.is_empty() {
        return Err(SyncError::RichPushUnsupported(
            "no queued operations to classify".to_string(),
        ));
    }

    let base_revision = envelopes
        .iter()
        .find_map(|env| {
            if env.base_revision_id.is_empty() {
                None
            } else {
                Some(env.base_revision_id.as_str())
            }
        })
        .ok_or_else(|| SyncError::Other("queued operations have no base revision".to_string()))?;
    let base_raw = read_revision_snapshot(&store, document_id, base_revision)?;
    let remote_raw = store
        .read_current_docs_json(document_id)
        .map_err(|error| SyncError::Other(format!("read current.docs.json: {error}")))?;

    let base_doc: RichDocument = parse_rich_document(&base_raw)
        .map_err(|error| SyncError::Other(format!("parse base revision: {error:?}")))?;
    let remote_doc: RichDocument = parse_rich_document(&remote_raw)
        .map_err(|error| SyncError::Other(format!("parse remote revision: {error:?}")))?;
    let mut local_doc = base_doc.clone();
    let mut apply_errors = Vec::new();
    for env in &envelopes {
        if let Err(error) = apply_operation(&mut local_doc, &env.op) {
            apply_errors.push((env.operation_id.clone(), error.to_string()));
        }
    }

    let mut report = classify_conflict(&base_doc, &local_doc, &remote_doc, &envelopes);
    report
        .destructive
        .extend(
            apply_errors
                .into_iter()
                .map(|(operation_id, reason)| DestructiveConflict {
                    id: format!("apply-error:{operation_id}"),
                    kind: "operation".to_string(),
                    node_id: String::new(),
                    title: format!("Queued operation {operation_id}"),
                    reason,
                    local_operation_ids: vec![operation_id],
                    table_id: None,
                    row_index: None,
                    column_index: None,
                    row_span: None,
                    column_span: None,
                }),
        );
    Ok(report)
}

/// Apply conflict choices by canceling queued operation ids selected for
/// the remote side. Local choices leave the operation log intact so the
/// next save can retry them against the latest revision.
pub fn resolve_cached_conflict(
    cache_root: &Path,
    document_id: &str,
    resolution_json: &str,
) -> Result<ConflictResolutionReport, SyncError> {
    let store = LocalCacheStore::new(cache_root);
    store
        .initialize()
        .map_err(|error| SyncError::Other(format!("failed to initialize cache: {error}")))?;
    let decisions = conflict_decisions(resolution_json)?;
    if decisions
        .iter()
        .all(|decision| decision.decision != "remote" && decision.decision != "manual")
    {
        return Ok(ConflictResolutionReport {
            canceled_operations: 0,
            remaining_pending: has_pending(&store, document_id),
        });
    }

    let report = classify_cached_conflict(cache_root, document_id)?;
    let mut operation_ids = Vec::new();
    for decision in &decisions {
        if decision.decision == "remote" || decision.decision == "manual" {
            operation_ids.extend(region_operation_ids(&report, &decision.region_id));
        }
    }
    operation_ids.sort();
    operation_ids.dedup();

    let mut canceled = 0;
    let stamp = current_timestamp();
    for operation_id in &operation_ids {
        let cancel = RichOperationEnvelope::new(
            format!("conflict-cancel-{operation_id}-{stamp}-{canceled}"),
            document_id,
            "",
            report.remote_revision_id.as_str(),
            stamp.as_str(),
            "conflict-resolution",
            RichOperation::CancelOperation {
                operation_id: operation_id.clone(),
            },
        );
        append_envelope(&store, document_id, &cancel)
            .map_err(|error| SyncError::Other(format!("append cancel op: {error}")))?;
        canceled += 1;
    }

    let manual_decisions: Vec<_> = decisions
        .iter()
        .filter(|decision| decision.decision == "manual")
        .collect();
    if !manual_decisions.is_empty() {
        let remote_raw = store
            .read_current_docs_json(document_id)
            .map_err(|error| SyncError::Other(format!("read current.docs.json: {error}")))?;
        let remote_doc: RichDocument = parse_rich_document(&remote_raw)
            .map_err(|error| SyncError::Other(format!("parse remote revision: {error:?}")))?;

        for (index, decision) in manual_decisions.into_iter().enumerate() {
            let Some(region) = report
                .user_decision
                .iter()
                .find(|region| region.id == decision.region_id)
            else {
                return Err(SyncError::RichPushUnsupported(format!(
                    "manual resolution is only available for known conflict regions: {}",
                    decision.region_id
                )));
            };
            let manual_text = decision.manual_text.as_deref().ok_or_else(|| {
                SyncError::Other(format!(
                    "manual resolution missing text for {}",
                    decision.region_id
                ))
            })?;
            if region.kind == "table" {
                let table_id = region.table_id.as_deref().unwrap_or(&region.node_id);
                let table = find_table_by_string(&remote_doc, table_id).ok_or_else(|| {
                    SyncError::Other(format!("manual table target not found: {table_id}"))
                })?;
                let operations =
                    synthesize_table_topology_ops(&table.identity.local_id, table, manual_text)?;
                for (op_index, op) in operations.into_iter().enumerate() {
                    let envelope = RichOperationEnvelope::new(
                        format!(
                            "conflict-manual-table-{}-{stamp}-{index}-{op_index}",
                            decision.region_id
                        ),
                        document_id,
                        "",
                        report.remote_revision_id.as_str(),
                        stamp.as_str(),
                        "conflict-resolution",
                        op,
                    );
                    append_envelope(&store, document_id, &envelope)
                        .map_err(|error| SyncError::Other(format!("append manual op: {error}")))?;
                }
                continue;
            }
            if region.kind != "paragraph" && region.kind != "tableCell" {
                return Err(SyncError::RichPushUnsupported(format!(
                    "manual resolution is not available for {} regions: {}",
                    region.kind, decision.region_id
                )));
            }
            let paragraph_id = find_paragraph_id_by_string(&remote_doc, &region.node_id)
                .ok_or_else(|| {
                    SyncError::Other(format!(
                        "manual resolution target paragraph not found: {}",
                        region.node_id
                    ))
                })?;
            let replace = RichOperationEnvelope::new(
                format!("conflict-manual-{}-{stamp}-{index}", decision.region_id),
                document_id,
                "",
                report.remote_revision_id.as_str(),
                stamp.as_str(),
                "conflict-resolution",
                RichOperation::ReplaceRange {
                    paragraph_id,
                    utf16_start: melon_pan_core::Utf16Offset(0),
                    utf16_end: melon_pan_core::Utf16Offset(utf16_len(&region.remote_text)),
                    text: manual_text.to_string(),
                },
            );
            append_envelope(&store, document_id, &replace)
                .map_err(|error| SyncError::Other(format!("append manual op: {error}")))?;
        }
    }

    Ok(ConflictResolutionReport {
        canceled_operations: canceled,
        remaining_pending: has_pending(&store, document_id),
    })
}

/// Drain previously-queued pending mutations. With markdown push removed
/// there is no live producer of pending mutations, so this currently just
/// reports the on-disk count — kept as a stable API for the apps until
/// rich pending drains arrive with rich_batch.rs.
pub fn drain_pending(_access_token: &str, cache_root: &Path) -> Result<DrainReport, SyncError> {
    let store = LocalCacheStore::new(cache_root);
    store
        .initialize()
        .map_err(|error| SyncError::Other(format!("failed to initialize cache: {error}")))?;
    let cleared = list_pending_mutation_files(&store, "")
        .map(|files| files.len())
        .unwrap_or(0);
    Ok(DrainReport {
        cleared_pending: cleared,
        revision_after: String::new(),
    })
}

fn current_timestamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    secs.to_string()
}

fn read_revision_snapshot(
    store: &LocalCacheStore,
    document_id: &str,
    revision_id: &str,
) -> Result<String, SyncError> {
    let paths = store.paths_for(document_id);
    let direct = paths
        .snapshot_dir
        .join(format!("{}.docs.json", sanitize_path_segment(revision_id)));
    std::fs::read_to_string(&direct).map_err(|error| {
        SyncError::Other(format!(
            "read base revision snapshot {}: {error}",
            direct.display()
        ))
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ConflictDecision {
    region_id: String,
    decision: String,
    manual_text: Option<String>,
}

fn conflict_decisions(resolution_json: &str) -> Result<Vec<ConflictDecision>, SyncError> {
    let parsed = parse_json(resolution_json)
        .map_err(|error| SyncError::Other(format!("parse conflict resolution: {error:?}")))?;
    let mut decisions_out = Vec::new();
    let Some(decisions) = parsed.get("decisions").and_then(JsonValue::as_array) else {
        return Ok(decisions_out);
    };
    for decision in decisions {
        let region_id = decision
            .get("regionId")
            .and_then(JsonValue::as_str)
            .unwrap_or("");
        let side = decision
            .get("decision")
            .and_then(JsonValue::as_str)
            .unwrap_or("");
        if !region_id.is_empty() {
            decisions_out.push(ConflictDecision {
                region_id: region_id.to_string(),
                decision: side.to_string(),
                manual_text: decision
                    .get("manualText")
                    .and_then(JsonValue::as_str)
                    .map(str::to_string),
            });
        }
    }
    Ok(decisions_out)
}

fn region_operation_ids(report: &ConflictReport, region_id: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(region) = report
        .user_decision
        .iter()
        .find(|region| region.id == region_id)
    {
        out.extend(region.local_operation_ids.iter().cloned());
    }
    if let Some(region) = report
        .destructive
        .iter()
        .find(|region| region.id == region_id)
    {
        out.extend(region.local_operation_ids.iter().cloned());
    }
    out
}

fn find_paragraph_id_by_string(document: &RichDocument, node_id: &str) -> Option<RichNodeId> {
    for tab in &document.tabs {
        if let Some(id) = find_paragraph_id_in_tab(tab, node_id) {
            return Some(id);
        }
    }
    None
}

fn find_paragraph_id_in_tab(tab: &melon_pan_core::RichTab, node_id: &str) -> Option<RichNodeId> {
    if let Some(id) = find_paragraph_id_in_blocks(&tab.body.blocks, node_id) {
        return Some(id);
    }
    for child in &tab.child_tabs {
        if let Some(id) = find_paragraph_id_in_tab(child, node_id) {
            return Some(id);
        }
    }
    None
}

fn find_paragraph_id_in_blocks(blocks: &[RichBlock], node_id: &str) -> Option<RichNodeId> {
    for block in blocks {
        match block {
            RichBlock::Paragraph(paragraph) => {
                if paragraph.identity.local_id.as_str() == node_id {
                    return Some(paragraph.identity.local_id.clone());
                }
            }
            RichBlock::Table(table) => {
                for row in &table.rows {
                    for cell in &row.cells {
                        if let Some(id) = find_paragraph_id_in_blocks(&cell.content, node_id) {
                            return Some(id);
                        }
                    }
                }
            }
            RichBlock::SectionBreak(_) | RichBlock::Unsupported(_) => {}
        }
    }
    None
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TableTopology {
    rows: u32,
    columns: u32,
    merges: Vec<TableMerge>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TableMerge {
    row_index: u32,
    column_index: u32,
    row_span: u32,
    column_span: u32,
}

fn synthesize_table_topology_ops(
    table_id: &RichNodeId,
    remote_table: &RichTable,
    manual_text: &str,
) -> Result<Vec<RichOperation>, SyncError> {
    let target = parse_table_topology(manual_text)?;
    if target.rows == 0 || target.columns == 0 {
        return Err(SyncError::Other(
            "table topology must have at least one row and one column".to_string(),
        ));
    }
    let mut ops = Vec::new();
    let current_rows = remote_table.rows.len() as u32;
    let current_columns = remote_table.columns;

    for merge in current_table_merges(remote_table) {
        ops.push(RichOperation::UnmergeTableCells {
            table_id: table_id.clone(),
            row_index: merge.row_index,
            column_index: merge.column_index,
            row_span: merge.row_span,
            column_span: merge.column_span,
        });
    }

    for row in (target.rows..current_rows).rev() {
        ops.push(RichOperation::DeleteTableRow {
            table_id: table_id.clone(),
            row_index: row,
        });
    }
    if target.rows > current_rows {
        let mut anchor = current_rows.saturating_sub(1);
        for _ in current_rows..target.rows {
            ops.push(RichOperation::InsertTableRow {
                table_id: table_id.clone(),
                row_index: anchor,
                insert_below: true,
            });
            anchor = anchor.saturating_add(1);
        }
    }

    for column in (target.columns..current_columns).rev() {
        ops.push(RichOperation::DeleteTableColumn {
            table_id: table_id.clone(),
            column_index: column,
        });
    }
    if target.columns > current_columns {
        let mut anchor = current_columns.saturating_sub(1);
        for _ in current_columns..target.columns {
            ops.push(RichOperation::InsertTableColumn {
                table_id: table_id.clone(),
                column_index: anchor,
                insert_right: true,
            });
            anchor = anchor.saturating_add(1);
        }
    }

    for merge in target.merges {
        if merge.row_span > 1 || merge.column_span > 1 {
            if merge.row_span == 0 || merge.column_span == 0 {
                return Err(SyncError::Other(format!(
                    "merge {} {} {} {} must have non-zero span",
                    merge.row_index, merge.column_index, merge.row_span, merge.column_span
                )));
            }
            if merge.row_index + merge.row_span > target.rows
                || merge.column_index + merge.column_span > target.columns
            {
                return Err(SyncError::Other(format!(
                    "merge {} {} {} {} is outside target table {} x {}",
                    merge.row_index,
                    merge.column_index,
                    merge.row_span,
                    merge.column_span,
                    target.rows,
                    target.columns
                )));
            }
            ops.push(RichOperation::MergeTableCells {
                table_id: table_id.clone(),
                row_index: merge.row_index,
                column_index: merge.column_index,
                row_span: merge.row_span,
                column_span: merge.column_span,
            });
        }
    }

    Ok(ops)
}

fn parse_table_topology(raw: &str) -> Result<TableTopology, SyncError> {
    let normalized = raw.replace('|', "\n");
    let mut rows = None;
    let mut columns = None;
    let mut merges = Vec::new();

    for line in normalized.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with("row:") {
            continue;
        }
        if let Some((row_count, column_count)) = parse_rows_columns_line(line) {
            rows = Some(row_count);
            columns = Some(column_count);
            continue;
        }
        if line.starts_with("cell:") && line.contains("span:") {
            if let Some(merge) = parse_cell_span_line(line) {
                if merge.row_span > 1 || merge.column_span > 1 {
                    merges.push(merge);
                }
                continue;
            }
        }
        if let Some(rest) = line.strip_prefix("merge ") {
            let parts: Vec<_> = rest.split_whitespace().collect();
            if parts.len() == 4 {
                merges.push(TableMerge {
                    row_index: parse_u32(parts[0], "merge row")?,
                    column_index: parse_u32(parts[1], "merge column")?,
                    row_span: parse_u32(parts[2], "merge row span")?,
                    column_span: parse_u32(parts[3], "merge column span")?,
                });
                continue;
            }
        }
        return Err(SyncError::Other(format!(
            "unrecognized table topology line: {line}"
        )));
    }

    Ok(TableTopology {
        rows: rows.ok_or_else(|| SyncError::Other("table topology missing rows".to_string()))?,
        columns: columns
            .ok_or_else(|| SyncError::Other("table topology missing columns".to_string()))?,
        merges,
    })
}

fn parse_rows_columns_line(line: &str) -> Option<(u32, u32)> {
    let mut rows = None;
    let mut columns = None;
    for part in line.split_whitespace() {
        if let Some(value) = part.strip_prefix("rows:") {
            rows = value.parse().ok();
        } else if let Some(value) = part.strip_prefix("columns:") {
            columns = value.parse().ok();
        }
    }
    Some((rows?, columns?))
}

fn parse_cell_span_line(line: &str) -> Option<TableMerge> {
    let (cell_part, span_part) = line.split_once(" span:")?;
    let mut cell = cell_part.strip_prefix("cell:")?.split(':');
    let row_index = cell.next()?.parse().ok()?;
    let column_index = cell.next()?.parse().ok()?;
    let (row_span, column_span) = span_part.split_once('x')?;
    Some(TableMerge {
        row_index,
        column_index,
        row_span: row_span.parse().ok()?,
        column_span: column_span.parse().ok()?,
    })
}

fn parse_u32(value: &str, label: &str) -> Result<u32, SyncError> {
    value
        .parse::<u32>()
        .map_err(|_| SyncError::Other(format!("invalid {label}: {value}")))
}

fn current_table_merges(table: &RichTable) -> Vec<TableMerge> {
    let mut merges = Vec::new();
    for (row_index, row) in table.rows.iter().enumerate() {
        for (column_index, cell) in row.cells.iter().enumerate() {
            if cell.row_span > 1 || cell.column_span > 1 {
                merges.push(TableMerge {
                    row_index: row_index as u32,
                    column_index: column_index as u32,
                    row_span: cell.row_span,
                    column_span: cell.column_span,
                });
            }
        }
    }
    merges
}

fn find_table_by_string<'a>(document: &'a RichDocument, table_id: &str) -> Option<&'a RichTable> {
    for tab in &document.tabs {
        if let Some(table) = find_table_in_tab(tab, table_id) {
            return Some(table);
        }
    }
    None
}

fn find_table_in_tab<'a>(
    tab: &'a melon_pan_core::RichTab,
    table_id: &str,
) -> Option<&'a RichTable> {
    if let Some(table) = find_table_in_blocks(&tab.body.blocks, table_id) {
        return Some(table);
    }
    for child in &tab.child_tabs {
        if let Some(table) = find_table_in_tab(child, table_id) {
            return Some(table);
        }
    }
    None
}

fn find_table_in_blocks<'a>(blocks: &'a [RichBlock], table_id: &str) -> Option<&'a RichTable> {
    for block in blocks {
        match block {
            RichBlock::Table(table) => {
                if table.identity.local_id.as_str() == table_id {
                    return Some(table);
                }
                for row in &table.rows {
                    for cell in &row.cells {
                        if let Some(table) = find_table_in_blocks(&cell.content, table_id) {
                            return Some(table);
                        }
                    }
                }
            }
            RichBlock::Paragraph(_) | RichBlock::SectionBreak(_) | RichBlock::Unsupported(_) => {}
        }
    }
    None
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

#[cfg(test)]
mod tests {
    use super::*;
    use melon_pan_core::{
        apply_operation, RichNodeIdentity, RichRawJson, RichSegment, RichSourceKind, RichTab,
        RichTableCell, RichTableRow,
    };
    use std::collections::BTreeMap;

    fn identity(id: RichNodeId, source_kind: RichSourceKind) -> RichNodeIdentity {
        RichNodeIdentity::local_only(id, source_kind)
    }

    fn synthetic_identity(seed: &str, source_kind: RichSourceKind) -> RichNodeIdentity {
        identity(RichNodeId::synthetic(seed.to_string()), source_kind)
    }

    fn test_table(table_id: RichNodeId) -> RichTable {
        RichTable {
            identity: identity(table_id.clone(), RichSourceKind::Body),
            start_index: 1,
            columns: 2,
            rows: vec![
                RichTableRow {
                    identity: synthetic_identity("row-0", RichSourceKind::TableCell),
                    raw_style: RichRawJson::empty(),
                    cells: vec![
                        RichTableCell {
                            identity: synthetic_identity("cell-0-0", RichSourceKind::TableCell),
                            content: Vec::new(),
                            row_span: 1,
                            column_span: 2,
                            raw_style: RichRawJson::empty(),
                        },
                        RichTableCell {
                            identity: synthetic_identity("cell-0-1", RichSourceKind::TableCell),
                            content: Vec::new(),
                            row_span: 1,
                            column_span: 1,
                            raw_style: RichRawJson::empty(),
                        },
                    ],
                },
                RichTableRow {
                    identity: synthetic_identity("row-1", RichSourceKind::TableCell),
                    raw_style: RichRawJson::empty(),
                    cells: vec![
                        RichTableCell {
                            identity: synthetic_identity("cell-1-0", RichSourceKind::TableCell),
                            content: Vec::new(),
                            row_span: 1,
                            column_span: 1,
                            raw_style: RichRawJson::empty(),
                        },
                        RichTableCell {
                            identity: synthetic_identity("cell-1-1", RichSourceKind::TableCell),
                            content: Vec::new(),
                            row_span: 1,
                            column_span: 1,
                            raw_style: RichRawJson::empty(),
                        },
                    ],
                },
            ],
            raw_style: RichRawJson::empty(),
        }
    }

    fn document_with_table(table: RichTable) -> RichDocument {
        let mut doc = RichDocument::skeleton("doc-1", "Doc");
        doc.tabs.push(RichTab {
            identity: synthetic_identity("tab", RichSourceKind::Tab),
            tab_id: String::new(),
            title: String::new(),
            index: 0,
            parent_tab_id: None,
            body: RichSegment {
                identity: synthetic_identity("body", RichSourceKind::Body),
                segment_id: String::new(),
                kind: RichSourceKind::Body,
                blocks: vec![RichBlock::Table(table)],
                style: RichRawJson::empty(),
            },
            headers: BTreeMap::new(),
            footers: BTreeMap::new(),
            footnotes: BTreeMap::new(),
            child_tabs: Vec::new(),
        });
        doc
    }

    #[test]
    fn parses_table_shape_signature_with_row_summaries() {
        let parsed = parse_table_topology(
            "rows:2 columns:3|row:0 cells:3|cell:0:0 span:1x2|cell:0:1 span:1x1",
        )
        .expect("parse topology");

        assert_eq!(parsed.rows, 2);
        assert_eq!(parsed.columns, 3);
        assert_eq!(
            parsed.merges,
            vec![TableMerge {
                row_index: 0,
                column_index: 0,
                row_span: 1,
                column_span: 2,
            }]
        );
    }

    #[test]
    fn synthesizes_table_topology_ops_with_real_table_id() {
        let table_id = RichNodeId::Stable("stable-table".to_string());
        let table = test_table(table_id.clone());
        let ops =
            synthesize_table_topology_ops(&table.identity.local_id, &table, "rows:3 columns:1")
                .expect("synthesize ops");

        assert_eq!(
            ops,
            vec![
                RichOperation::UnmergeTableCells {
                    table_id: table_id.clone(),
                    row_index: 0,
                    column_index: 0,
                    row_span: 1,
                    column_span: 2,
                },
                RichOperation::InsertTableRow {
                    table_id: table_id.clone(),
                    row_index: 1,
                    insert_below: true,
                },
                RichOperation::DeleteTableColumn {
                    table_id: table_id.clone(),
                    column_index: 1,
                },
            ]
        );

        let mut doc = document_with_table(table);
        for op in &ops {
            apply_operation(&mut doc, op).expect("apply synthesized op");
        }
        let rewritten = find_table_by_string(&doc, table_id.as_str()).expect("rewritten table");
        assert_eq!(rewritten.rows.len(), 3);
        assert_eq!(rewritten.columns, 1);
        assert_eq!(rewritten.rows[0].cells[0].column_span, 1);
    }
}
