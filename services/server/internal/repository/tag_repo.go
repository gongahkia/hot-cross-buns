package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gongahkia/tickclone-server/internal/models"
)

// TagRepository provides CRUD operations for tags and task-tag associations.
type TagRepository struct{}

// CreateTag inserts a new tag for the given user.
func (r *TagRepository) CreateTag(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, tag *models.Tag) error {
	tag.ID = uuid.New()
	tag.UserID = userID

	_, err := pool.Exec(ctx,
		`INSERT INTO tags (id, user_id, name, color)
		 VALUES ($1, $2, $3, $4)`,
		tag.ID, tag.UserID, tag.Name, tag.Color,
	)
	if err != nil {
		return fmt.Errorf("insert tag: %w", err)
	}

	// Re-read so CreatedAt is set by the database default.
	row := pool.QueryRow(ctx,
		`SELECT created_at FROM tags WHERE id = $1`,
		tag.ID,
	)
	if err := row.Scan(&tag.CreatedAt); err != nil {
		return fmt.Errorf("read created_at: %w", err)
	}

	return nil
}

// GetTagsByUser returns every tag owned by the given user.
func (r *TagRepository) GetTagsByUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) ([]models.Tag, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, user_id, name, color, created_at
		 FROM tags
		 WHERE user_id = $1 AND deleted_at IS NULL
		 ORDER BY created_at`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("query tags: %w", err)
	}
	defer rows.Close()

	var tags []models.Tag
	for rows.Next() {
		var t models.Tag
		if err := rows.Scan(&t.ID, &t.UserID, &t.Name, &t.Color, &t.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan tag: %w", err)
		}
		tags = append(tags, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tags: %w", err)
	}

	return tags, nil
}

// UpdateTag patches the name and/or color of an existing tag. Only non-nil
// fields are applied. The updated tag is returned.
func (r *TagRepository) UpdateTag(
	ctx context.Context,
	pool *pgxpool.Pool,
	userID uuid.UUID,
	tagID uuid.UUID,
	name *string,
	color *string,
) (*models.Tag, error) {
	// Build a dynamic update. At least one field must be provided.
	if name == nil && color == nil {
		// Nothing to update — just return the current row.
		return r.getTag(ctx, pool, userID, tagID)
	}

	// Use COALESCE-style conditional update so we only touch supplied fields.
	row := pool.QueryRow(ctx,
		`UPDATE tags
		 SET name  = COALESCE($3, name),
		     color = CASE WHEN $4::boolean THEN $5 ELSE color END
		 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
		 RETURNING id, user_id, name, color, created_at`,
		tagID, userID, name, color != nil, color,
	)

	var t models.Tag
	if err := row.Scan(&t.ID, &t.UserID, &t.Name, &t.Color, &t.CreatedAt); err != nil {
		return nil, fmt.Errorf("update tag: %w", err)
	}
	return &t, nil
}

// DeleteTag soft-deletes a tag and removes its task_tags associations.
func (r *TagRepository) DeleteTag(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, tagID uuid.UUID) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx,
		`DELETE FROM task_tags WHERE tag_id = $1 AND user_id = $2`,
		tagID, userID,
	); err != nil {
		return fmt.Errorf("delete task_tags: %w", err)
	}

	ct, err := tx.Exec(ctx,
		`UPDATE tags SET deleted_at = $3 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
		tagID, userID, time.Now().UTC(),
	)
	if err != nil {
		return fmt.Errorf("soft delete tag: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("tag not found")
	}

	return tx.Commit(ctx)
}

// AddTagToTask associates a tag with a task. If the association already exists
// the call is a no-op.
func (r *TagRepository) AddTagToTask(
	ctx context.Context,
	pool *pgxpool.Pool,
	userID uuid.UUID,
	taskID uuid.UUID,
	tagID uuid.UUID,
) error {
	_, err := pool.Exec(ctx,
		`INSERT INTO task_tags (task_id, tag_id, user_id)
		 VALUES ($1, $2, $3)
		 ON CONFLICT DO NOTHING`,
		taskID, tagID, userID,
	)
	if err != nil {
		return fmt.Errorf("add tag to task: %w", err)
	}
	return nil
}

// RemoveTagFromTask removes the association between a tag and a task.
func (r *TagRepository) RemoveTagFromTask(
	ctx context.Context,
	pool *pgxpool.Pool,
	userID uuid.UUID,
	taskID uuid.UUID,
	tagID uuid.UUID,
) error {
	_, err := pool.Exec(ctx,
		`DELETE FROM task_tags
		 WHERE task_id = $1 AND tag_id = $2 AND user_id = $3`,
		taskID, tagID, userID,
	)
	if err != nil {
		return fmt.Errorf("remove tag from task: %w", err)
	}
	return nil
}

// GetTasksByTag returns all tasks that carry the given tag.
func (r *TagRepository) GetTasksByTag(
	ctx context.Context,
	pool *pgxpool.Pool,
	userID uuid.UUID,
	tagID uuid.UUID,
) ([]models.Task, error) {
	rows, err := pool.Query(ctx,
		`SELECT t.id, t.user_id, t.list_id, t.parent_task_id, t.title,
		        t.content, t.priority, t.status, t.due_date, t.due_timezone,
		        t.recurrence_rule, t.sort_order, t.completed_at,
		        t.created_at, t.updated_at, t.deleted_at
		 FROM tasks t
		 JOIN task_tags tt ON tt.task_id = t.id
		 JOIN tags tg ON tg.id = tt.tag_id
		 WHERE tt.tag_id = $1 AND tt.user_id = $2 AND t.deleted_at IS NULL AND tg.deleted_at IS NULL
		 ORDER BY t.sort_order, t.created_at`,
		tagID, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("query tasks by tag: %w", err)
	}
	defer rows.Close()

	var tasks []models.Task
	for rows.Next() {
		var task models.Task
		if err := rows.Scan(
			&task.ID, &task.UserID, &task.ListID, &task.ParentTaskID,
			&task.Title, &task.Content, &task.Priority, &task.Status,
			&task.DueDate, &task.DueTimezone, &task.RecurrenceRule,
			&task.SortOrder, &task.CompletedAt,
			&task.CreatedAt, &task.UpdatedAt, &task.DeletedAt,
		); err != nil {
			return nil, fmt.Errorf("scan task: %w", err)
		}
		tasks = append(tasks, task)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tasks: %w", err)
	}

	return tasks, nil
}

// getTag is a helper that fetches a single tag by ID and owner.
func (r *TagRepository) getTag(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, tagID uuid.UUID) (*models.Tag, error) {
	row := pool.QueryRow(ctx,
		`SELECT id, user_id, name, color, created_at
		 FROM tags
		 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
		tagID, userID,
	)
	var t models.Tag
	if err := row.Scan(&t.ID, &t.UserID, &t.Name, &t.Color, &t.CreatedAt); err != nil {
		return nil, fmt.Errorf("get tag: %w", err)
	}
	return &t, nil
}
