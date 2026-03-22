package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gongahkia/tickclone-server/internal/models"
)

type TaskRepository struct{}

func NewTaskRepository() *TaskRepository {
	return &TaskRepository{}
}

// CreateTask inserts a new task. If parent_task_id is set, it validates that the
// parent is not itself a subtask (depth <= 1).
func (r *TaskRepository) CreateTask(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, task *models.Task) error {
	if task.ParentTaskID != nil {
		var parentParentID *uuid.UUID
		err := pool.QueryRow(ctx,
			`SELECT parent_task_id FROM tasks
			 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
			task.ParentTaskID, userID,
		).Scan(&parentParentID)
		if err != nil {
			if err == pgx.ErrNoRows {
				return fmt.Errorf("parent task not found")
			}
			return fmt.Errorf("check parent task: %w", err)
		}
		if parentParentID != nil {
			return fmt.Errorf("cannot nest subtasks more than one level deep")
		}
	}

	task.ID = uuid.New()
	task.UserID = userID
	task.CreatedAt = time.Now().UTC()
	task.UpdatedAt = task.CreatedAt

	_, err := pool.Exec(ctx,
		`INSERT INTO tasks (id, user_id, list_id, parent_task_id, title, content,
		 priority, status, due_date, due_timezone, recurrence_rule, sort_order,
		 completed_at, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		task.ID, task.UserID, task.ListID, task.ParentTaskID, task.Title, task.Content,
		task.Priority, task.Status, task.DueDate, task.DueTimezone, task.RecurrenceRule,
		task.SortOrder, task.CompletedAt, task.CreatedAt, task.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert task: %w", err)
	}

	return nil
}

// GetTasksByList returns top-level tasks for a list with nested subtasks and tags.
func (r *TaskRepository) GetTasksByList(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, listID uuid.UUID, includeCompleted bool) ([]models.Task, error) {
	statusFilter := ""
	if !includeCompleted {
		statusFilter = " AND t.status = 0"
	}

	query := fmt.Sprintf(`
		SELECT t.id, t.user_id, t.list_id, t.parent_task_id, t.title, t.content,
		       t.priority, t.status, t.due_date, t.due_timezone, t.recurrence_rule,
		       t.sort_order, t.completed_at, t.created_at, t.updated_at, t.deleted_at
		FROM tasks t
		WHERE t.user_id = $1 AND t.list_id = $2 AND t.parent_task_id IS NULL
		      AND t.deleted_at IS NULL%s
		ORDER BY t.sort_order, t.created_at`, statusFilter)

	rows, err := pool.Query(ctx, query, userID, listID)
	if err != nil {
		return nil, fmt.Errorf("query tasks: %w", err)
	}
	defer rows.Close()

	var tasks []models.Task
	for rows.Next() {
		var t models.Task
		if err := scanTask(rows, &t); err != nil {
			return nil, fmt.Errorf("scan task: %w", err)
		}
		tasks = append(tasks, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tasks: %w", err)
	}

	for i := range tasks {
		subtasks, err := r.getSubtasks(ctx, pool, userID, tasks[i].ID, includeCompleted)
		if err != nil {
			return nil, err
		}
		tasks[i].Subtasks = subtasks

		tags, err := r.getTaskTags(ctx, pool, tasks[i].ID)
		if err != nil {
			return nil, err
		}
		tasks[i].Tags = tags
	}

	return tasks, nil
}

// GetTaskByID returns a single task with its subtasks and tags.
func (r *TaskRepository) GetTaskByID(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, taskID uuid.UUID) (*models.Task, error) {
	row := pool.QueryRow(ctx, `
		SELECT t.id, t.user_id, t.list_id, t.parent_task_id, t.title, t.content,
		       t.priority, t.status, t.due_date, t.due_timezone, t.recurrence_rule,
		       t.sort_order, t.completed_at, t.created_at, t.updated_at, t.deleted_at
		FROM tasks t
		WHERE t.id = $1 AND t.user_id = $2 AND t.deleted_at IS NULL`, taskID, userID)

	var t models.Task
	err := row.Scan(
		&t.ID, &t.UserID, &t.ListID, &t.ParentTaskID, &t.Title, &t.Content,
		&t.Priority, &t.Status, &t.DueDate, &t.DueTimezone, &t.RecurrenceRule,
		&t.SortOrder, &t.CompletedAt, &t.CreatedAt, &t.UpdatedAt, &t.DeletedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("query task: %w", err)
	}

	subtasks, err := r.getSubtasks(ctx, pool, userID, t.ID, true)
	if err != nil {
		return nil, err
	}
	t.Subtasks = subtasks

	tags, err := r.getTaskTags(ctx, pool, t.ID)
	if err != nil {
		return nil, err
	}
	t.Tags = tags

	return &t, nil
}

// UpdateTask partially updates a task. If status is changed to 1 (completed),
// completed_at is set automatically. Returns the updated task.
func (r *TaskRepository) UpdateTask(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, taskID uuid.UUID, fields map[string]interface{}) (*models.Task, error) {
	if len(fields) == 0 {
		return r.GetTaskByID(ctx, pool, userID, taskID)
	}

	// Auto-set completed_at when status changes
	if status, ok := fields["status"]; ok {
		if statusInt, ok := status.(int); ok && statusInt == 1 {
			if _, exists := fields["completed_at"]; !exists {
				now := time.Now().UTC()
				fields["completed_at"] = now
			}
		} else if statusInt, ok := status.(int); ok && statusInt == 0 {
			fields["completed_at"] = nil
		}
	}

	fields["updated_at"] = time.Now().UTC()

	setClauses := make([]string, 0, len(fields))
	args := make([]interface{}, 0, len(fields)+2)
	argIdx := 1

	for col, val := range fields {
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", col, argIdx))
		args = append(args, val)
		argIdx++
	}

	args = append(args, taskID, userID)

	query := fmt.Sprintf(
		`UPDATE tasks SET %s WHERE id = $%d AND user_id = $%d AND deleted_at IS NULL`,
		strings.Join(setClauses, ", "), argIdx, argIdx+1,
	)

	tag, err := pool.Exec(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("update task: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, nil
	}

	return r.GetTaskByID(ctx, pool, userID, taskID)
}

// DeleteTask performs a soft delete on a task and all of its subtasks.
func (r *TaskRepository) DeleteTask(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, taskID uuid.UUID) error {
	now := time.Now().UTC()

	// Soft-delete subtasks first
	_, err := pool.Exec(ctx,
		`UPDATE tasks SET deleted_at = $1, updated_at = $1
		 WHERE parent_task_id = $2 AND user_id = $3 AND deleted_at IS NULL`,
		now, taskID, userID,
	)
	if err != nil {
		return fmt.Errorf("soft delete subtasks: %w", err)
	}

	// Soft-delete the task itself
	tag, err := pool.Exec(ctx,
		`UPDATE tasks SET deleted_at = $1, updated_at = $1
		 WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL`,
		now, taskID, userID,
	)
	if err != nil {
		return fmt.Errorf("soft delete task: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("task not found")
	}

	return nil
}

// MoveTask moves a task to a different list and/or sort position.
func (r *TaskRepository) MoveTask(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, taskID uuid.UUID, newListID uuid.UUID, newSortOrder int) error {
	now := time.Now().UTC()
	tag, err := pool.Exec(ctx,
		`UPDATE tasks SET list_id = $1, sort_order = $2, updated_at = $3
		 WHERE id = $4 AND user_id = $5 AND deleted_at IS NULL`,
		newListID, newSortOrder, now, taskID, userID,
	)
	if err != nil {
		return fmt.Errorf("move task: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("task not found")
	}

	// Also move subtasks to the same list
	_, err = pool.Exec(ctx,
		`UPDATE tasks SET list_id = $1, updated_at = $2
		 WHERE parent_task_id = $3 AND user_id = $4 AND deleted_at IS NULL`,
		newListID, now, taskID, userID,
	)
	if err != nil {
		return fmt.Errorf("move subtasks: %w", err)
	}

	return nil
}

// getSubtasks fetches child tasks for a given parent.
func (r *TaskRepository) getSubtasks(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, parentID uuid.UUID, includeCompleted bool) ([]models.Task, error) {
	statusFilter := ""
	if !includeCompleted {
		statusFilter = " AND t.status = 0"
	}

	query := fmt.Sprintf(`
		SELECT t.id, t.user_id, t.list_id, t.parent_task_id, t.title, t.content,
		       t.priority, t.status, t.due_date, t.due_timezone, t.recurrence_rule,
		       t.sort_order, t.completed_at, t.created_at, t.updated_at, t.deleted_at
		FROM tasks t
		WHERE t.parent_task_id = $1 AND t.user_id = $2 AND t.deleted_at IS NULL%s
		ORDER BY t.sort_order, t.created_at`, statusFilter)

	rows, err := pool.Query(ctx, query, parentID, userID)
	if err != nil {
		return nil, fmt.Errorf("query subtasks: %w", err)
	}
	defer rows.Close()

	var subtasks []models.Task
	for rows.Next() {
		var st models.Task
		if err := scanTask(rows, &st); err != nil {
			return nil, fmt.Errorf("scan subtask: %w", err)
		}
		st.Subtasks = []models.Task{}

		tags, err := r.getTaskTags(ctx, pool, st.ID)
		if err != nil {
			return nil, err
		}
		st.Tags = tags

		subtasks = append(subtasks, st)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate subtasks: %w", err)
	}

	if subtasks == nil {
		subtasks = []models.Task{}
	}

	return subtasks, nil
}

// getTaskTags fetches tags associated with a task.
func (r *TaskRepository) getTaskTags(ctx context.Context, pool *pgxpool.Pool, taskID uuid.UUID) ([]models.Tag, error) {
	rows, err := pool.Query(ctx, `
		SELECT tg.id, tg.user_id, tg.name, tg.color, tg.created_at
		FROM tags tg
		JOIN task_tags tt ON tt.tag_id = tg.id
		WHERE tt.task_id = $1`, taskID)
	if err != nil {
		return nil, fmt.Errorf("query task tags: %w", err)
	}
	defer rows.Close()

	var tags []models.Tag
	for rows.Next() {
		var tag models.Tag
		if err := rows.Scan(&tag.ID, &tag.UserID, &tag.Name, &tag.Color, &tag.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan tag: %w", err)
		}
		tags = append(tags, tag)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tags: %w", err)
	}

	if tags == nil {
		tags = []models.Tag{}
	}

	return tags, nil
}

// scanTask scans a task row into a Task struct.
func scanTask(rows pgx.Rows, t *models.Task) error {
	return rows.Scan(
		&t.ID, &t.UserID, &t.ListID, &t.ParentTaskID, &t.Title, &t.Content,
		&t.Priority, &t.Status, &t.DueDate, &t.DueTimezone, &t.RecurrenceRule,
		&t.SortOrder, &t.CompletedAt, &t.CreatedAt, &t.UpdatedAt, &t.DeletedAt,
	)
}
