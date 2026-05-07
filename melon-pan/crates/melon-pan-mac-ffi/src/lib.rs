//! C ABI surface for the macOS Swift shell.
//!
//! Goals:
//! - Stable, narrow function set the Swift side imports through a
//!   bridging header. Swift's `Unsafe(Mutable)Pointer<CChar>` maps
//!   onto our `*const c_char` / `*mut c_char` directly.
//! - String passing via UTF-8 C strings. Swift converts to/from
//!   `String` with `String(cString:)` and `<str>.withCString(_:)`.
//! - Heap-allocated return strings are owned by the FFI; the caller
//!   must release them via `melon_pan_string_free`. Pattern matches
//!   what uniffi-rs would generate but stays dep-free.
//! - JSON for compound returns (PullReport, PushOutcome, ...). Swift
//!   already has Codable so this is the natural shape; the FFI hands
//!   over raw JSON, Swift decodes to a typed struct on the other side.
//! - Errors as null pointers + a separate `melon_pan_last_error()`
//!   thread-local, matching standard C-FFI conventions.
//!
//! ## Lifetime contract
//!
//! Every `*mut c_char` returned by this crate is heap-allocated by
//! Rust and must be passed back to `melon_pan_string_free` exactly
//! once. Failing to free leaks memory; freeing twice or freeing a
//! pointer that didn't come from this FFI is undefined behaviour.
//! Swift wraps this in a `defer { melon_pan_string_free(ptr) }`
//! pattern — see `apps/macos/melon-pan-mac/Bridge/RuntimeBridge.swift`.

use melon_pan_core::{parse_rich_document, LocalCacheStore};
use melon_pan_mac_runtime::{
    clear_cached_drive_data, default_cache_root, default_credentials_path, diagnostic_snapshot,
    force_full_resync, keychain_probe, launch_browser_via_nsworkspace, load_oauth_client_config,
    runtime_versions, save_oauth_client_config, token_metadata, MacTokenStore,
};
use melon_pan_runtime_shared::{
    append_event, check_for_updates, classify_cached_conflict, clear_events, drain_pending,
    oauth_flow, open_history, pull_document, push_document, read_recent_events,
    refresh_document_comments, refresh_drive_tree, resolve_cached_conflict, templates, SyncEvent,
    SyncEventKind, TokenStore, DEFAULT_REPO,
};
use std::cell::RefCell;
use std::ffi::{c_char, CStr, CString};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

thread_local! {
    /// Last error message set by an FFI entry point. Read via
    /// `melon_pan_last_error()`; cleared by reading.
    static LAST_ERROR: RefCell<Option<CString>> = const { RefCell::new(None) };
}

type SyncErrorCallback = extern "C" fn(*const c_char, *const c_char);

static SYNC_ERROR_CALLBACK: Mutex<Option<SyncErrorCallback>> = Mutex::new(None);

fn set_last_error(message: impl Into<String>) {
    let cstring = CString::new(message.into())
        .unwrap_or_else(|_| CString::new("error message contained interior nul").unwrap());
    LAST_ERROR.with(|cell| *cell.borrow_mut() = Some(cstring));
}

fn clear_last_error() {
    LAST_ERROR.with(|cell| cell.borrow_mut().take());
}

/// Returns the most recent FFI error message as a heap-allocated
/// C string, or null when no error is set. The caller must free the
/// returned pointer with `melon_pan_string_free`.
///
/// # Safety
/// No inputs; the returned pointer is owned by the caller.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_last_error() -> *mut c_char {
    LAST_ERROR.with(|cell| {
        cell.borrow()
            .as_ref()
            .map(|cstr| cstr.clone().into_raw())
            .unwrap_or(std::ptr::null_mut())
    })
}

/// Frees a `*mut c_char` previously returned by an FFI entry point.
///
/// # Safety
/// `ptr` must have been returned by this FFI and not previously freed.
/// Passing null is a no-op.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_string_free(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    let _ = CString::from_raw(ptr);
}

/// Installs a process-wide sync-error callback used by the Swift shell
/// to mirror sync failures into the in-app status banner stack.
///
/// # Safety
/// `callback` must remain valid for the process lifetime. Passing NULL
/// clears the callback.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_set_sync_error_callback(callback: Option<SyncErrorCallback>) {
    if let Ok(mut slot) = SYNC_ERROR_CALLBACK.lock() {
        *slot = callback;
    }
}

/// Returns a heap-allocated C string with the macOS default cache
/// root (e.g. `/Users/alice/Library/Caches/MelonPan`). Caller frees.
///
/// # Safety
/// No inputs; the returned pointer is owned by the caller and must be
/// released with `melon_pan_string_free`.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_default_cache_root() -> *mut c_char {
    string_to_c(default_cache_root().to_string_lossy().into_owned())
}

/// Returns a heap-allocated C string with the macOS default
/// credentials.json path. Caller frees.
///
/// # Safety
/// No inputs; the returned pointer is owned by the caller and must be
/// released with `melon_pan_string_free`.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_default_credentials_path() -> *mut c_char {
    string_to_c(default_credentials_path().to_string_lossy().into_owned())
}

/// Initialises the on-disk cache layout at `cache_root_utf8`.
/// Returns 1 on success, 0 on failure (consult `melon_pan_last_error`).
///
/// # Safety
/// `cache_root_utf8` must be a null-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_init_cache(cache_root_utf8: *const c_char) -> i32 {
    clear_last_error();
    let Some(root) = c_str_to_path(cache_root_utf8) else {
        set_last_error("cache_root pointer was null or invalid UTF-8");
        return 0;
    };
    let store = LocalCacheStore::new(&root);
    match store.initialize() {
        Ok(()) => 1,
        Err(error) => {
            set_last_error(format!("cache init failed: {error}"));
            0
        }
    }
}

/// Returns the raw contents of `<cache_root>/settings.json`, or the
/// default settings JSON when the file is missing.
///
/// # Safety
/// `cache_root_utf8` must be a null-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_load_settings(cache_root_utf8: *const c_char) -> *mut c_char {
    clear_last_error();
    let Some(cache_root) = c_str_to_path(cache_root_utf8) else {
        set_last_error("cache_root pointer was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    let path = cache_root.join("settings.json");
    match fs::read_to_string(&path) {
        Ok(raw) => string_to_c(raw),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            string_to_c(default_settings_json())
        }
        Err(error) => {
            set_last_error(format!("load_settings failed: {error}"));
            std::ptr::null_mut()
        }
    }
}

/// Atomically writes `settings_json_utf8` to `<cache_root>/settings.json`.
///
/// # Safety
/// Both arguments must be null-terminated UTF-8 strings.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_save_settings(
    cache_root_utf8: *const c_char,
    settings_json_utf8: *const c_char,
) -> i32 {
    clear_last_error();
    let (Some(cache_root), Some(settings_json)) = (
        c_str_to_path(cache_root_utf8),
        c_str_to_str(settings_json_utf8),
    ) else {
        set_last_error("cache_root or settings_json was null or invalid UTF-8");
        return 0;
    };
    let path = cache_root.join("settings.json");
    let tmp = cache_root.join("settings.json.tmp");
    match fs::create_dir_all(&cache_root)
        .and_then(|()| fs::write(&tmp, settings_json))
        .and_then(|()| fs::rename(&tmp, &path))
    {
        Ok(()) => 1,
        Err(error) => {
            let _ = fs::remove_file(&tmp);
            set_last_error(format!("save_settings failed: {error}"));
            0
        }
    }
}

/// MELON_PAN_SETTINGS_STUB: cache encryption has no Rust core backend yet.
/// This validates the FFI plumbing and returns success without rewriting data.
///
/// # Safety
/// All arguments must be null-terminated UTF-8 strings.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_rekey_cache(
    cache_root_utf8: *const c_char,
    old_pass_utf8: *const c_char,
    new_pass_utf8: *const c_char,
) -> i32 {
    clear_last_error();
    let (Some(_cache_root), Some(_old_pass), Some(_new_pass)) = (
        c_str_to_path(cache_root_utf8),
        c_str_to_str(old_pass_utf8),
        c_str_to_str(new_pass_utf8),
    ) else {
        set_last_error("one or more arguments were null or invalid UTF-8");
        return 0;
    };
    1
}

/// Clears one Keychain account entry.
/// MELON_PAN_SETTINGS_STUB: macOS active account state is currently
/// onboarding.json-owned on the Swift side, not active_account.json.
///
/// # Safety
/// `account_utf8` must be a null-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_clear_account(account_utf8: *const c_char) -> i32 {
    clear_last_error();
    let Some(account) = c_str_to_str(account_utf8) else {
        set_last_error("account pointer was null or invalid UTF-8");
        return 0;
    };
    match mac_token_store().clear(account) {
        Ok(()) => 1,
        Err(error) => {
            set_last_error(format!("clear_account failed: {error}"));
            0
        }
    }
}

/// Pulls a document via the shared runtime's `pull_document`.
/// Returns the JSON-encoded `PullReport` on success or null on error
/// (caller frees the returned pointer; on error consult
/// `melon_pan_last_error`).
///
/// # Safety
/// All `*const c_char` parameters must be null-terminated UTF-8.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_pull_document(
    access_token_utf8: *const c_char,
    document_id_utf8: *const c_char,
    cache_root_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let (Some(access_token), Some(document_id), Some(cache_root)) = (
        c_str_to_str(access_token_utf8),
        c_str_to_str(document_id_utf8),
        c_str_to_path(cache_root_utf8),
    ) else {
        set_last_error("one or more arguments were null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    match pull_document(access_token, document_id, &cache_root) {
        Ok(report) => string_to_c(serialize_pull_report(&report)),
        Err(error) => {
            let message = format!("pull_document failed: {error}");
            notify_sync_error(document_id, &message);
            set_last_error(message);
            std::ptr::null_mut()
        }
    }
}

/// Refreshes `<cache>/docs/<id>/comments.json` from Drive v3
/// comments.list. Returns JSON-encoded CommentRefreshReport on success.
///
/// # Safety
/// All `*const c_char` parameters must be null-terminated UTF-8.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_refresh_comments(
    access_token_utf8: *const c_char,
    document_id_utf8: *const c_char,
    cache_root_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let (Some(access_token), Some(document_id), Some(cache_root)) = (
        c_str_to_str(access_token_utf8),
        c_str_to_str(document_id_utf8),
        c_str_to_path(cache_root_utf8),
    ) else {
        set_last_error("one or more arguments were null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    match refresh_document_comments(access_token, document_id, &cache_root) {
        Ok(report) => string_to_c(serialize_comment_refresh_report(&report)),
        Err(error) => {
            let message = format!("refresh_comments failed: {error}");
            notify_sync_error(document_id, &message);
            set_last_error(message);
            std::ptr::null_mut()
        }
    }
}

/// Reads cached `<cache>/docs/<id>/comments.json`. Returns an empty comment
/// bundle when the sidecar does not exist yet.
///
/// # Safety
/// Both arguments must be null-terminated UTF-8 strings.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_load_comments(
    cache_root_utf8: *const c_char,
    document_id_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let (Some(cache_root), Some(document_id)) = (
        c_str_to_path(cache_root_utf8),
        c_str_to_str(document_id_utf8),
    ) else {
        set_last_error("cache_root or document_id was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    let store = LocalCacheStore::new(&cache_root);
    match store.read_comments_sidecar(document_id) {
        Some(raw) => string_to_c(raw),
        None => string_to_c(format!(
            "{{\"documentId\":\"{}\",\"fetchedAt\":null,\"comments\":[]}}\n",
            json_escape(document_id)
        )),
    }
}

/// Pushes the cached `current.md` for `document_id` via the shared
/// runtime's `push_document`. Returns the JSON-encoded `PushReport`
/// on success or null on error.
///
/// # Safety
/// As above.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_push_document(
    access_token_utf8: *const c_char,
    document_id_utf8: *const c_char,
    cache_root_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let (Some(access_token), Some(document_id), Some(cache_root)) = (
        c_str_to_str(access_token_utf8),
        c_str_to_str(document_id_utf8),
        c_str_to_path(cache_root_utf8),
    ) else {
        set_last_error("one or more arguments were null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    match push_document(access_token, document_id, &cache_root) {
        Ok(report) => string_to_c(serialize_push_report(&report)),
        Err(error) => {
            // Tag revision conflicts with a sentinel prefix so Swift
            // can detect them without parsing free-form messages. The
            // Mac shell shows a recovery banner instead of a generic
            // "save failed" toast.
            let message = match &error {
                melon_pan_runtime_shared::SyncError::RevisionRejected { .. } => {
                    format!("REVISION_REJECTED: {error}")
                }
                _ => format!("push_document failed: {error}"),
            };
            notify_sync_error(document_id, &message);
            set_last_error(message);
            std::ptr::null_mut()
        }
    }
}

/// Overwrites `current.md` for `document_id` with `markdown_utf8`.
/// Used by editor-save flows: the WKWebView pushes its buffer into
/// the cache, then the caller invokes `melon_pan_push_document` to
/// send the latest text to Docs.
///
/// Returns 1 on success, 0 on failure.
///
/// # Safety
/// All `*const c_char` parameters must be null-terminated UTF-8.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_write_current_markdown(
    cache_root_utf8: *const c_char,
    document_id_utf8: *const c_char,
    markdown_utf8: *const c_char,
) -> i32 {
    clear_last_error();
    let (Some(cache_root), Some(document_id), Some(markdown)) = (
        c_str_to_path(cache_root_utf8),
        c_str_to_str(document_id_utf8),
        c_str_to_str(markdown_utf8),
    ) else {
        set_last_error("one or more arguments were null or invalid UTF-8");
        return 0;
    };
    let store = LocalCacheStore::new(&cache_root);
    match store.overwrite_current_markdown(document_id, markdown) {
        Ok(()) => 1,
        Err(error) => {
            set_last_error(format!("write_current_markdown failed: {error}"));
            0
        }
    }
}

/// Drains the pending-mutations queue for `document_id`.
/// Returns JSON-encoded `DrainReport` or null on error.
///
/// # Safety
/// As above.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_drain_pending(
    access_token_utf8: *const c_char,
    document_id_utf8: *const c_char,
    cache_root_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let (Some(access_token), Some(document_id), Some(cache_root)) = (
        c_str_to_str(access_token_utf8),
        c_str_to_str(document_id_utf8),
        c_str_to_path(cache_root_utf8),
    ) else {
        set_last_error("one or more arguments were null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    match drain_pending(access_token, &cache_root) {
        Ok(report) => string_to_c(format!(
            "{{\"clearedPending\":{},\"revisionAfter\":\"{}\"}}",
            report.cleared_pending,
            json_escape(&report.revision_after)
        )),
        Err(error) => {
            let message = format!("drain_pending failed: {error}");
            notify_sync_error(document_id, &message);
            set_last_error(message);
            std::ptr::null_mut()
        }
    }
}

/// Imports one Markdown file into the local cache and optionally pushes it.
///
/// # Safety
/// Required string parameters must be null-terminated UTF-8;
/// `access_token_utf8` may be null.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_import_markdown_file(
    _cache_root_utf8: *const c_char,
    _source_path_utf8: *const c_char,
    _target_draft_id_utf8: *const c_char,
    _options_json_utf8: *const c_char,
    _access_token_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    set_last_error(
        "Markdown export/import has been removed; rich operation push is not yet implemented.",
    );
    std::ptr::null_mut()
}

/// Imports Markdown files found under a directory.
///
/// # Safety
/// Required string parameters must be null-terminated UTF-8;
/// `access_token_utf8` may be null.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_import_markdown_dir(
    _cache_root_utf8: *const c_char,
    _dir_utf8: *const c_char,
    _recursive: i32,
    _options_json_utf8: *const c_char,
    _access_token_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    set_last_error(
        "Markdown export/import has been removed; rich operation push is not yet implemented.",
    );
    std::ptr::null_mut()
}

/// Lists local Markdown templates under `<cache_root>/templates`.
///
/// # Safety
/// `cache_root_utf8` must be a null-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_templates_list(cache_root_utf8: *const c_char) -> *mut c_char {
    clear_last_error();
    let Some(cache_root) = c_str_to_path(cache_root_utf8) else {
        set_last_error("cache_root pointer was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    match templates::list_templates_json(&cache_root) {
        Ok(json) => string_to_c(json),
        Err(error) => {
            set_last_error(format!("templates_list failed: {error}"));
            std::ptr::null_mut()
        }
    }
}

/// Saves one local Markdown template JSON payload.
///
/// # Safety
/// Both arguments must be null-terminated UTF-8 strings.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_template_save(
    cache_root_utf8: *const c_char,
    json_template_utf8: *const c_char,
) -> i32 {
    clear_last_error();
    let (Some(cache_root), Some(json_template)) = (
        c_str_to_path(cache_root_utf8),
        c_str_to_str(json_template_utf8),
    ) else {
        set_last_error("cache_root or json_template was null or invalid UTF-8");
        return 0;
    };
    match templates::save_template_json(&cache_root, json_template) {
        Ok(()) => 1,
        Err(error) => {
            set_last_error(format!("template_save failed: {error}"));
            0
        }
    }
}

/// Deletes one local Markdown template by id.
///
/// # Safety
/// Both arguments must be null-terminated UTF-8 strings.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_template_delete(
    cache_root_utf8: *const c_char,
    id_utf8: *const c_char,
) -> i32 {
    clear_last_error();
    let (Some(cache_root), Some(id)) = (c_str_to_path(cache_root_utf8), c_str_to_str(id_utf8))
    else {
        set_last_error("cache_root or id was null or invalid UTF-8");
        return 0;
    };
    match templates::delete_template(&cache_root, id) {
        Ok(()) => 1,
        Err(error) => {
            set_last_error(format!("template_delete failed: {error}"));
            0
        }
    }
}

/// Loads one local Markdown template by id.
///
/// # Safety
/// Both arguments must be null-terminated UTF-8 strings.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_template_load(
    cache_root_utf8: *const c_char,
    id_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let (Some(cache_root), Some(id)) = (c_str_to_path(cache_root_utf8), c_str_to_str(id_utf8))
    else {
        set_last_error("cache_root or id was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    match templates::load_template_json(&cache_root, id) {
        Ok(json) => string_to_c(json),
        Err(error) => {
            set_last_error(format!("template_load failed: {error}"));
            std::ptr::null_mut()
        }
    }
}

/// Expands supported Markdown template variables.
///
/// # Safety
/// All arguments must be null-terminated UTF-8 strings.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_template_expand(
    body_utf8: *const c_char,
    title_utf8: *const c_char,
    author_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let (Some(body), Some(title), Some(author)) = (
        c_str_to_str(body_utf8),
        c_str_to_str(title_utf8),
        c_str_to_str(author_utf8),
    ) else {
        set_last_error("body, title, or author was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    string_to_c(templates::expand_with_local_now(body, title, author))
}

/// Returns JSON for cached documents whose current.md and current.docs.json
/// projections are drifting:
///
/// [{"documentId":"...","title":"..."}]
///
/// Caller frees the returned pointer.
///
/// # Safety
/// `cache_root_utf8` must be a null-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_audit_drift_check(
    _cache_root_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    set_last_error("audit unsupported in rich mode");
    std::ptr::null_mut()
}

/// Refreshes the cached drive-tree.json for the active account.
/// `parent_id_utf8` may be null to list under the user's root.
/// Returns the count of items as i64 (-1 on error).
///
/// # Safety
/// `access_token_utf8` and `cache_root_utf8` must be valid UTF-8;
/// `parent_id_utf8` may be null.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_refresh_drive_tree(
    access_token_utf8: *const c_char,
    parent_id_utf8: *const c_char,
    cache_root_utf8: *const c_char,
) -> i64 {
    clear_last_error();
    let (Some(access_token), Some(cache_root)) = (
        c_str_to_str(access_token_utf8),
        c_str_to_path(cache_root_utf8),
    ) else {
        set_last_error("required arguments were null or invalid UTF-8");
        return -1;
    };
    let parent = c_str_to_str(parent_id_utf8);
    match refresh_drive_tree(access_token, parent, &cache_root) {
        Ok(count) => count as i64,
        Err(error) => {
            set_last_error(format!("refresh_drive_tree failed: {error}"));
            -1
        }
    }
}

/// Resolves a fresh access token for `account` via Keychain +
/// shared OAuth refresh. Returns the access-token string on
/// success or null on error.
///
/// # Safety
/// As above.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_ensure_fresh_access_token(
    credentials_path_utf8: *const c_char,
    account_utf8: *const c_char,
    leeway_seconds: u64,
) -> *mut c_char {
    clear_last_error();
    let (Some(credentials_path), Some(account)) = (
        c_str_to_path(credentials_path_utf8),
        c_str_to_str(account_utf8),
    ) else {
        set_last_error("credentials_path or account was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    let store = mac_token_store();
    match oauth_flow::ensure_fresh_access_token(store, &credentials_path, account, leeway_seconds) {
        Ok(stored) => string_to_c(stored.access_token),
        Err(error) => {
            set_last_error(format!("ensure_fresh_access_token failed: {error}"));
            std::ptr::null_mut()
        }
    }
}

/// Persists the downloaded-DMG Desktop OAuth client in Keychain.
/// `client_secret_utf8` may be NULL or empty; the secret is never
/// written to credentials.json by this surface.
///
/// # Safety
/// `client_id_utf8` must be null-terminated UTF-8;
/// `client_secret_utf8` may be null.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_save_oauth_client_config(
    client_id_utf8: *const c_char,
    client_secret_utf8: *const c_char,
) -> i32 {
    clear_last_error();
    let Some(client_id) = c_str_to_str(client_id_utf8) else {
        set_last_error("client_id pointer was null or invalid UTF-8");
        return 0;
    };
    let client_secret = c_str_to_str(client_secret_utf8).filter(|value| !value.is_empty());
    match save_oauth_client_config(client_id, client_secret) {
        Ok(()) => 1,
        Err(error) => {
            set_last_error(format!("save_oauth_client_config failed: {error}"));
            0
        }
    }
}

/// Runs OAuth login using the OAuth client saved in Keychain by
/// `melon_pan_save_oauth_client_config`.
///
/// # Safety
/// `account_override_utf8` may be null.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_run_login_with_saved_oauth_client(
    account_override_utf8: *const c_char,
    narrow_scope: i32,
    port: u16,
) -> *mut c_char {
    clear_last_error();
    let account_override = c_str_to_str(account_override_utf8).filter(|s| !s.is_empty());
    let client = match load_oauth_client_config() {
        Ok(client) => client.as_credentials(),
        Err(error) => {
            set_last_error(format!("load_oauth_client_config failed: {error}"));
            return std::ptr::null_mut();
        }
    };
    let pending =
        match oauth_flow::begin_login_with_client_on_port(&client, narrow_scope != 0, port) {
            Ok(p) => p,
            Err(error) => {
                set_last_error(format!("begin_login failed: {error}"));
                return std::ptr::null_mut();
            }
        };

    let auth_url = pending.auth_url.clone();
    if let Err(error) = launch_browser_via_nsworkspace(&auth_url) {
        eprintln!("melon_pan_run_login_with_saved_oauth_client: launch_browser failed: {error}");
    }

    match oauth_flow::complete_login(mac_token_store(), pending, account_override) {
        Ok(outcome) => string_to_c(serialize_login_outcome(&outcome)),
        Err(error) => {
            set_last_error(format!("complete_login failed: {error}"));
            std::ptr::null_mut()
        }
    }
}

/// Resolves a fresh access token using the OAuth client saved in
/// Keychain. Returns NULL when no saved client exists or refresh fails.
///
/// # Safety
/// `account_utf8` must be null-terminated UTF-8.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_ensure_fresh_access_token_with_saved_oauth_client(
    account_utf8: *const c_char,
    leeway_seconds: u64,
) -> *mut c_char {
    clear_last_error();
    let Some(account) = c_str_to_str(account_utf8) else {
        set_last_error("account was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    let client = match load_oauth_client_config() {
        Ok(client) => client.as_credentials(),
        Err(error) => {
            set_last_error(format!("load_oauth_client_config failed: {error}"));
            return std::ptr::null_mut();
        }
    };
    match oauth_flow::ensure_fresh_access_token_with_client(
        mac_token_store(),
        &client,
        account,
        leeway_seconds,
    ) {
        Ok(stored) => string_to_c(stored.access_token),
        Err(error) => {
            set_last_error(format!("ensure_fresh_access_token failed: {error}"));
            std::ptr::null_mut()
        }
    }
}

/// Spawns the user's default browser pointing at `url_utf8` via
/// `/usr/bin/open`. Returns 1 on success, 0 on failure.
///
/// # Safety
/// `url_utf8` must be null-terminated UTF-8.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_open_url(url_utf8: *const c_char) -> i32 {
    clear_last_error();
    let Some(url) = c_str_to_str(url_utf8) else {
        set_last_error("url pointer was null or invalid UTF-8");
        return 0;
    };
    match launch_browser_via_nsworkspace(url) {
        Ok(()) => 1,
        Err(error) => {
            set_last_error(format!("open_url failed: {error}"));
            0
        }
    }
}

/// Runs the full OAuth loopback flow end-to-end: opens `auth_url` in
/// the user's default browser, blocks on the loopback callback (5 min
/// timeout), exchanges the code for tokens, fetches userinfo, persists
/// the token set in the Keychain, and returns the JSON-encoded
/// `LoginOutcome`.
///
/// Blocking call. Swift wraps in `Task.detached` so the SwiftUI
/// sign-in sheet can await the result without blocking the main
/// thread.
///
/// `account_override_utf8` may be NULL (or an empty string) to
/// derive the account name from the signed-in email.
///
/// Returns the JSON-encoded outcome on success or NULL on error
/// (consult `melon_pan_last_error`).
///
/// # Safety
/// `credentials_path_utf8` must be null-terminated UTF-8;
/// `account_override_utf8` may be null.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_run_login(
    credentials_path_utf8: *const c_char,
    account_override_utf8: *const c_char,
    narrow_scope: i32,
    port: u16,
) -> *mut c_char {
    clear_last_error();
    let Some(credentials_path) = c_str_to_path(credentials_path_utf8) else {
        set_last_error("credentials_path was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    let account_override = c_str_to_str(account_override_utf8).filter(|s| !s.is_empty());

    let pending = match oauth_flow::begin_login_on_port(&credentials_path, narrow_scope != 0, port)
    {
        Ok(p) => p,
        Err(error) => {
            set_last_error(format!("begin_login failed: {error}"));
            return std::ptr::null_mut();
        }
    };

    let auth_url = pending.auth_url.clone();
    if let Err(error) = launch_browser_via_nsworkspace(&auth_url) {
        // Non-fatal: the user can still copy the URL out of the
        // last_error stash if /usr/bin/open is somehow missing.
        eprintln!("melon_pan_run_login: launch_browser failed: {error}");
    }

    match oauth_flow::complete_login(mac_token_store(), pending, account_override) {
        Ok(outcome) => string_to_c(serialize_login_outcome(&outcome)),
        Err(error) => {
            set_last_error(format!("complete_login failed: {error}"));
            std::ptr::null_mut()
        }
    }
}

fn serialize_login_outcome(outcome: &melon_pan_runtime_shared::LoginOutcome) -> String {
    format!(
        "{{\"account\":\"{}\",\"email\":\"{}\",\"displayName\":\"{}\",\"scope\":\"{}\",\"expiresAtUnix\":{}}}",
        json_escape(&outcome.account),
        json_escape(&outcome.email),
        json_escape(&outcome.display_name),
        json_escape(&outcome.scope),
        outcome.expires_at_unix,
    )
}

/// Reads `<cache>/docs/<id>/{current.docs.json,meta.json}`
/// and returns a JSON object the Swift shell uses to rehydrate a tab
/// without a network roundtrip:
///
/// {
///   "documentId": "...",
///   "revisionId": "...",
///   "title": "...",
///   "bodyEndIndex": 17,
///   "plainText": "..."
/// }
///
/// Missing fields fall back to defaults (title from cached docs.json
/// title or document_id, bodyEndIndex to 1). Returns NULL when the
/// doc has no current.docs.json at all (bare cache directory).
///
/// # Safety
/// All `*const c_char` parameters must be null-terminated UTF-8.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_rehydrate_document(
    cache_root_utf8: *const c_char,
    document_id_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let (Some(cache_root), Some(document_id)) = (
        c_str_to_path(cache_root_utf8),
        c_str_to_str(document_id_utf8),
    ) else {
        set_last_error("one or more arguments were null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    let store = LocalCacheStore::new(&cache_root);
    let Ok(docs_json) = store.read_current_docs_json(document_id) else {
        set_last_error(format!("no current.docs.json for {document_id}"));
        return std::ptr::null_mut();
    };
    let parsed = melon_pan_core::parse_rich_document(&docs_json).ok();
    let plain_text = parsed
        .as_ref()
        .map(|doc| melon_pan_core::docs_to_plain_text(doc))
        .unwrap_or_default();
    let metadata = store.read_metadata(document_id).ok();
    let body_end_index = store
        .read_current_docs_state(document_id)
        .map(|state| state.body_end_index)
        .unwrap_or(1);
    let title = parsed
        .as_ref()
        .map(|doc| doc.title.clone())
        .or_else(|| metadata.as_ref().and_then(|record| record.title.clone()))
        .unwrap_or_else(|| document_id.to_string());
    let revision = metadata
        .as_ref()
        .map(|m| m.revision_id.clone())
        .unwrap_or_default();

    string_to_c(format!(
        "{{\"documentId\":\"{}\",\"revisionId\":\"{}\",\"title\":\"{}\",\"bodyEndIndex\":{},\"plainText\":\"{}\"}}",
        json_escape(document_id),
        json_escape(&revision),
        json_escape(&title),
        body_end_index,
        json_escape(&plain_text),
    ))
}

/// Enumerates cached documents for CoreSpotlight indexing.
///
/// Returns:
/// [{"id":"...","title":"...","snippet":"...","updatedAt":"..."}]
///
/// `snippet` is capped at 4096 Unicode scalar values from current.docs.json text.
/// `updatedAt` comes from lastPushedAt, lastPulledAt, then driveModifiedTime.
///
/// # Safety
/// `cache_root_utf8` must be a null-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_enumerate_cached_docs(
    cache_root_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let Some(cache_root) = c_str_to_path(cache_root_utf8) else {
        set_last_error("cache_root pointer was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    let store = LocalCacheStore::new(&cache_root);
    let ids = match store.list_cached_document_ids() {
        Ok(ids) => ids,
        Err(error) => {
            set_last_error(format!("enumerate_cached_docs failed: {error}"));
            return std::ptr::null_mut();
        }
    };

    let mut entries = Vec::new();
    for document_id in ids {
        let Ok(docs_json) = store.read_current_docs_json(&document_id) else {
            continue;
        };
        let parsed = parse_rich_document(&docs_json).ok();
        let plain_text = parsed
            .as_ref()
            .map(|doc| melon_pan_core::docs_to_plain_text(doc))
            .unwrap_or_default();
        let metadata = store.read_metadata(&document_id).ok();
        let title = parsed
            .as_ref()
            .map(|doc| doc.title.clone())
            .filter(|title: &String| !title.is_empty())
            .or_else(|| metadata.as_ref().and_then(|record| record.title.clone()))
            .unwrap_or_else(|| document_id.clone());
        let updated_at = metadata.as_ref().and_then(|record| {
            record
                .last_pushed_at
                .as_deref()
                .filter(|value| !value.is_empty())
                .or(non_empty(&record.last_pulled_at))
                .or(non_empty(&record.drive_modified_time))
        });
        let snippet: String = plain_text.chars().take(4096).collect();
        entries.push(serialize_cached_doc_summary(
            &document_id,
            &title,
            &snippet,
            updated_at,
        ));
    }
    string_to_c(format!("[{}]", entries.join(",")))
}

/// Returns a JSON array of cached document ids known to the local
/// store. Used by the macOS Conflicts pane to enumerate every doc
/// that might have pending mutations or pre-push snapshots.
///
/// Caller frees the returned pointer.
///
/// # Safety
/// `cache_root_utf8` must be null-terminated UTF-8.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_list_cached_document_ids(
    cache_root_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let Some(cache_root) = c_str_to_path(cache_root_utf8) else {
        set_last_error("cache_root pointer was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    let store = LocalCacheStore::new(&cache_root);
    let ids = match store.list_cached_document_ids() {
        Ok(ids) => ids,
        Err(error) => {
            set_last_error(format!("list_cached_document_ids failed: {error}"));
            return std::ptr::null_mut();
        }
    };
    let mut out = String::from("[");
    for (i, id) in ids.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push('"');
        out.push_str(&json_escape(id));
        out.push('"');
    }
    out.push(']');
    string_to_c(out)
}

/// Returns a JSON object summarising the pending state for
/// `document_id`: pending mutation file paths + pre-push snapshot
/// paths, both newest-first. Used by the macOS Conflicts pane.
///
/// {
///   "documentId": "...",
///   "pendingMutations": ["/path/to/<id>.json", ...],
///   "prePushSnapshots": ["/path/to/<stamp>.md", ...]
/// }
///
/// Caller frees the returned pointer.
///
/// # Safety
/// All `*const c_char` parameters must be null-terminated UTF-8.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_doc_pending_summary(
    cache_root_utf8: *const c_char,
    document_id_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let (Some(cache_root), Some(document_id)) = (
        c_str_to_path(cache_root_utf8),
        c_str_to_str(document_id_utf8),
    ) else {
        set_last_error("one or more arguments were null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    let store = LocalCacheStore::new(&cache_root);
    let pending =
        melon_pan_core::list_pending_mutation_files(&store, document_id).unwrap_or_default();
    let pre_push = store
        .list_pre_push_snapshots(document_id)
        .unwrap_or_default();

    fn json_string_array(paths: &[std::path::PathBuf]) -> String {
        let mut out = String::from("[");
        for (i, path) in paths.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push('"');
            out.push_str(&json_escape(&path.to_string_lossy()));
            out.push('"');
        }
        out.push(']');
        out
    }

    string_to_c(format!(
        "{{\"documentId\":\"{}\",\"pendingMutations\":{},\"prePushSnapshots\":{}}}",
        json_escape(document_id),
        json_string_array(&pending),
        json_string_array(&pre_push),
    ))
}

/// Reads up to `limit` newest sync journal events as a JSON array.
///
/// # Safety
/// `cache_root_utf8` must be a null-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_recent_sync_events(
    cache_root_utf8: *const c_char,
    limit: u32,
) -> *mut c_char {
    clear_last_error();
    let Some(cache_root) = c_str_to_path(cache_root_utf8) else {
        set_last_error("cache_root pointer was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    match read_recent_events(&cache_root, limit as usize) {
        Ok(events) => string_to_c(serialize_sync_events(&events)),
        Err(error) => {
            set_last_error(format!("recent_sync_events failed: {error}"));
            std::ptr::null_mut()
        }
    }
}

/// Clears or prunes the sync journal by retention days.
///
/// # Safety
/// `cache_root_utf8` must be a null-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_clear_journal(
    cache_root_utf8: *const c_char,
    retain_days: u32,
) -> i32 {
    clear_last_error();
    let Some(cache_root) = c_str_to_path(cache_root_utf8) else {
        set_last_error("cache_root pointer was null or invalid UTF-8");
        return 0;
    };
    let retain_secs = u64::from(retain_days).saturating_mul(24 * 60 * 60);
    match clear_events(&cache_root, retain_secs) {
        Ok(_) => 1,
        Err(error) => {
            set_last_error(format!("clear_journal failed: {error}"));
            0
        }
    }
}

/// Lists immutable revision snapshots for one document as JSON.
///
/// # Safety
/// All `*const c_char` parameters must be null-terminated UTF-8.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_list_revision_snapshots(
    cache_root_utf8: *const c_char,
    document_id_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let (Some(cache_root), Some(document_id)) = (
        c_str_to_path(cache_root_utf8),
        c_str_to_str(document_id_utf8),
    ) else {
        set_last_error("one or more arguments were null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    let store = LocalCacheStore::new(&cache_root);
    let snapshots = store
        .list_revision_snapshots(document_id)
        .unwrap_or_default();
    string_to_c(serialize_revision_snapshots(document_id, &snapshots))
}

/// Loads the most-recently-opened document history as JSON.
///
/// # Safety
/// `config_root_utf8` must be a null-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_load_open_history(
    config_root_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let Some(config_root) = c_str_to_path(config_root_utf8) else {
        set_last_error("config_root pointer was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    let history = open_history::load_history(&config_root);
    string_to_c(serialize_open_history(&history))
}

/// Records one most-recently-opened entry.
///
/// # Safety
/// All `*const c_char` parameters must be null-terminated UTF-8.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_record_open_history(
    config_root_utf8: *const c_char,
    entry_utf8: *const c_char,
) -> i32 {
    clear_last_error();
    let (Some(config_root), Some(entry)) =
        (c_str_to_path(config_root_utf8), c_str_to_str(entry_utf8))
    else {
        set_last_error("one or more arguments were null or invalid UTF-8");
        return 0;
    };
    match open_history::record_open(&config_root, entry) {
        Ok(()) => 1,
        Err(error) => {
            set_last_error(format!("record_open_history failed: {error}"));
            0
        }
    }
}

/// Restores a pre-push snapshot back into `current.md`. The previous
/// `current.md` is archived to trash, so the operation is reversible.
///
/// Returns 1 on success, 0 on failure.
///
/// # Safety
/// All `*const c_char` parameters must be null-terminated UTF-8.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_restore_snapshot(
    cache_root_utf8: *const c_char,
    document_id_utf8: *const c_char,
    snapshot_path_utf8: *const c_char,
) -> i32 {
    clear_last_error();
    let (Some(cache_root), Some(document_id), Some(snapshot_path)) = (
        c_str_to_path(cache_root_utf8),
        c_str_to_str(document_id_utf8),
        c_str_to_path(snapshot_path_utf8),
    ) else {
        set_last_error("one or more arguments were null or invalid UTF-8");
        return 0;
    };
    let store = LocalCacheStore::new(&cache_root);
    match store.restore_to_current(document_id, &snapshot_path) {
        Ok(()) => {
            let revision = snapshot_path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("snapshot");
            let event = SyncEvent::new(
                SyncEventKind::Drain,
                document_id,
                revision,
                format!("restored from {revision}"),
            );
            let _ = append_event(&cache_root, &event);
            1
        }
        Err(error) => {
            set_last_error(format!("restore_snapshot failed: {error}"));
            0
        }
    }
}

/// Polls the configured GitHub Releases repo for a newer version and
/// returns the result as JSON:
///
/// {
///   "current": "0.1.0",
///   "latest":  "0.2.0",
///   "releaseUrl": "https://github.com/.../releases/tag/v0.2.0",
///   "hasUpdate": true
/// }
///
/// `repo_utf8` may be NULL to use the workspace default
/// (`gongahkia/melon-pan`). `current_version_utf8` should be the
/// CFBundleShortVersionString from Info.plist so the comparison is
/// stable across builds.
///
/// Blocking: hits api.github.com synchronously. The Swift side wraps
/// this in `Task.detached` to keep the UI responsive.
///
/// # Safety
/// `current_version_utf8` must be null-terminated UTF-8;
/// `repo_utf8` may be NULL.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_check_for_updates(
    repo_utf8: *const c_char,
    current_version_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let Some(current_version) = c_str_to_str(current_version_utf8) else {
        set_last_error("current_version pointer was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    let repo = c_str_to_str(repo_utf8).unwrap_or(DEFAULT_REPO);
    match check_for_updates(repo, current_version) {
        Ok(status) => string_to_c(format!(
            "{{\"current\":\"{}\",\"latest\":\"{}\",\"releaseUrl\":\"{}\",\"hasUpdate\":{}}}",
            json_escape(&status.current),
            json_escape(&status.latest),
            json_escape(&status.release_url),
            status.has_update,
        )),
        Err(error) => {
            set_last_error(format!("check_for_updates failed: {error}"));
            std::ptr::null_mut()
        }
    }
}

/// Looks up an account's persisted token JSON from the Keychain.
/// Returns null when missing or on error (`melon_pan_last_error`
/// disambiguates).
///
/// # Safety
/// `account_utf8` must be null-terminated UTF-8.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_token_lookup(account_utf8: *const c_char) -> *mut c_char {
    clear_last_error();
    let Some(account) = c_str_to_str(account_utf8) else {
        set_last_error("account pointer was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    use melon_pan_runtime_shared::TokenStore as _;
    let store = mac_token_store();
    match store.lookup(account) {
        Ok(json) => string_to_c(json),
        Err(error) => {
            set_last_error(error);
            std::ptr::null_mut()
        }
    }
}

/// Returns JSON with cache footprint and runtime version data.
///
/// # Safety
/// `cache_root_utf8` must be a null-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_diagnostic_snapshot(
    cache_root_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let Some(cache_root) = c_str_to_path(cache_root_utf8) else {
        set_last_error("cache_root pointer was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    match diagnostic_snapshot(cache_root) {
        Ok(snapshot) => {
            let mtime = snapshot
                .drive_tree_mtime_unix
                .map(|value| value.to_string())
                .unwrap_or_else(|| "null".to_string());
            string_to_c(format!(
                "{{\"cacheRoot\":\"{}\",\"totalSnapshotBytes\":{},\"docCount\":{},\"snapshotCount\":{},\"driveTreeMtimeUnix\":{},\"runtimeSharedVersion\":\"{}\",\"coreVersion\":\"{}\"}}",
                json_escape(&snapshot.cache_root),
                snapshot.total_snapshot_bytes,
                snapshot.doc_count,
                snapshot.snapshot_count,
                mtime,
                json_escape(&snapshot.runtime_shared_version),
                json_escape(&snapshot.core_version),
            ))
        }
        Err(error) => {
            set_last_error(format!("diagnostic_snapshot failed: {error}"));
            std::ptr::null_mut()
        }
    }
}

/// Returns JSON with the audit triangle for one cached document.
///
/// # Safety
/// All `*const c_char` parameters must be null-terminated UTF-8.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_audit_status(
    _cache_root_utf8: *const c_char,
    _document_id_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    set_last_error("audit unsupported in rich mode");
    std::ptr::null_mut()
}

/// Pulls every cached document and refreshes drive-tree.json.
///
/// # Safety
/// All `*const c_char` parameters must be null-terminated UTF-8.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_force_full_resync(
    cache_root_utf8: *const c_char,
    access_token_utf8: *const c_char,
) -> i32 {
    clear_last_error();
    let (Some(cache_root), Some(access_token)) = (
        c_str_to_path(cache_root_utf8),
        c_str_to_str(access_token_utf8),
    ) else {
        set_last_error("one or more arguments were null or invalid UTF-8");
        return 0;
    };
    match force_full_resync(cache_root, access_token) {
        Ok(()) => 1,
        Err(error) => {
            set_last_error(format!("force_full_resync failed: {error}"));
            0
        }
    }
}

/// Clears cached Docs/Drive data while preserving credentials and windows state.
///
/// # Safety
/// `cache_root_utf8` must be a null-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_clear_cached_drive_data(cache_root_utf8: *const c_char) -> i32 {
    clear_last_error();
    let Some(cache_root) = c_str_to_path(cache_root_utf8) else {
        set_last_error("cache_root pointer was null or invalid UTF-8");
        return 0;
    };
    match clear_cached_drive_data(cache_root) {
        Ok(()) => 1,
        Err(error) => {
            set_last_error(format!("clear_cached_drive_data failed: {error}"));
            0
        }
    }
}

/// Returns JSON with a non-secret Keychain health probe.
///
/// # Safety
/// No inputs; the returned pointer is owned by the caller.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_keychain_probe() -> *mut c_char {
    clear_last_error();
    let probe = keychain_probe();
    string_to_c(format!(
        "{{\"state\":\"{}\",\"itemCount\":{},\"service\":\"{}\"}}",
        json_escape(&probe.state),
        probe.item_count,
        json_escape(&probe.service),
    ))
}

/// Returns JSON with Rust runtime version metadata.
///
/// # Safety
/// No inputs; the returned pointer is owned by the caller.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_runtime_versions() -> *mut c_char {
    clear_last_error();
    let versions = runtime_versions();
    string_to_c(format!(
        "{{\"coreVersion\":\"{}\",\"runtimeSharedVersion\":\"{}\",\"commitSHA\":\"{}\",\"buildTimestamp\":\"{}\"}}",
        json_escape(&versions.core_version),
        json_escape(&versions.runtime_shared_version),
        json_escape(&versions.commit_sha),
        json_escape(&versions.build_timestamp),
    ))
}

/// Returns token metadata without returning access or refresh tokens.
///
/// # Safety
/// `account_utf8` must be null-terminated UTF-8.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_token_metadata(account_utf8: *const c_char) -> *mut c_char {
    clear_last_error();
    let Some(account) = c_str_to_str(account_utf8) else {
        set_last_error("account pointer was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    match token_metadata(account) {
        Ok(metadata) => string_to_c(format!(
            "{{\"scope\":\"{}\",\"expiresAtUnix\":{},\"hasRefreshToken\":{}}}",
            json_escape(&metadata.scope),
            metadata.expires_at_unix,
            metadata.has_refresh_token,
        )),
        Err(error) => {
            set_last_error(error);
            std::ptr::null_mut()
        }
    }
}

// ---------- internal helpers ----------

fn mac_token_store() -> &'static MacTokenStore {
    static STORE: OnceLock<MacTokenStore> = OnceLock::new();
    STORE.get_or_init(MacTokenStore::new)
}

unsafe fn c_str_to_str<'a>(ptr: *const c_char) -> Option<&'a str> {
    if ptr.is_null() {
        return None;
    }
    CStr::from_ptr(ptr).to_str().ok()
}

unsafe fn c_str_to_path(ptr: *const c_char) -> Option<PathBuf> {
    c_str_to_str(ptr).map(PathBuf::from)
}

fn string_to_c(value: String) -> *mut c_char {
    match CString::new(value) {
        Ok(cstring) => cstring.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

fn notify_sync_error(document_id: &str, message: &str) {
    let Ok(slot) = SYNC_ERROR_CALLBACK.lock() else {
        return;
    };
    let Some(callback) = *slot else {
        return;
    };
    let Ok(document_id) = CString::new(document_id) else {
        return;
    };
    let Ok(message) = CString::new(message) else {
        return;
    };
    callback(document_id.as_ptr(), message.as_ptr());
}

fn default_settings_json() -> String {
    concat!(
        "{\n",
        "  \"paletteKeybind\": \"Ctrl+P\",\n",
        "  \"saveKeybind\": \"Ctrl+S\",\n",
        "  \"searchMode\": \"Local cache first\",\n",
        "  \"colorScheme\": \"Default\",\n",
        "  \"customBackground\": \"#fbfaf7\",\n",
        "  \"customSidebar\": \"#f7f5f0\",\n",
        "  \"customAccent\": \"#3a342e\",\n",
        "  \"privacyLocalFirst\": true,\n",
        "  \"syncAutoPull\": false,\n",
        "  \"syncAutoPush\": false,\n",
        "  \"historySnapshots\": true,\n",
        "  \"autoCollapseSidebar\": false\n",
        "}\n"
    )
    .to_string()
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
            ch if (ch as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => out.push(ch),
        }
    }
    out
}

fn serialize_sync_events(events: &[SyncEvent]) -> String {
    let items = events
        .iter()
        .map(|event| {
            format!(
                "{{\"ts\":{},\"kind\":\"{}\",\"document_id\":\"{}\",\"revision\":\"{}\",\"message\":\"{}\"}}",
                event.timestamp_unix,
                event.kind.as_str(),
                json_escape(&event.document_id),
                json_escape(&event.revision),
                json_escape(&event.message),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{items}]")
}

fn serialize_revision_snapshots(document_id: &str, paths: &[PathBuf]) -> String {
    let items = paths
        .iter()
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("md"))
        .map(|path| serialize_revision_snapshot(document_id, path))
        .collect::<Vec<_>>()
        .join(",");
    format!("[{items}]")
}

fn serialize_revision_snapshot(document_id: &str, markdown_path: &Path) -> String {
    let stem = markdown_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or_default();
    let docs_json_path = markdown_path.with_file_name(format!("{stem}.docs.json"));
    let docs_json = if docs_json_path.exists() {
        format!("\"{}\"", json_escape(&docs_json_path.to_string_lossy()))
    } else {
        "null".to_string()
    };
    let (created_at, size_bytes) = file_stamp_and_size(markdown_path);
    format!(
        "{{\"documentId\":\"{}\",\"kind\":\"revision\",\"revisionOrStamp\":\"{}\",\"markdownPath\":\"{}\",\"docsJsonPath\":{},\"createdAtUnix\":{},\"sizeBytes\":{}}}",
        json_escape(document_id),
        json_escape(stem),
        json_escape(&markdown_path.to_string_lossy()),
        docs_json,
        created_at,
        size_bytes,
    )
}

fn serialize_open_history(entries: &[String]) -> String {
    let items = entries
        .iter()
        .map(|entry| {
            format!(
                "{{\"entry\":\"{}\",\"recordedAtUnix\":null}}",
                json_escape(entry)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{items}]")
}

fn file_stamp_and_size(path: &Path) -> (u64, u64) {
    match fs::metadata(path) {
        Ok(metadata) => {
            let stamp = metadata
                .modified()
                .ok()
                .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            (stamp, metadata.len())
        }
        Err(_) => (0, 0),
    }
}

fn serialize_pull_report(report: &melon_pan_runtime_shared::PullReport) -> String {
    format!(
        "{{\"documentId\":\"{}\",\"revisionId\":\"{}\",\"bodyEndIndex\":{},\"title\":\"{}\",\"plainText\":\"{}\"}}",
        json_escape(&report.document_id),
        json_escape(&report.revision_id),
        report.body_end_index,
        json_escape(&report.title),
        json_escape(&report.plain_text),
    )
}

fn serialize_comment_refresh_report(
    report: &melon_pan_runtime_shared::CommentRefreshReport,
) -> String {
    format!(
        "{{\"documentId\":\"{}\",\"commentCount\":{}}}",
        json_escape(&report.document_id),
        report.comment_count
    )
}

fn non_empty(value: &str) -> Option<&str> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn serialize_cached_doc_summary(
    id: &str,
    title: &str,
    snippet: &str,
    updated_at: Option<&str>,
) -> String {
    let updated = updated_at
        .filter(|value| !value.is_empty() && *value != "unknown")
        .map(|value| format!("\"{}\"", json_escape(value)))
        .unwrap_or_else(|| "null".to_string());
    format!(
        "{{\"id\":\"{}\",\"title\":\"{}\",\"snippet\":\"{}\",\"updatedAt\":{}}}",
        json_escape(id),
        json_escape(title),
        json_escape(snippet),
        updated,
    )
}

fn serialize_push_report(report: &melon_pan_runtime_shared::PushReport) -> String {
    use melon_pan_runtime_shared::PushOutcome;
    let outcome = match &report.outcome {
        PushOutcome::Pushed {
            revision_before,
            revision_after,
            plain_text,
        } => format!(
            "{{\"kind\":\"pushed\",\"revisionBefore\":\"{}\",\"revisionAfter\":\"{}\",\"plainText\":\"{}\"}}",
            json_escape(revision_before),
            json_escape(revision_after),
            json_escape(plain_text)
        ),
        PushOutcome::QueuedRevisionConflict { pending_path } => format!(
            "{{\"kind\":\"queuedRevisionConflict\",\"pendingPath\":\"{}\"}}",
            json_escape(&pending_path.to_string_lossy())
        ),
        PushOutcome::QueuedTransportFailure {
            pending_path,
            message,
        } => format!(
            "{{\"kind\":\"queuedTransportFailure\",\"pendingPath\":\"{}\",\"message\":\"{}\"}}",
            json_escape(&pending_path.to_string_lossy()),
            json_escape(message)
        ),
    };
    let warnings = report
        .fidelity_warnings
        .iter()
        .map(|w| {
            format!(
                "{{\"kind\":\"{:?}\",\"message\":\"{}\"}}",
                w.kind,
                json_escape(&w.message)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{{\"outcome\":{outcome},\"fidelityWarnings\":[{warnings}]}}")
}

fn serialize_conflict_resolution_report(
    report: &melon_pan_runtime_shared::ConflictResolutionReport,
) -> String {
    format!(
        "{{\"canceledOperations\":{},\"remainingPending\":{}}}",
        report.canceled_operations, report.remaining_pending
    )
}

// ===== rich-text editing FFI =========================================
//
// Three calls power the macOS edit pipeline. Swift loads the canonical
// rich document via `melon_pan_load_rich_document_for_swift`, queues
// edits via `melon_pan_append_operation_envelope`, and saves via
// `melon_pan_push_document_now`. Each round-trips JSON because the
// Swift side already has a robust `JSONSerialization` path; we don't
// need to hand-build C structs for a small surface.

/// Load `current.docs.json` from cache, parse to RichDocument, and
/// return the Swift-shaped serialization. Returns null on parse error.
///
/// # Safety
/// `cache_root_utf8` and `document_id_utf8` must be null-terminated UTF-8.
/// Caller frees the returned pointer with `melon_pan_string_free`.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_load_rich_document_for_swift(
    cache_root_utf8: *const c_char,
    document_id_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let (Some(cache_root), Some(document_id)) = (
        c_str_to_path(cache_root_utf8),
        c_str_to_str(document_id_utf8),
    ) else {
        set_last_error("cache_root or document_id was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    let store = LocalCacheStore::new(&cache_root);
    let raw = match store.read_current_docs_json(document_id) {
        Ok(raw) => raw,
        Err(error) => {
            set_last_error(format!("read_current_docs_json: {error}"));
            return std::ptr::null_mut();
        }
    };
    let doc = match melon_pan_core::parse_rich_document(&raw) {
        Ok(doc) => doc,
        Err(error) => {
            set_last_error(format!("parse_rich_document: {error:?}"));
            return std::ptr::null_mut();
        }
    };
    if doc.schema_version != melon_pan_core::RICH_SCHEMA_VERSION {
        set_last_error(format!(
            "unsupported rich schema version {}; expected {}",
            doc.schema_version,
            melon_pan_core::RICH_SCHEMA_VERSION
        ));
        return std::ptr::null_mut();
    }
    string_to_c(melon_pan_core::serialize_rich_document_for_swift(&doc))
}

/// Append a single operation envelope to the doc's operation log.
/// `envelope_json_utf8` must match the wire format produced by
/// `rich_oplog::serialize_envelope`. Returns 1 on success, 0 on failure.
///
/// # Safety
/// All three arguments must be null-terminated UTF-8 strings.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_append_operation_envelope(
    cache_root_utf8: *const c_char,
    document_id_utf8: *const c_char,
    envelope_json_utf8: *const c_char,
) -> i32 {
    clear_last_error();
    let (Some(cache_root), Some(document_id), Some(envelope_json)) = (
        c_str_to_path(cache_root_utf8),
        c_str_to_str(document_id_utf8),
        c_str_to_str(envelope_json_utf8),
    ) else {
        set_last_error("one of cache_root / document_id / envelope_json was null or invalid UTF-8");
        return 0;
    };
    let envelope = match melon_pan_core::parse_envelope_json(envelope_json) {
        Ok(value) => value,
        Err(error) => {
            set_last_error(format!("parse envelope: {error}"));
            return 0;
        }
    };
    let store = LocalCacheStore::new(&cache_root);
    if let Err(error) = store.initialize() {
        set_last_error(format!("init cache: {error}"));
        return 0;
    }
    match melon_pan_core::append_envelope(&store, document_id, &envelope) {
        Ok(()) => 1,
        Err(error) => {
            set_last_error(format!("append envelope: {error}"));
            0
        }
    }
}

/// Archive + clear the operation log. Use after the user picks "Discard
/// local edits" from a revision-rejected recovery prompt: the archive
/// keeps the bytes recoverable, the clear lets editing resume from the
/// freshly-pulled state.
///
/// # Safety
/// Both arguments must be null-terminated UTF-8 strings.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_discard_pending_ops(
    cache_root_utf8: *const c_char,
    document_id_utf8: *const c_char,
) -> i32 {
    clear_last_error();
    let (Some(cache_root), Some(document_id)) = (
        c_str_to_path(cache_root_utf8),
        c_str_to_str(document_id_utf8),
    ) else {
        set_last_error("cache_root or document_id was null or invalid UTF-8");
        return 0;
    };
    let store = LocalCacheStore::new(&cache_root);
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "discarded".to_string());
    if let Err(error) = melon_pan_core::archive_log(&store, document_id, &stamp) {
        set_last_error(format!("archive_log failed: {error}"));
        return 0;
    }
    if let Err(error) = melon_pan_core::clear_log(&store, document_id) {
        set_last_error(format!("clear_log failed: {error}"));
        return 0;
    }
    1
}

/// Returns 1 if the operation log has at least one queued op, 0 if
/// empty / missing. Drives the "Save" button enabled-state.
///
/// # Safety
/// Both arguments must be null-terminated UTF-8 strings.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_has_pending_ops(
    cache_root_utf8: *const c_char,
    document_id_utf8: *const c_char,
) -> i32 {
    clear_last_error();
    let (Some(cache_root), Some(document_id)) = (
        c_str_to_path(cache_root_utf8),
        c_str_to_str(document_id_utf8),
    ) else {
        set_last_error("cache_root or document_id was null or invalid UTF-8");
        return 0;
    };
    let store = LocalCacheStore::new(&cache_root);
    if melon_pan_core::has_pending(&store, document_id) {
        1
    } else {
        0
    }
}

/// Classify cached conflict state after a revision-rejected pull. Returns
/// JSON-encoded ConflictReport.
///
/// # Safety
/// Both arguments must be null-terminated UTF-8 strings.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_classify_conflict(
    cache_root_utf8: *const c_char,
    document_id_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let (Some(cache_root), Some(document_id)) = (
        c_str_to_path(cache_root_utf8),
        c_str_to_str(document_id_utf8),
    ) else {
        set_last_error("cache_root or document_id was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    match classify_cached_conflict(&cache_root, document_id) {
        Ok(report) => string_to_c(report.to_json()),
        Err(error) => {
            set_last_error(format!("classify_conflict failed: {error}"));
            std::ptr::null_mut()
        }
    }
}

/// Apply conflict choices. The resolution JSON is
/// `{"decisions":[{"regionId":"...","decision":"local|remote"}]}`.
///
/// # Safety
/// All arguments must be null-terminated UTF-8 strings.
#[no_mangle]
pub unsafe extern "C" fn melon_pan_resolve_conflict(
    cache_root_utf8: *const c_char,
    document_id_utf8: *const c_char,
    resolution_json_utf8: *const c_char,
) -> *mut c_char {
    clear_last_error();
    let (Some(cache_root), Some(document_id), Some(resolution_json)) = (
        c_str_to_path(cache_root_utf8),
        c_str_to_str(document_id_utf8),
        c_str_to_str(resolution_json_utf8),
    ) else {
        set_last_error("cache_root, document_id, or resolution_json was null or invalid UTF-8");
        return std::ptr::null_mut();
    };
    match resolve_cached_conflict(&cache_root, document_id, resolution_json) {
        Ok(report) => string_to_c(serialize_conflict_resolution_report(&report)),
        Err(error) => {
            set_last_error(format!("resolve_conflict failed: {error}"));
            std::ptr::null_mut()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use melon_pan_core::{FidelityReport, MetadataRecord};
    use std::sync::Mutex as TestMutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    static CALLBACK_MESSAGES: TestMutex<Vec<(String, String)>> = TestMutex::new(Vec::new());
    static TEST_LOCK: TestMutex<()> = TestMutex::new(());

    extern "C" fn capture_sync_error(document_id_utf8: *const c_char, message_utf8: *const c_char) {
        unsafe {
            let document_id = CStr::from_ptr(document_id_utf8)
                .to_str()
                .unwrap()
                .to_string();
            let message = CStr::from_ptr(message_utf8).to_str().unwrap().to_string();
            CALLBACK_MESSAGES
                .lock()
                .unwrap()
                .push((document_id, message));
        }
    }

    fn temp_root(prefix: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "{prefix}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn cross_platform_fixture_root() -> PathBuf {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest_dir
            .parent()
            .and_then(|crates| crates.parent())
            .map(|root| {
                root.join("tests")
                    .join("cross-platform-cache")
                    .join("melon-pan")
            })
            .expect("repo layout has crates/<crate>/, walk up two parents")
    }

    fn minimal_rich_docs_json(document_id: &str) -> String {
        format!(
            r#"{{
              "documentId":"{document_id}",
              "title":"Rich FFI Doc",
              "revisionId":"rev-rich-1",
              "body":{{"content":[
                {{"startIndex":1,"endIndex":7,"paragraph":{{"elements":[{{"textRun":{{"content":"Hello\n"}}}}]}}}}
              ]}}
            }}"#
        )
    }

    unsafe fn take_c_string(ptr: *mut c_char) -> String {
        assert!(!ptr.is_null());
        let value = CStr::from_ptr(ptr).to_str().unwrap().to_string();
        melon_pan_string_free(ptr);
        value
    }

    #[test]
    fn round_trip_string_through_ffi_alloc() {
        unsafe {
            let raw = string_to_c("hello".to_string());
            assert!(!raw.is_null());
            let recovered = CStr::from_ptr(raw).to_str().unwrap().to_string();
            assert_eq!(recovered, "hello");
            melon_pan_string_free(raw);
        }
    }

    #[test]
    fn last_error_starts_empty() {
        clear_last_error();
        unsafe {
            let raw = melon_pan_last_error();
            assert!(raw.is_null());
        }
    }

    #[test]
    fn last_error_round_trips_through_ffi() {
        unsafe {
            set_last_error("synthetic ffi error");
            let raw = melon_pan_last_error();
            assert!(!raw.is_null());
            let message = CStr::from_ptr(raw).to_str().unwrap().to_string();
            assert_eq!(message, "synthetic ffi error");
            melon_pan_string_free(raw);
        }
    }

    #[test]
    fn json_escape_handles_quotes_and_newlines() {
        assert_eq!(json_escape("a\"b"), "a\\\"b");
        assert_eq!(json_escape("a\nb"), "a\\nb");
        assert_eq!(json_escape("a\tb"), "a\\tb");
    }

    #[test]
    fn default_paths_are_non_empty() {
        unsafe {
            let cache = melon_pan_default_cache_root();
            assert!(!cache.is_null());
            let cache_str = CStr::from_ptr(cache).to_str().unwrap().to_string();
            assert!(!cache_str.is_empty());
            melon_pan_string_free(cache);

            let creds = melon_pan_default_credentials_path();
            assert!(!creds.is_null());
            let creds_str = CStr::from_ptr(creds).to_str().unwrap().to_string();
            assert!(creds_str.ends_with("credentials.json"));
            melon_pan_string_free(creds);
        }
    }

    #[test]
    fn settings_load_missing_returns_default_json() {
        let root = temp_root("melon-pan-settings-missing");
        unsafe {
            let root_c = CString::new(root.to_string_lossy().as_ref()).unwrap();
            let raw = melon_pan_load_settings(root_c.as_ptr());
            assert!(!raw.is_null());
            let json = CStr::from_ptr(raw).to_str().unwrap().to_string();
            melon_pan_string_free(raw);
            assert_eq!(json, default_settings_json());
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn settings_save_is_atomic_shape() {
        let root = temp_root("melon-pan-settings-save");
        let json = "{\"paletteKeybind\":\"Ctrl+P\"}\n";
        unsafe {
            let root_c = CString::new(root.to_string_lossy().as_ref()).unwrap();
            let json_c = CString::new(json).unwrap();
            assert_eq!(melon_pan_save_settings(root_c.as_ptr(), json_c.as_ptr()), 1);
        }
        assert_eq!(
            std::fs::read_to_string(root.join("settings.json")).unwrap(),
            json
        );
        assert!(!root.join("settings.json.tmp").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn null_input_to_pull_yields_null_and_sets_error() {
        clear_last_error();
        unsafe {
            let result =
                melon_pan_pull_document(std::ptr::null(), std::ptr::null(), std::ptr::null());
            assert!(result.is_null());
            let raw = melon_pan_last_error();
            assert!(!raw.is_null());
            let message = CStr::from_ptr(raw).to_str().unwrap().to_string();
            assert!(message.contains("null or invalid"));
            melon_pan_string_free(raw);
        }
    }

    #[test]
    fn sync_error_callback_fires_for_sync_errors() {
        let _guard = TEST_LOCK.lock().unwrap();
        CALLBACK_MESSAGES.lock().unwrap().clear();
        let root = temp_root("melon-pan-callback-test");
        LocalCacheStore::new(&root).initialize().unwrap();
        unsafe {
            melon_pan_set_sync_error_callback(Some(capture_sync_error));
            let token = CString::new("token").unwrap();
            let document_id = CString::new("doc-callback").unwrap();
            let root_c = CString::new(root.to_string_lossy().as_ref()).unwrap();
            let result =
                melon_pan_push_document(token.as_ptr(), document_id.as_ptr(), root_c.as_ptr());
            assert!(result.is_null());
            melon_pan_set_sync_error_callback(None);
        }
        let messages = CALLBACK_MESSAGES.lock().unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].0, "doc-callback");
        assert!(messages[0].1.contains("push_document failed"));
        std::fs::remove_dir_all(root).unwrap();
    }

    // Markdown audit drift was removed in the rich-docs-only cut; both
    // the old empty-array test and the fidelity-limit test relied on
    // docs_to_markdown + parse_docs_document_json + write_current_doc
    // (markdown), all of which are gone. The audit FFI itself is now a
    // permanent stub (see melon_pan_audit_drift_check) so a regression
    // test on the stub shape would only verify the error message —
    // deferred to the rich-aware audit replacement.

    #[test]
    fn enumerate_cached_docs_round_trips_cross_platform_fixture() {
        let root = cross_platform_fixture_root();
        assert!(root.exists(), "fixture missing at {}", root.display());

        unsafe {
            let root_c = CString::new(root.to_string_lossy().as_ref()).unwrap();
            let raw = melon_pan_enumerate_cached_docs(root_c.as_ptr());
            assert!(!raw.is_null());
            let json = CStr::from_ptr(raw).to_str().unwrap().to_string();
            melon_pan_string_free(raw);

            let parsed = melon_pan_core::parse_json(&json).unwrap();
            let docs = parsed.as_array().unwrap();
            assert_eq!(docs.len(), 1);
            let doc = &docs[0];
            assert_eq!(
                doc.get("id").and_then(melon_pan_core::JsonValue::as_str),
                Some("doc-fixture-1")
            );
            assert_eq!(
                doc.get("title").and_then(melon_pan_core::JsonValue::as_str),
                Some("Cross-platform fixture")
            );
            assert_eq!(
                doc.get("updatedAt")
                    .and_then(melon_pan_core::JsonValue::as_str),
                Some("2026-05-01T00:00:01Z")
            );
            let snippet = doc
                .get("snippet")
                .and_then(melon_pan_core::JsonValue::as_str)
                .unwrap();
            assert!(snippet.starts_with("# Cross-platform fixture"));
            // The fixture's current.docs.json only carries the heading;
            // the legacy current.md had `| col1 | col2 |` table content
            // that doesn't exist in the rich-doc cache. Snippet is now
            // derived from RichDocument plain text only.
        }
    }

    #[test]
    fn load_rich_document_for_swift_serializes_cached_docs_json() {
        let root = temp_root("melon-pan-rich-load-test");
        let store = LocalCacheStore::new(&root);
        store.initialize().unwrap();
        let docs_json = minimal_rich_docs_json("doc-rich");
        let metadata = MetadataRecord::from_pull(
            "doc-rich",
            "rev-rich-1",
            "2026-05-01T00:00:00Z",
            "2026-05-01T00:00:01Z",
            "Hello\n",
            &docs_json,
            FidelityReport::perfect(),
        );
        store
            .write_current_doc("doc-rich", "Hello\n", &docs_json, &metadata)
            .unwrap();

        unsafe {
            let root_c = CString::new(root.to_string_lossy().as_ref()).unwrap();
            let doc_c = CString::new("doc-rich").unwrap();
            let raw = melon_pan_load_rich_document_for_swift(root_c.as_ptr(), doc_c.as_ptr());
            let json = take_c_string(raw);
            assert!(json.contains(r#""documentId":"doc-rich""#));
            assert!(json.contains(r#""title":"Rich FFI Doc""#));
            assert!(json.contains(r#""revisionId":"rev-rich-1""#));
            assert!(json.contains(r#""text":"Hello\n""#));
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn append_operation_envelope_and_has_pending_ops_round_trip() {
        let root = temp_root("melon-pan-rich-append-test");
        let document_id = "doc-rich";
        let envelope = r#"{"operationId":"op-1","documentId":"doc-rich","tabId":"","baseRevisionId":"rev-rich-1","localTimestamp":"2026-05-01T00:00:02Z","actor":"tester","op":{"kind":"InsertText","paragraphId":{"kind":"synthetic","value":"p"},"utf16Offset":5,"text":"!"}}"#;

        unsafe {
            let root_c = CString::new(root.to_string_lossy().as_ref()).unwrap();
            let doc_c = CString::new(document_id).unwrap();
            let env_c = CString::new(envelope).unwrap();
            assert_eq!(
                melon_pan_has_pending_ops(root_c.as_ptr(), doc_c.as_ptr()),
                0
            );
            assert_eq!(
                melon_pan_append_operation_envelope(
                    root_c.as_ptr(),
                    doc_c.as_ptr(),
                    env_c.as_ptr()
                ),
                1
            );
            assert_eq!(
                melon_pan_has_pending_ops(root_c.as_ptr(), doc_c.as_ptr()),
                1
            );
        }

        let store = LocalCacheStore::new(&root);
        let envelopes = melon_pan_core::read_envelopes(&store, document_id).unwrap();
        assert_eq!(envelopes.len(), 1);
        assert_eq!(envelopes[0].operation_id, "op-1");
        assert!(matches!(
            envelopes[0].op,
            melon_pan_core::RichOperation::InsertText { .. }
        ));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn discard_pending_ops_archives_and_clears_operation_log() {
        let root = temp_root("melon-pan-rich-discard-test");
        let document_id = "doc-rich";
        let envelope = r#"{"operationId":"op-1","documentId":"doc-rich","tabId":"","baseRevisionId":"rev-rich-1","localTimestamp":"2026-05-01T00:00:02Z","actor":"tester","op":{"kind":"DeleteRange","paragraphId":{"kind":"synthetic","value":"p"},"utf16Start":0,"utf16End":1}}"#;

        unsafe {
            let root_c = CString::new(root.to_string_lossy().as_ref()).unwrap();
            let doc_c = CString::new(document_id).unwrap();
            let env_c = CString::new(envelope).unwrap();
            assert_eq!(
                melon_pan_append_operation_envelope(
                    root_c.as_ptr(),
                    doc_c.as_ptr(),
                    env_c.as_ptr()
                ),
                1
            );
            assert_eq!(
                melon_pan_discard_pending_ops(root_c.as_ptr(), doc_c.as_ptr()),
                1
            );
            assert_eq!(
                melon_pan_has_pending_ops(root_c.as_ptr(), doc_c.as_ptr()),
                0
            );
        }

        let store = LocalCacheStore::new(&root);
        let paths = store.paths_for(document_id);
        assert!(!paths.operation_log.exists());
        let archived = std::fs::read_dir(&paths.doc_dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .any(|name| name.starts_with("operation-log.") && name.ends_with(".jsonl"));
        assert!(archived);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn diagnostic_snapshot_reports_cache_shape() {
        let root = temp_root("melon-pan-diagnostic-snapshot-test");
        let store = LocalCacheStore::new(&root);
        store.initialize().unwrap();
        let docs_json = r#"{"documentId":"doc-1","title":"Doc","revisionId":"rev1","body":{"content":[{"startIndex":1,"endIndex":6}]}}"#;
        let metadata = MetadataRecord::from_pull(
            "doc-1",
            "rev1",
            "2026-05-01T00:00:00Z",
            "2026-05-01T00:00:01Z",
            "Doc\n",
            docs_json,
            FidelityReport::perfect(),
        );
        store
            .write_current_doc("doc-1", "Doc\n", docs_json, &metadata)
            .unwrap();
        store
            .write_snapshot("doc-1", "rev1", "Doc\n", docs_json)
            .unwrap();

        unsafe {
            let root_c = CString::new(root.to_string_lossy().as_ref()).unwrap();
            let raw = melon_pan_diagnostic_snapshot(root_c.as_ptr());
            assert!(!raw.is_null());
            let json = CStr::from_ptr(raw).to_str().unwrap().to_string();
            melon_pan_string_free(raw);
            assert!(json.contains("\"docCount\":1"));
            assert!(json.contains("\"snapshotCount\":2"));
            assert!(json.contains("\"totalSnapshotBytes\":"));
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn history_endpoints_return_empty_arrays_for_fresh_roots() {
        let root = temp_root("melon-pan-history-empty-test");
        unsafe {
            let root_c = CString::new(root.to_string_lossy().as_ref()).unwrap();
            let doc_c = CString::new("doc-1").unwrap();

            let events = melon_pan_recent_sync_events(root_c.as_ptr(), 200);
            assert!(!events.is_null());
            assert_eq!(CStr::from_ptr(events).to_str().unwrap(), "[]");
            melon_pan_string_free(events);

            let snapshots = melon_pan_list_revision_snapshots(root_c.as_ptr(), doc_c.as_ptr());
            assert!(!snapshots.is_null());
            assert_eq!(CStr::from_ptr(snapshots).to_str().unwrap(), "[]");
            melon_pan_string_free(snapshots);

            let open_history = melon_pan_load_open_history(root_c.as_ptr());
            assert!(!open_history.is_null());
            assert_eq!(CStr::from_ptr(open_history).to_str().unwrap(), "[]");
            melon_pan_string_free(open_history);
        }
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn recent_sync_events_decodes_jsonl_shape() {
        let root = temp_root("melon-pan-history-events-test");
        let event = SyncEvent {
            timestamp_unix: 1_714_742_400,
            kind: SyncEventKind::Push,
            document_id: "1AbC".to_string(),
            revision: "rev:42".to_string(),
            message: "queued: revision conflict".to_string(),
        };
        append_event(&root, &event).unwrap();

        unsafe {
            let root_c = CString::new(root.to_string_lossy().as_ref()).unwrap();
            let raw = melon_pan_recent_sync_events(root_c.as_ptr(), 200);
            assert!(!raw.is_null());
            let json = CStr::from_ptr(raw).to_str().unwrap().to_string();
            melon_pan_string_free(raw);
            assert_eq!(
                json,
                r#"[{"ts":1714742400,"kind":"push","document_id":"1AbC","revision":"rev:42","message":"queued: revision conflict"}]"#
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn list_revision_snapshots_returns_snapshot_info_shape() {
        let root = temp_root("melon-pan-history-snapshots-test");
        let store = LocalCacheStore::new(&root);
        store.initialize().unwrap();
        let docs_json = r#"{"documentId":"doc-1","title":"Doc","revisionId":"rev:42","body":{"content":[{"startIndex":1,"endIndex":6}]}}"#;
        store
            .write_snapshot("doc-1", "rev:42", "Doc\n", docs_json)
            .unwrap();

        unsafe {
            let root_c = CString::new(root.to_string_lossy().as_ref()).unwrap();
            let doc_c = CString::new("doc-1").unwrap();
            let raw = melon_pan_list_revision_snapshots(root_c.as_ptr(), doc_c.as_ptr());
            assert!(!raw.is_null());
            let json = CStr::from_ptr(raw).to_str().unwrap().to_string();
            melon_pan_string_free(raw);
            assert!(json.contains(r#""documentId":"doc-1""#));
            assert!(json.contains(r#""kind":"revision""#));
            assert!(json.contains(r#""revisionOrStamp":"rev_42""#));
            assert!(json.contains(r#""markdownPath":""#));
            assert!(json.contains(r#""docsJsonPath":""#));
            assert!(json.contains(r#""sizeBytes":4"#));
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restore_snapshot_archives_current_and_logs_event() {
        let root = temp_root("melon-pan-history-restore-test");
        let store = LocalCacheStore::new(&root);
        store.initialize().unwrap();
        let docs_json = r#"{"documentId":"doc-1","title":"Doc","revisionId":"rev2","body":{"content":[{"startIndex":1,"endIndex":6}]}}"#;
        let metadata = MetadataRecord::from_pull(
            "doc-1",
            "rev2",
            "2026-05-01T00:00:00Z",
            "2026-05-01T00:00:01Z",
            "v2\n",
            docs_json,
            FidelityReport::perfect(),
        );
        store
            .write_current_doc("doc-1", "v2\n", docs_json, &metadata)
            .unwrap();
        store
            .write_snapshot("doc-1", "rev1", "v1\n", docs_json)
            .unwrap();
        let snapshot_path = root.join("snapshots").join("doc-1").join("rev1.md");

        unsafe {
            let root_c = CString::new(root.to_string_lossy().as_ref()).unwrap();
            let doc_c = CString::new("doc-1").unwrap();
            let snapshot_c = CString::new(snapshot_path.to_string_lossy().as_ref()).unwrap();
            assert_eq!(
                melon_pan_restore_snapshot(root_c.as_ptr(), doc_c.as_ptr(), snapshot_c.as_ptr()),
                1
            );
        }

        assert_eq!(store.read_current_markdown("doc-1").unwrap(), "v1\n");
        assert_eq!(std::fs::read_to_string(&snapshot_path).unwrap(), "v1\n");
        let trash = store.list_trash("doc-1").unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(std::fs::read_to_string(&trash[0]).unwrap(), "v2\n");
        let events = read_recent_events(&root, 10).unwrap();
        assert_eq!(events[0].kind, SyncEventKind::Drain);
        assert_eq!(events[0].message, "restored from rev1");

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clear_cached_drive_data_preserves_credentials_and_windows() {
        let root = temp_root("melon-pan-clear-cache-test");
        std::fs::create_dir_all(root.join("docs/doc-1")).unwrap();
        std::fs::create_dir_all(root.join("snapshots/doc-1")).unwrap();
        std::fs::write(root.join("docs/doc-1/meta.json"), "{}").unwrap();
        std::fs::write(root.join("snapshots/doc-1/rev1.md"), "body").unwrap();
        std::fs::write(root.join("drive-tree.json"), "{}").unwrap();
        std::fs::write(root.join("credentials.json"), "{}").unwrap();
        std::fs::write(root.join("windows.json"), "{}").unwrap();

        unsafe {
            let root_c = CString::new(root.to_string_lossy().as_ref()).unwrap();
            assert_eq!(melon_pan_clear_cached_drive_data(root_c.as_ptr()), 1);
        }

        assert!(root.join("docs").exists());
        assert!(root.join("snapshots").exists());
        assert!(!root.join("drive-tree.json").exists());
        assert!(root.join("credentials.json").exists());
        assert!(root.join("windows.json").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    // audit_status_returns_four_hashes was a markdown-audit triangle
    // regression check. Removed alongside the audit feature in the
    // rich-docs-only cut; rich-aware audit will get its own test
    // surface when implemented.
}
