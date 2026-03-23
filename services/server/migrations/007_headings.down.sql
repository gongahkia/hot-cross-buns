ALTER TABLE tasks DROP COLUMN IF EXISTS heading_id;
DROP INDEX IF EXISTS idx_headings_list_id;
DROP TABLE IF EXISTS headings;
