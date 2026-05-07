//! Core domain primitives for Melon Pan.
//!
//! This crate intentionally has no UI, network, OAuth, or platform-secret code.
//! Platform apps own those layers and call into this crate for the canonical
//! rich-document model and the byte-compatible cache layout.
//!
//! Markdown was removed from the core in the rich-docs-only cut. Any future
//! Markdown export/import will live in a separate explicit-feature module.

pub mod auth;
pub mod drive;
pub mod drive_comments;
pub mod drive_json;
pub mod encoding;
pub mod fidelity;
pub mod google_docs;
pub mod json;
pub mod oauth_loopback;
pub mod pending;
pub mod rich_apply;
pub mod rich_batch;
pub mod rich_conflict;
pub mod rich_index;
pub mod rich_model;
pub mod rich_oplog;
pub mod rich_ops;
pub mod rich_parse;
pub mod rich_serde;
pub mod rich_validate;
pub mod sha256;
pub mod storage;
pub mod sync;

pub use auth::{
    build_authorization_request, build_refresh_token_body, build_token_exchange_body,
    default_scopes, narrow_scopes, parse_installed_app_credentials, parse_token_response,
    parse_userinfo_response, pkce_challenge_s256, AuthError, AuthorizationRequest,
    InstalledAppCredentials, OAuthConfig, StoredTokenSet, TokenResponse, UserInfo, GOOGLE_AUTH_URL,
    GOOGLE_TOKEN_URL, GOOGLE_USERINFO_URL, SCOPE_DOCUMENTS, SCOPE_DRIVE_FILE, SCOPE_DRIVE_READONLY,
    SCOPE_OPENID, SCOPE_USERINFO_EMAIL,
};
pub use drive::{
    build_drive_delete_request, build_drive_list_request, build_drive_move_request,
    build_drive_query, build_drive_rename_request, build_drive_trash_request,
    build_drive_untrash_request, drive_tree_cache_json, extract_drive_doc_id, DriveDeleteRequest,
    DriveItem, DrivePatchRequest,
};
pub use drive_comments::{
    build_drive_comments_list_request, drive_comments_sidecar_json, parse_drive_comments_json,
    DriveCommentsJsonError, DriveCommentsListRequest, ParsedDriveComments,
};
pub use drive_json::{parse_drive_list_json, DriveJsonError, ParsedDriveList};
pub use fidelity::{FidelityReport, FidelityWarning, WarningKind};
pub use google_docs::{
    build_docs_create_request, build_docs_get_legacy_request, build_docs_get_request,
    DocsCreateRequest, DocsGetRequest,
};
pub use json::{parse_json, JsonError, JsonValue};
pub use oauth_loopback::{
    bind_loopback_server, bind_loopback_server_on, parse_callback_request, wait_for_oauth_callback,
    LoopbackServer, OAuthCallback, OAuthCallbackError,
};
pub use pending::{
    enqueue_pending_mutation, list_pending_mutation_files, mark_pending_mutation_failed,
    PendingMutation,
};
pub use rich_apply::apply_operation;
pub use rich_batch::{compile_batch, BatchCompileError, BatchUpdateRequest};
pub use rich_conflict::{
    classify_conflict, ConflictReport, DestructiveConflict, ResolvedRegion, UnresolvedConflict,
};
pub use rich_index::{
    byte_to_utf16, snap_utf16_to_boundary, utf16_len, utf16_to_byte, ByteOffset, IndexError,
    NsRangeLike, SnapDirection, Utf16Offset, Utf16Range,
};
pub use rich_model::{
    RichAlignment, RichAnchor, RichBaselineOffset, RichBlock, RichColor, RichComment,
    RichCommentAuthor, RichCommentQuotedFileContent, RichCommentReply, RichDocument, RichEquation,
    RichFootnoteRef, RichInline, RichInlineMarker, RichInlineObject, RichInlineObjectKind,
    RichInlineObjectRef, RichList, RichListAnchor, RichListGlyph, RichListLevel, RichNamedRange,
    RichNamedStyle, RichNodeId, RichNodeIdentity, RichParagraph, RichParagraphStyle,
    RichPersonChip, RichPosition, RichRange, RichRawJson, RichRevision, RichRichLinkChip,
    RichSectionBreak, RichSegment, RichSelection, RichSourceKind, RichStyle, RichSuggestion,
    RichSuggestionKind, RichTab, RichTable, RichTableCell, RichTableRow, RichTextRun,
    RichUnsupported, RICH_SCHEMA_VERSION,
};
pub use rich_oplog::{
    append_envelope, archive_log, clear_log, effective_envelopes, has_pending, parse_envelope_json,
    read_envelopes, OplogError,
};
pub use rich_ops::{
    OperationError, RichNamedStyleDelta, RichOperation, RichOperationEnvelope,
    RichParagraphStyleDelta, RichStyleDelta, RichTableBorderDashStyle,
    RichTableCellContentAlignment, RichTableCellStyleDelta,
};
pub use rich_parse::{parse_rich_document, RichParseError};
pub use rich_serde::serialize_rich_document_for_swift;
pub use rich_validate::{validate, OperationOutcome, ValidationReport};
pub use sha256::{sha256, stable_content_hash};
pub use storage::{
    AuditComputeError, CachePaths, CachedDocsState, CachedDocsStateError, LocalCacheStore,
    MetadataError, MetadataRecord, PerDocSettings, PRE_PUSH_MAX_ENTRIES, TRASH_MAX_ENTRIES,
};
pub use sync::{docs_to_plain_text, persist_pulled_document, PersistedPull, PulledDocument};
