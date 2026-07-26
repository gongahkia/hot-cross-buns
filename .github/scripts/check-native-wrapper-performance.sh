#!/usr/bin/env bash
set -euo pipefail

report_dir="$1"

jq --exit-status '
  .schemaVersion == 1 and
  .counts.tasks == 10000 and
  .counts.eventInstances == 25000 and
  .counts.notes == 2000 and
  .counts.recurrenceExceptions == 500 and
  .counts.queuedMutations == 500
' "$report_dir/wrapper-scale-fixture.json" >/dev/null

jq --exit-status '
  .schema_version == 1 and
  .launch.iterations == 1 and
  .launch.maximum_ms <= 8000 and
  .idle_rss.bytes > 0 and
  .idle_rss.bytes <= 1073741824
' "$report_dir/macos-cold.json" >/dev/null

jq --exit-status '
  .schema_version == 1 and
  .launch.iterations == 3 and
  .launch.median_ms <= 5000 and
  .idle_rss.bytes > 0 and
  .idle_rss.bytes <= 1073741824
' "$report_dir/macos-warm.json" >/dev/null

jq --exit-status '
  .schema_version == 1 and
  .corpus_task_count == 10000 and
  .median_ns <= 100000000
' "$report_dir/local-search.json" >/dev/null

jq --exit-status '
  .schema_version == 1 and
  .task_count == 10000 and
  .first_cached_render_ns <= 1200000000 and
  .bulk_selection.median_ns <= 100000000 and
  .maximum_ns <= 100000000
' "$report_dir/task-scroll.json" >/dev/null

jq --exit-status '
  .schema_version == 1 and
  .event_count == 25000 and
  .median_ns <= 250000000 and
  .maximum_ns <= 500000000
' "$report_dir/calendar-navigation.json" >/dev/null

jq --exit-status '
  .schema_version == 1 and
  .task_count == 10000 and
  .event_count == 25000 and
  .recurrence_exception_count == 500 and
  .queued_mutation_count == 500 and
  .elapsed_ns <= 45000000000
' "$report_dir/sync-apply.json" >/dev/null
