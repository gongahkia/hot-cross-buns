#!/usr/bin/env bash
set -euo pipefail

attestation_path="$1"

jq --exit-status '
  .schema_version == 1 and
  .platform == "macos" and
  .attestation_status == "accepted" and
  .redacted == true and
  (.evidence.candidate_commit | type == "string" and length > 0) and
  (.evidence.package_version | type == "string" and length > 0) and
  (.evidence.macos_version | type == "string" and length > 0) and
  (.evidence.architecture | type == "string" and length > 0) and
  (.evidence.executed_at_utc | type == "string" and length > 0) and
  (.checks.oauth_initial_and_delta_pull.status == "passed") and
  (.checks.task_lists_and_task_writes.status == "passed") and
  (.checks.notes_projection.status == "passed") and
  (.checks.task_recurrence.status == "passed") and
  (.checks.calendar_recurrence_and_exception.status == "passed") and
  (.checks.bulk_mutations_and_search.status == "passed") and
  (.checks.offline_write_and_restart_recovery.status == "passed") and
  (.checks.conflict_prefer_google.status == "passed") and
  (.checks.conflict_prefer_hcb.status == "passed") and
  (.checks.conflict_ask_each_time.status == "passed") and
  (.checks.revoked_or_expired_authorization.status == "passed") and
  (.checks.network_loss_and_recovery.status == "passed") and
  (.checks.quota_retry.status == "passed" and .checks.quota_retry.evidence_type == "automated") and
  (.checks.invalid_calendar_sync_token.status == "passed" and .checks.invalid_calendar_sync_token.evidence_type == "automated")
' "$attestation_path" >/dev/null
