ALTER TABLE tasks ADD COLUMN start_date TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_tasks_start ON tasks(start_date);
