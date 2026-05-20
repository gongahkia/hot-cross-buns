# Phase 2 Sync Apply Pipeline

## Summary

- Requests partial Google API responses for task lists, tasks, calendar lists, and calendar events with `fields` selectors that retain pagination tokens, sync tokens, etags, timestamps, and UI-visible fields.
- Adds `SyncApplyResult` and `SyncChangeSet` so sync reports inserted, updated, deleted, and unchanged rows for task lists, tasks, calendars, events, and checkpoints.
- Carries affected calendar IDs, task list IDs, day keys, settings changes, and checkpoint changes through the sync result.
- Commits sync results through the SQLite cache in one transaction so checkpoints advance only after the related entity writes commit.
- Uses Google etags first, then stable row hashes, to skip unchanged rows and avoid downstream invalidation.

## Flow

1. Google fetches return narrowed payloads with enough fields for incremental merge and conflict detection.
2. `SyncScheduler.syncNowWithChangeSet` merges task/calendar incremental responses while preserving pending optimistic mutations and existing conflict behavior.
3. The scheduler compares touched rows against the base state to produce a `SyncChangeSet`.
4. `LocalCacheStore.commitSyncResult` writes the changed rows and checkpoints through `LocalCacheDatabaseStore.applySyncResult`.
5. `AppModel.apply(_:)` uses the change set to update only the changed in-memory slices and to avoid snapshot rebuilds for checkpoint-only or unchanged syncs.
6. Calendar prepared snapshots use day-scoped revision keys when the change set reports a narrow set of affected days.

## Tests

- `GoogleTasksClientTransportTests`
- `GoogleCalendarClientTransportTests`
- `CloudSyncControlTests`
- `LocalCacheDatabaseStoreTests`
- `LargeAccountCalendarPerformanceTests/testSyncSchedulerSmallIncrementalVsFullEventApplyBenchmark`
