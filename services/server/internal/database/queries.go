package database

// Queries holds prepared query strings for the 10 most-used queries in the
// application. These are kept as constants so that calling code does not
// hard-code SQL strings and so that they can be shared between the repository
// layer and any future prepared-statement cache.
//
// Pool configuration (max_conns=20, min_conns=5) is handled in pool.go.
type Queries struct {
	// List queries
	GetListsByUser string
	GetListByID    string
	CreateList     string
	UpdateList     string
	DeleteList     string

	// Task queries
	GetTasksByList string
	GetTaskByID    string
	CreateTask     string
	UpdateTask     string
	DeleteTask     string
}

// NewQueries returns a Queries struct pre-populated with the canonical SQL
// strings used throughout the application.
func NewQueries() *Queries {
	return &Queries{
		GetListsByUser: `
			SELECT id, user_id, name, color, sort_order, is_inbox, created_at, updated_at, deleted_at
			FROM lists
			WHERE user_id = $1 AND deleted_at IS NULL
			ORDER BY sort_order, created_at`,

		GetListByID: `
			SELECT id, user_id, name, color, sort_order, is_inbox, created_at, updated_at, deleted_at
			FROM lists
			WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,

		CreateList: `
			INSERT INTO lists (user_id, name, color, sort_order, is_inbox)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id, user_id, name, color, sort_order, is_inbox, created_at, updated_at, deleted_at`,

		UpdateList: `
			UPDATE lists
			SET name = COALESCE($1, name),
			    color = COALESCE($2, color),
			    sort_order = COALESCE($3, sort_order),
			    updated_at = now()
			WHERE id = $4 AND user_id = $5 AND deleted_at IS NULL
			RETURNING id, user_id, name, color, sort_order, is_inbox, created_at, updated_at, deleted_at`,

		DeleteList: `
			UPDATE lists SET deleted_at = now(), updated_at = now()
			WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,

		GetTasksByList: `
			SELECT id, user_id, list_id, parent_task_id, title, content, priority, status,
			       due_date, due_timezone, recurrence_rule, sort_order,
			       completed_at, created_at, updated_at, deleted_at
			FROM tasks
			WHERE list_id = $1 AND user_id = $2 AND parent_task_id IS NULL AND deleted_at IS NULL
			ORDER BY sort_order`,

		GetTaskByID: `
			SELECT id, user_id, list_id, parent_task_id, title, content, priority, status,
			       due_date, due_timezone, recurrence_rule, sort_order,
			       completed_at, created_at, updated_at, deleted_at
			FROM tasks
			WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,

		CreateTask: `
			INSERT INTO tasks (user_id, list_id, parent_task_id, title, content, priority, status,
			                   due_date, due_timezone, recurrence_rule, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10)
			RETURNING id, user_id, list_id, parent_task_id, title, content, priority, status,
			          due_date, due_timezone, recurrence_rule, sort_order,
			          completed_at, created_at, updated_at, deleted_at`,

		UpdateTask: `
			UPDATE tasks
			SET title = COALESCE($1, title),
			    content = COALESCE($2, content),
			    priority = COALESCE($3, priority),
			    status = COALESCE($4, status),
			    updated_at = now()
			WHERE id = $5 AND user_id = $6 AND deleted_at IS NULL
			RETURNING id, user_id, list_id, parent_task_id, title, content, priority, status,
			          due_date, due_timezone, recurrence_rule, sort_order,
			          completed_at, created_at, updated_at, deleted_at`,

		DeleteTask: `
			UPDATE tasks SET deleted_at = now(), updated_at = now()
			WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
	}
}
