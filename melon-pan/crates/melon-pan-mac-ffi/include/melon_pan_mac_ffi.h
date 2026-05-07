#ifndef MELON_PAN_MAC_FFI_H
#define MELON_PAN_MAC_FFI_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * C ABI surface for the Melon Pan macOS Swift shell.
 *
 * Memory rules:
 *   - Every `char *` returned by this header is heap-allocated by Rust
 *     and must be released exactly once via `melon_pan_string_free`.
 *   - Every `const char *` parameter must be a NUL-terminated UTF-8
 *     string, or NULL where documented as optional.
 *   - On error, functions that return `char *` return NULL and set
 *     a thread-local error message readable via `melon_pan_last_error`.
 *
 * Compound returns are JSON-encoded; the Swift shell decodes them via
 * Codable. See apps/macos/melon-pan-mac/Bridge/RuntimeBridge.swift.
 */

/* ---- error reporting ---- */

/* Returns the most recent error message, or NULL when none.
   Caller frees with melon_pan_string_free. */
char *melon_pan_last_error(void);

/* Frees a string previously returned by this FFI. NULL is a no-op. */
void melon_pan_string_free(char *ptr);

/* Installs or clears the process-wide sync error callback. The callback
   receives document id and message pointers that are valid only for the
   duration of the call. */
void melon_pan_set_sync_error_callback(
    void (*callback)(const char *document_id_utf8, const char *message_utf8));

/* ---- platform paths ---- */

char *melon_pan_default_cache_root(void);
char *melon_pan_default_credentials_path(void);

/* ---- cache / sync ops ---- */

int32_t melon_pan_init_cache(const char *cache_root_utf8);

/* Returns raw <cache>/settings.json, or default JSON when missing.
   Caller frees with melon_pan_string_free. */
char *melon_pan_load_settings(const char *cache_root_utf8);

/* Atomically writes <cache>/settings.json. Returns 1 on success. */
int32_t melon_pan_save_settings(
    const char *cache_root_utf8,
    const char *settings_json_utf8);

/* MELON_PAN_SETTINGS_STUB: encryption re-key FFI is a no-op until the
   Rust cache encryption backend ships. Returns 1 on valid arguments. */
int32_t melon_pan_rekey_cache(
    const char *cache_root_utf8,
    const char *old_pass_utf8,
    const char *new_pass_utf8);

/* Clears one Keychain account entry. */
int32_t melon_pan_clear_account(const char *account_utf8);

/* Overwrites <cache>/docs/<id>/current.md with `markdown_utf8`.
   Used by editor-save flows: caller invokes this then optionally
   melon_pan_push_document. Returns 1 on success, 0 on failure. */
int32_t melon_pan_write_current_markdown(
    const char *cache_root_utf8,
    const char *document_id_utf8,
    const char *markdown_utf8);

/* Returns JSON-encoded PullReport on success, NULL on error. */
char *melon_pan_pull_document(
    const char *access_token_utf8,
    const char *document_id_utf8,
    const char *cache_root_utf8);

/* Refreshes <cache>/docs/<id>/comments.json from Drive comments.list.
   Returns JSON-encoded CommentRefreshReport on success. */
char *melon_pan_refresh_comments(
    const char *access_token_utf8,
    const char *document_id_utf8,
    const char *cache_root_utf8);

/* Reads cached <cache>/docs/<id>/comments.json, or an empty bundle when
   no comment sidecar exists yet. */
char *melon_pan_load_comments(
    const char *cache_root_utf8,
    const char *document_id_utf8);

/* Returns JSON-encoded PushReport on success, NULL on error. */
char *melon_pan_push_document(
    const char *access_token_utf8,
    const char *document_id_utf8,
    const char *cache_root_utf8);

/* Returns JSON-encoded DrainReport on success, NULL on error. */
char *melon_pan_drain_pending(
    const char *access_token_utf8,
    const char *document_id_utf8,
    const char *cache_root_utf8);

/* Returns JSON ImportResult on success, NULL on FFI argument error.
   `access_token_utf8` may be NULL when push-on-import is off. */
char *melon_pan_import_markdown_file(
    const char *cache_root_utf8,
    const char *source_path_utf8,
    const char *target_draft_id_utf8,
    const char *options_json_utf8,
    const char *access_token_utf8);

/* Returns JSON array of ImportResult. `recursive` is treated as bool. */
char *melon_pan_import_markdown_dir(
    const char *cache_root_utf8,
    const char *dir_utf8,
    int32_t recursive,
    const char *options_json_utf8,
    const char *access_token_utf8);

/* ---- local Markdown templates ---- */

/* Returns JSON array of TemplateInfo; creates <cache>/templates. */
char *melon_pan_templates_list(const char *cache_root_utf8);

/* Saves one MarkdownTemplate JSON payload. Returns 1 on success. */
int32_t melon_pan_template_save(
    const char *cache_root_utf8,
    const char *json_template_utf8);

/* Deletes one template by UUID string. Returns 1 on success. */
int32_t melon_pan_template_delete(
    const char *cache_root_utf8,
    const char *id_utf8);

/* Loads one MarkdownTemplate JSON payload by UUID string. */
char *melon_pan_template_load(
    const char *cache_root_utf8,
    const char *id_utf8);

/* Expands supported {{...}} variables and returns a UTF-8 string. */
char *melon_pan_template_expand(
    const char *body_utf8,
    const char *title_utf8,
    const char *author_utf8);

/* `parent_id_utf8` may be NULL to list under the user's root.
   Returns the count of items, or -1 on error. */
int64_t melon_pan_refresh_drive_tree(
    const char *access_token_utf8,
    const char *parent_id_utf8,
    const char *cache_root_utf8);

/* ---- auth ---- */

/* Returns the access token string on success, NULL on error. */
char *melon_pan_ensure_fresh_access_token(
    const char *credentials_path_utf8,
    const char *account_utf8,
    uint64_t leeway_seconds);

/* Saves a Desktop OAuth client in Keychain. `client_secret_utf8` may
   be NULL or empty. Returns 1 on success, 0 on failure. */
int32_t melon_pan_save_oauth_client_config(
    const char *client_id_utf8,
    const char *client_secret_utf8);

/* Same semantics as melon_pan_run_login, but reads the OAuth client
   from Keychain instead of credentials.json. */
char *melon_pan_run_login_with_saved_oauth_client(
    const char *account_override_utf8,
    int32_t narrow_scope,
    uint16_t port);

/* Refreshes an access token using the OAuth client saved in Keychain. */
char *melon_pan_ensure_fresh_access_token_with_saved_oauth_client(
    const char *account_utf8,
    uint64_t leeway_seconds);

/* Runs the full OAuth loopback dance end-to-end. Blocks until the
   user completes the browser flow (5 min timeout). `account_override`
   may be NULL to derive from the signed-in email. `port` may be 0 for
   an OS-chosen ephemeral port. Returns JSON-encoded LoginOutcome or
   NULL on error. */
char *melon_pan_run_login(
    const char *credentials_path_utf8,
    const char *account_override_utf8,
    int32_t narrow_scope,
    uint16_t port);

/* ---- system ---- */

int32_t melon_pan_open_url(const char *url_utf8);
char *melon_pan_token_lookup(const char *account_utf8);
char *melon_pan_token_metadata(const char *account_utf8);
char *melon_pan_keychain_probe(void);
char *melon_pan_runtime_versions(void);
char *melon_pan_diagnostic_snapshot(const char *cache_root_utf8);
char *melon_pan_audit_status(
    const char *cache_root_utf8,
    const char *document_id_utf8);
int32_t melon_pan_force_full_resync(
    const char *cache_root_utf8,
    const char *access_token_utf8);
int32_t melon_pan_clear_cached_drive_data(const char *cache_root_utf8);

/* Returns JSON UpdateStatus or NULL on error. `repo_utf8` may be NULL
   to use the default. Blocking — call from Task.detached. */
char *melon_pan_check_for_updates(
    const char *repo_utf8,
    const char *current_version_utf8);

/* Returns JSON array of every cached document id, or NULL on error. */
char *melon_pan_list_cached_document_ids(const char *cache_root_utf8);

/* Returns JSON array of documents with audit drift:
   [{ documentId, title }]. */
char *melon_pan_audit_drift_check(const char *cache_root_utf8);

/* Returns JSON object summarising one cached doc:
   { documentId, revisionId, title, bodyEndIndex, markdown }
   Used by tab restoration to rehydrate state offline. NULL when the
   doc has no current.md (bare directory). */
char *melon_pan_rehydrate_document(
    const char *cache_root_utf8,
    const char *document_id_utf8);

/* Returns JSON array for Spotlight indexing:
   [{ id, title, snippet, updatedAt }]. */
char *melon_pan_enumerate_cached_docs(const char *cache_root_utf8);

/* Returns JSON object summarising pending state for one doc:
   { documentId, pendingMutations: [paths], prePushSnapshots: [paths] }
   Always succeeds (empty arrays for missing dirs). */
char *melon_pan_doc_pending_summary(
    const char *cache_root_utf8,
    const char *document_id_utf8);

/* Reads up to `limit` newest events from <cache>/sync-journal.jsonl.
   Returns JSON array of HistoryEvent; "[]" when journal is missing. */
char *melon_pan_recent_sync_events(const char *cache_root_utf8, uint32_t limit);

/* Drops journal entries older than retain_days (0 = clear all).
   Returns 1 on success, 0 on failure. */
int32_t melon_pan_clear_journal(const char *cache_root_utf8, uint32_t retain_days);

/* Lists immutable post-pull snapshots for `document_id`.
   Returns JSON array of SnapshotInfo (kind=revision). */
char *melon_pan_list_revision_snapshots(
    const char *cache_root_utf8,
    const char *document_id_utf8);

/* Returns the MRU list, newest first, capped at 10. */
char *melon_pan_load_open_history(const char *config_root_utf8);

/* Records `entry` at the head of <config>/open-history, dedup'd. */
int32_t melon_pan_record_open_history(
    const char *config_root_utf8,
    const char *entry_utf8);

/* Restores a pre-push snapshot to current.md. Previous current.md
   is archived to trash before the restore. Returns 1 on success. */
int32_t melon_pan_restore_snapshot(
    const char *cache_root_utf8,
    const char *document_id_utf8,
    const char *snapshot_path_utf8);

/* Loads `current.docs.json` from cache, parses it to a RichDocument,
   and returns the Swift-shaped JSON serialization (paragraphs with
   stable RichNodeIds + named style + style flags). NULL on failure;
   caller frees with melon_pan_string_free. */
char *melon_pan_load_rich_document_for_swift(
    const char *cache_root_utf8,
    const char *document_id_utf8);

/* Appends a single operation envelope JSON line to
   <doc>/operation-log.jsonl. The wire format matches what
   rich_oplog::serialize_envelope produces. Returns 1 on success. */
int32_t melon_pan_append_operation_envelope(
    const char *cache_root_utf8,
    const char *document_id_utf8,
    const char *envelope_json_utf8);

/* Returns 1 when the doc's operation log has queued ops; 0 otherwise.
   Cheap check used to drive Save-button enabled state. */
int32_t melon_pan_has_pending_ops(
    const char *cache_root_utf8,
    const char *document_id_utf8);

/* Returns JSON-encoded ConflictReport after a revision-rejected pull. */
char *melon_pan_classify_conflict(
    const char *cache_root_utf8,
    const char *document_id_utf8);

/* Applies conflict decisions and returns JSON ConflictResolutionReport. */
char *melon_pan_resolve_conflict(
    const char *cache_root_utf8,
    const char *document_id_utf8,
    const char *resolution_json_utf8);

/* Archive + clear the operation log. Used by the revision-rejected
   recovery flow: the user picks "Discard local edits" and the queued
   ops are moved aside (operation-log.<ts>.jsonl) so editing resumes
   from the freshly pulled state. Returns 1 on success. */
int32_t melon_pan_discard_pending_ops(
    const char *cache_root_utf8,
    const char *document_id_utf8);

#ifdef __cplusplus
}
#endif

#endif /* MELON_PAN_MAC_FFI_H */
