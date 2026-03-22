-- Additional indexes for sync performance and common query patterns

-- Composite index for sync queries filtered by user + device + time range
CREATE INDEX IF NOT EXISTS idx_sync_log_user_device ON sync_log(user_id, device_id, timestamp);

-- Index on batch_id added in migration 002
CREATE INDEX IF NOT EXISTS idx_sync_log_batch ON sync_log(batch_id);

-- Composite index for listing non-deleted tasks per user
CREATE INDEX IF NOT EXISTS idx_tasks_user_deleted ON tasks(user_id, deleted_at);

-- Composite index for listing non-deleted lists per user
CREATE INDEX IF NOT EXISTS idx_lists_user_deleted ON lists(user_id, deleted_at);

-- Index for cleaning up expired magic links
CREATE INDEX IF NOT EXISTS idx_magic_links_expires ON magic_links(expires_at);
