package services

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/teambition/rrule-go"

	"github.com/gongahkia/tickclone-server/internal/models"
)

// ExpandRecurrence parses an RRULE string and returns the next `limit`
// occurrences that fall strictly after `after`. If limit <= 0 it defaults to 10.
func ExpandRecurrence(rule string, dtstart time.Time, after time.Time, limit int) ([]time.Time, error) {
	if limit <= 0 {
		limit = 10
	}

	opt, err := rrule.StrToROption(rule)
	if err != nil {
		return nil, fmt.Errorf("parse rrule: %w", err)
	}
	opt.Dtstart = dtstart

	r, err := rrule.NewRRule(*opt)
	if err != nil {
		return nil, fmt.Errorf("create rrule: %w", err)
	}

	// Get occurrences between (after, after + 10 years) capped at limit.
	horizon := after.AddDate(10, 0, 0)
	all := r.Between(after, horizon, false) // false = exclude exact match on after

	if len(all) > limit {
		all = all[:limit]
	}

	return all, nil
}

// CompleteRecurringTask marks the current task as completed and, if it has a
// recurrence rule, creates the next occurrence as a new task.
//
// Returns (completed, nextTask, error). nextTask is nil when there is no
// further occurrence.
func CompleteRecurringTask(ctx context.Context, pool *pgxpool.Pool, userID, taskID uuid.UUID) (*models.Task, *models.Task, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Fetch the task.
	var task models.Task
	err = tx.QueryRow(ctx, `
		SELECT id, user_id, list_id, parent_task_id, title, content,
		       priority, status, due_date, due_timezone, recurrence_rule,
		       sort_order, completed_at, created_at, updated_at, deleted_at
		FROM tasks
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
		taskID, userID,
	).Scan(
		&task.ID, &task.UserID, &task.ListID, &task.ParentTaskID, &task.Title, &task.Content,
		&task.Priority, &task.Status, &task.DueDate, &task.DueTimezone, &task.RecurrenceRule,
		&task.SortOrder, &task.CompletedAt, &task.CreatedAt, &task.UpdatedAt, &task.DeletedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil, fmt.Errorf("task not found")
		}
		return nil, nil, fmt.Errorf("fetch task: %w", err)
	}

	if task.RecurrenceRule == nil || *task.RecurrenceRule == "" {
		return nil, nil, fmt.Errorf("task has no recurrence rule")
	}

	// Mark current task as completed.
	now := time.Now().UTC()
	_, err = tx.Exec(ctx, `
		UPDATE tasks SET status = 1, completed_at = $1, updated_at = $1
		WHERE id = $2 AND user_id = $3`,
		now, taskID, userID,
	)
	if err != nil {
		return nil, nil, fmt.Errorf("complete task: %w", err)
	}
	task.Status = 1
	task.CompletedAt = &now
	task.UpdatedAt = now

	// Compute the next occurrence.
	dtstart := now
	if task.DueDate != nil {
		dtstart = *task.DueDate
	}

	occurrences, err := ExpandRecurrence(*task.RecurrenceRule, dtstart, now, 1)
	if err != nil {
		return nil, nil, fmt.Errorf("expand recurrence: %w", err)
	}

	if len(occurrences) == 0 {
		if err := tx.Commit(ctx); err != nil {
			return nil, nil, fmt.Errorf("commit tx: %w", err)
		}
		return &task, nil, nil
	}

	// Create next task (clone with new id, status=0, next due_date).
	nextDue := occurrences[0]
	nextTask := models.Task{
		ID:             uuid.New(),
		UserID:         task.UserID,
		ListID:         task.ListID,
		ParentTaskID:   task.ParentTaskID,
		Title:          task.Title,
		Content:        task.Content,
		Priority:       task.Priority,
		Status:         0,
		DueDate:        &nextDue,
		DueTimezone:    task.DueTimezone,
		RecurrenceRule: task.RecurrenceRule,
		SortOrder:      task.SortOrder,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO tasks (id, user_id, list_id, parent_task_id, title, content,
		       priority, status, due_date, due_timezone, recurrence_rule, sort_order,
		       completed_at, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		nextTask.ID, nextTask.UserID, nextTask.ListID, nextTask.ParentTaskID,
		nextTask.Title, nextTask.Content, nextTask.Priority, nextTask.Status,
		nextTask.DueDate, nextTask.DueTimezone, nextTask.RecurrenceRule,
		nextTask.SortOrder, nextTask.CompletedAt, nextTask.CreatedAt, nextTask.UpdatedAt,
	)
	if err != nil {
		return nil, nil, fmt.Errorf("insert next task: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("commit tx: %w", err)
	}

	return &task, &nextTask, nil
}
