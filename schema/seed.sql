-- Cross 2 seed data for development and testing

-- Lists
INSERT INTO lists (id, name, color, sort_order, is_inbox, created_at, updated_at) VALUES
    ('019513a4-7e2b-7000-8000-000000000001', 'Inbox', NULL, 0, 1, '2026-03-20T10:00:00Z', '2026-03-20T10:00:00Z'),
    ('019513a4-7e2b-7000-8000-000000000002', 'Work', '#89b4fa', 1, 0, '2026-03-20T10:00:00Z', '2026-03-20T10:00:00Z'),
    ('019513a4-7e2b-7000-8000-000000000003', 'Personal', '#a6e3a1', 2, 0, '2026-03-20T10:00:00Z', '2026-03-20T10:00:00Z');

-- Tasks (10 total, distributed across lists)
-- Inbox tasks
INSERT INTO tasks (id, list_id, parent_task_id, title, content, priority, status, due_date, due_timezone, recurrence_rule, sort_order, completed_at, created_at, updated_at) VALUES
    ('019513a4-7e2b-7000-8000-000000000010', '019513a4-7e2b-7000-8000-000000000001', NULL, 'Buy groceries', '- Milk\n- Eggs\n- Bread', 2, 0, '2026-03-23T17:00:00Z', 'Asia/Singapore', NULL, 0, NULL, '2026-03-20T10:00:00Z', '2026-03-20T10:00:00Z'),
    ('019513a4-7e2b-7000-8000-000000000011', '019513a4-7e2b-7000-8000-000000000001', '019513a4-7e2b-7000-8000-000000000010', 'Get milk', NULL, 0, 0, NULL, NULL, NULL, 0, NULL, '2026-03-20T10:00:00Z', '2026-03-20T10:00:00Z'),
    ('019513a4-7e2b-7000-8000-000000000012', '019513a4-7e2b-7000-8000-000000000001', '019513a4-7e2b-7000-8000-000000000010', 'Get eggs', NULL, 0, 1, NULL, NULL, NULL, 1, '2026-03-21T09:00:00Z', '2026-03-20T10:00:00Z', '2026-03-21T09:00:00Z');

-- Work tasks
INSERT INTO tasks (id, list_id, parent_task_id, title, content, priority, status, due_date, due_timezone, recurrence_rule, sort_order, completed_at, created_at, updated_at) VALUES
    ('019513a4-7e2b-7000-8000-000000000013', '019513a4-7e2b-7000-8000-000000000002', NULL, 'Review pull requests', 'Check all open PRs in the main repo', 3, 0, '2026-03-22T12:00:00Z', 'Asia/Singapore', NULL, 0, NULL, '2026-03-20T10:00:00Z', '2026-03-20T10:00:00Z'),
    ('019513a4-7e2b-7000-8000-000000000014', '019513a4-7e2b-7000-8000-000000000002', NULL, 'Daily standup', 'Update the team on progress', 1, 0, '2026-03-22T09:00:00Z', 'Asia/Singapore', 'FREQ=DAILY;INTERVAL=1', 1, NULL, '2026-03-20T10:00:00Z', '2026-03-20T10:00:00Z'),
    ('019513a4-7e2b-7000-8000-000000000015', '019513a4-7e2b-7000-8000-000000000002', NULL, 'Write architecture doc', NULL, 2, 1, '2026-03-19T18:00:00Z', 'Asia/Singapore', NULL, 2, '2026-03-19T16:00:00Z', '2026-03-18T10:00:00Z', '2026-03-19T16:00:00Z'),
    ('019513a4-7e2b-7000-8000-000000000016', '019513a4-7e2b-7000-8000-000000000002', NULL, 'Fix login bug', 'Users report intermittent 401 errors', 3, 0, '2026-03-21T12:00:00Z', 'Asia/Singapore', NULL, 3, NULL, '2026-03-20T10:00:00Z', '2026-03-20T10:00:00Z'),
    ('019513a4-7e2b-7000-8000-000000000017', '019513a4-7e2b-7000-8000-000000000002', '019513a4-7e2b-7000-8000-000000000016', 'Reproduce the issue locally', NULL, 0, 0, NULL, NULL, NULL, 0, NULL, '2026-03-20T10:00:00Z', '2026-03-20T10:00:00Z');

-- Personal tasks
INSERT INTO tasks (id, list_id, parent_task_id, title, content, priority, status, due_date, due_timezone, recurrence_rule, sort_order, completed_at, created_at, updated_at) VALUES
    ('019513a4-7e2b-7000-8000-000000000018', '019513a4-7e2b-7000-8000-000000000003', NULL, 'Read chapter 5', 'Designing Data-Intensive Applications', 1, 0, '2026-03-25T21:00:00Z', 'Asia/Singapore', NULL, 0, NULL, '2026-03-20T10:00:00Z', '2026-03-20T10:00:00Z'),
    ('019513a4-7e2b-7000-8000-000000000019', '019513a4-7e2b-7000-8000-000000000003', NULL, 'Call dentist', NULL, 0, 0, '2026-03-24T10:00:00Z', 'Asia/Singapore', NULL, 1, NULL, '2026-03-20T10:00:00Z', '2026-03-20T10:00:00Z');

-- Tags
INSERT INTO tags (id, name, color, created_at) VALUES
    ('019513a4-7e2b-7000-8000-000000000020', 'urgent', '#f38ba8', '2026-03-20T10:00:00Z'),
    ('019513a4-7e2b-7000-8000-000000000021', 'errand', '#fab387', '2026-03-20T10:00:00Z'),
    ('019513a4-7e2b-7000-8000-000000000022', 'review', '#89b4fa', '2026-03-20T10:00:00Z'),
    ('019513a4-7e2b-7000-8000-000000000023', 'idea', '#cba6f7', '2026-03-20T10:00:00Z');

-- Task-Tag associations (6 total)
INSERT INTO task_tags (task_id, tag_id) VALUES
    ('019513a4-7e2b-7000-8000-000000000010', '019513a4-7e2b-7000-8000-000000000021'),
    ('019513a4-7e2b-7000-8000-000000000013', '019513a4-7e2b-7000-8000-000000000022'),
    ('019513a4-7e2b-7000-8000-000000000013', '019513a4-7e2b-7000-8000-000000000020'),
    ('019513a4-7e2b-7000-8000-000000000016', '019513a4-7e2b-7000-8000-000000000020'),
    ('019513a4-7e2b-7000-8000-000000000014', '019513a4-7e2b-7000-8000-000000000022'),
    ('019513a4-7e2b-7000-8000-000000000018', '019513a4-7e2b-7000-8000-000000000023');
