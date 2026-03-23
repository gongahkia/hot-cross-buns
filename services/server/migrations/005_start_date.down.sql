DROP INDEX IF EXISTS idx_tasks_start;
ALTER TABLE tasks DROP COLUMN IF EXISTS start_date;
