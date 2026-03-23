CREATE TABLE IF NOT EXISTS headings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list_id UUID NOT NULL REFERENCES lists(id),
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_headings_list_id ON headings(list_id);
ALTER TABLE tasks ADD COLUMN heading_id UUID REFERENCES headings(id);
