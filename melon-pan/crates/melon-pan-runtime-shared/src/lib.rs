//! Runtime helpers used by the macOS app.
//!
//! This crate keeps sync, OAuth, history, template, and update-check logic
//! independent from SwiftUI/AppKit. macOS-specific secrets, paths, and
//! browser launch behavior live in `melon-pan-mac-runtime`.

pub mod drive_ops;
pub mod oauth_flow;
pub mod open_history;
pub mod sync_journal;
pub mod sync_ops;
pub mod templates;
pub mod token_store;
pub mod updater;

pub use drive_ops::DriveOpError;
pub use oauth_flow::{
    begin_login, begin_login_on_port, complete_login, ensure_fresh_access_token, load_stored,
    refresh_stored_token, resolve_account_name, run_login, BrowserLauncher, LoginInProgress,
    LoginOutcome, OAuthClientCredentials, OAuthFlowError,
};
pub use open_history::{history_path, load_history, record_open, MAX_ENTRIES};
pub use sync_journal::{
    append_event, clear_events, journal_path, read_recent_events, SyncEvent, SyncEventKind,
};
pub use sync_ops::{
    append_operation, classify_cached_conflict, drain_pending, pull_document, push_document,
    refresh_document_comments, refresh_drive_tree, resolve_cached_conflict, CommentRefreshReport,
    ConflictResolutionReport, DrainReport, PullReport, PushOutcome, PushReport, SyncError,
};
pub use templates::{
    expand_with_local_now, list_templates_json, load_template_json, save_template_json,
};
pub use token_store::{InMemoryTokenStore, TokenStore};
pub use updater::{check_for_updates, UpdateStatus, UpdaterError, DEFAULT_REPO};
