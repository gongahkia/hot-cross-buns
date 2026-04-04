package services

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gongahkia/hot-cross-buns-server/internal/models"
)

type syncedListPayload struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Color     *string `json:"color"`
	SortOrder int     `json:"sortOrder"`
	IsInbox   bool    `json:"isInbox"`
	CreatedAt string  `json:"createdAt"`
	UpdatedAt string  `json:"updatedAt"`
	DeletedAt *string `json:"deletedAt"`
}

type syncedTaskPayload struct {
	ID             string  `json:"id"`
	ListID         string  `json:"listId"`
	ParentTaskID   *string `json:"parentTaskId"`
	Title          string  `json:"title"`
	Content        *string `json:"content"`
	Priority       int     `json:"priority"`
	Status         int     `json:"status"`
	DueDate        *string `json:"dueDate"`
	DueTimezone    *string `json:"dueTimezone"`
	RecurrenceRule *string `json:"recurrenceRule"`
	SortOrder      int     `json:"sortOrder"`
	CompletedAt    *string `json:"completedAt"`
	CreatedAt      string  `json:"createdAt"`
	UpdatedAt      string  `json:"updatedAt"`
	DeletedAt      *string `json:"deletedAt"`
}

type syncedTagPayload struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Color     *string `json:"color"`
	CreatedAt string  `json:"createdAt"`
	DeletedAt *string `json:"deletedAt"`
}

// PushChanges applies a batch of change records atomically within a single
// database transaction (Task 13 - batch transaction support). For each change
// it checks the sync_log for a newer entry with the same (entity_type,
// entity_id, field_name). If the incoming change is newer (or no existing
// entry), it is applied; otherwise it is counted as a conflict. If any change
// fails validation the entire batch is rolled back.
func PushChanges(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, payload models.SyncPushPayload) (accepted, conflicts int, err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, 0, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, change := range payload.Changes {
		if change.EntityType == "" || change.EntityID == "" || change.FieldName == "" {
			return 0, 0, fmt.Errorf("invalid change record: entityType, entityId, and fieldName are required")
		}

		// Check for the latest existing sync_log entry with the same key.
		var existingTimestamp time.Time
		err := tx.QueryRow(ctx,
			`SELECT timestamp FROM sync_log
			 WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3 AND field_name = $4
			 ORDER BY timestamp DESC
			 LIMIT 1`,
			userID, change.EntityType, change.EntityID, change.FieldName,
		).Scan(&existingTimestamp)

		if err != nil && err != pgx.ErrNoRows {
			return 0, 0, fmt.Errorf("check sync_log: %w", err)
		}

		// If there is an existing entry that is newer or equal, skip (conflict).
		if err == nil && !change.Timestamp.After(existingTimestamp) {
			conflicts++
			continue
		}

		// Apply the change: update the corresponding table based on entity type.
		if applyErr := applyChange(ctx, tx, userID, change); applyErr != nil {
			return 0, 0, fmt.Errorf("apply change (%s/%s/%s): %w",
				change.EntityType, change.EntityID, change.FieldName, applyErr)
		}

		// Record in sync_log with batch_id.
		_, err = tx.Exec(ctx,
			`INSERT INTO sync_log (user_id, entity_type, entity_id, field_name, new_value, device_id, timestamp, batch_id)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			userID, change.EntityType, change.EntityID, change.FieldName,
			change.NewValue, payload.DeviceID, change.Timestamp, payload.BatchID,
		)
		if err != nil {
			return 0, 0, fmt.Errorf("insert sync_log: %w", err)
		}

		accepted++
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, 0, fmt.Errorf("commit transaction: %w", err)
	}

	return accepted, conflicts, nil
}

// applyChange updates the corresponding table row for a single change record.
func applyChange(ctx context.Context, tx pgx.Tx, userID uuid.UUID, change models.ChangeRecord) error {
	if change.EntityType == "task_tag" {
		return applyTaskTagChange(ctx, tx, userID, change)
	}

	if change.FieldName == "_upsert" {
		return applyUpsertChange(ctx, tx, userID, change)
	}

	return applyFieldChange(ctx, tx, userID, change)
}

func applyUpsertChange(ctx context.Context, tx pgx.Tx, userID uuid.UUID, change models.ChangeRecord) error {
	switch change.EntityType {
	case "list":
		var payload syncedListPayload
		if err := json.Unmarshal(change.NewValue, &payload); err != nil {
			return fmt.Errorf("decode list upsert: %w", err)
		}

		_, err := tx.Exec(ctx,
			`INSERT INTO lists (id, user_id, name, color, sort_order, is_inbox, created_at, updated_at, deleted_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			 ON CONFLICT (id) DO UPDATE SET
			   name = EXCLUDED.name,
			   color = EXCLUDED.color,
			   sort_order = EXCLUDED.sort_order,
			   is_inbox = EXCLUDED.is_inbox,
			   created_at = EXCLUDED.created_at,
			   updated_at = EXCLUDED.updated_at,
			   deleted_at = EXCLUDED.deleted_at
			 WHERE lists.user_id = EXCLUDED.user_id`,
			payload.ID, userID, payload.Name, payload.Color, payload.SortOrder,
			payload.IsInbox, payload.CreatedAt, payload.UpdatedAt, payload.DeletedAt,
		)
		if err != nil {
			return fmt.Errorf("upsert list: %w", err)
		}
		return nil
	case "task":
		var payload syncedTaskPayload
		if err := json.Unmarshal(change.NewValue, &payload); err != nil {
			return fmt.Errorf("decode task upsert: %w", err)
		}

		_, err := tx.Exec(ctx,
			`INSERT INTO tasks (
			   id, user_id, list_id, parent_task_id, title, content, priority, status,
			   due_date, due_timezone, recurrence_rule, sort_order, completed_at,
			   created_at, updated_at, deleted_at
			 ) VALUES (
			   $1, $2, $3, $4, $5, $6, $7, $8,
			   $9, $10, $11, $12, $13,
			   $14, $15, $16
			 )
			 ON CONFLICT (id) DO UPDATE SET
			   list_id = EXCLUDED.list_id,
			   parent_task_id = EXCLUDED.parent_task_id,
			   title = EXCLUDED.title,
			   content = EXCLUDED.content,
			   priority = EXCLUDED.priority,
			   status = EXCLUDED.status,
			   due_date = EXCLUDED.due_date,
			   due_timezone = EXCLUDED.due_timezone,
			   recurrence_rule = EXCLUDED.recurrence_rule,
			   sort_order = EXCLUDED.sort_order,
			   completed_at = EXCLUDED.completed_at,
			   created_at = EXCLUDED.created_at,
			   updated_at = EXCLUDED.updated_at,
			   deleted_at = EXCLUDED.deleted_at
			 WHERE tasks.user_id = EXCLUDED.user_id`,
			payload.ID, userID, payload.ListID, payload.ParentTaskID, payload.Title,
			payload.Content, payload.Priority, payload.Status, payload.DueDate,
			payload.DueTimezone, payload.RecurrenceRule, payload.SortOrder,
			payload.CompletedAt, payload.CreatedAt, payload.UpdatedAt, payload.DeletedAt,
		)
		if err != nil {
			return fmt.Errorf("upsert task: %w", err)
		}
		return nil
	case "tag":
		var payload syncedTagPayload
		if err := json.Unmarshal(change.NewValue, &payload); err != nil {
			return fmt.Errorf("decode tag upsert: %w", err)
		}

		_, err := tx.Exec(ctx,
			`INSERT INTO tags (id, user_id, name, color, created_at, deleted_at)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (id) DO UPDATE SET
			   name = EXCLUDED.name,
			   color = EXCLUDED.color,
			   created_at = EXCLUDED.created_at,
			   deleted_at = EXCLUDED.deleted_at
			 WHERE tags.user_id = EXCLUDED.user_id`,
			payload.ID, userID, payload.Name, payload.Color, payload.CreatedAt, payload.DeletedAt,
		)
		if err != nil {
			return fmt.Errorf("upsert tag: %w", err)
		}
		return nil
	default:
		return fmt.Errorf("unsupported entity type for upsert: %s", change.EntityType)
	}
}

func applyFieldChange(ctx context.Context, tx pgx.Tx, userID uuid.UUID, change models.ChangeRecord) error {
	var (
		table            string
		allowedFields    []string
		touchesUpdatedAt bool
	)

	switch change.EntityType {
	case "task":
		table = "tasks"
		allowedFields = []string{
			"list_id",
			"parent_task_id",
			"title",
			"content",
			"priority",
			"status",
			"due_date",
			"due_timezone",
			"recurrence_rule",
			"sort_order",
			"completed_at",
			"created_at",
			"updated_at",
			"deleted_at",
		}
		touchesUpdatedAt = true
	case "list":
		table = "lists"
		allowedFields = []string{
			"name",
			"color",
			"sort_order",
			"is_inbox",
			"created_at",
			"updated_at",
			"deleted_at",
		}
		touchesUpdatedAt = true
	case "tag":
		table = "tags"
		allowedFields = []string{
			"name",
			"color",
			"created_at",
			"deleted_at",
		}
	default:
		return fmt.Errorf("unsupported entity type: %s", change.EntityType)
	}

	if !containsField(allowedFields, change.FieldName) {
		return fmt.Errorf("unsupported field %q for entity type %q", change.FieldName, change.EntityType)
	}

	value, err := rawJSONToValue(change.NewValue)
	if err != nil {
		return fmt.Errorf("decode field value: %w", err)
	}

	var (
		commandTag pgconn.CommandTag
		execErr    error
	)
	if touchesUpdatedAt && change.FieldName != "updated_at" {
		query := fmt.Sprintf(
			`UPDATE %s SET %s = $1, updated_at = $2 WHERE id = $3 AND user_id = $4`,
			table, change.FieldName,
		)
		commandTag, execErr = tx.Exec(ctx, query, value, change.Timestamp, change.EntityID, userID)
	} else {
		query := fmt.Sprintf(
			`UPDATE %s SET %s = $1 WHERE id = $2 AND user_id = $3`,
			table, change.FieldName,
		)
		commandTag, execErr = tx.Exec(ctx, query, value, change.EntityID, userID)
	}
	if execErr != nil {
		return fmt.Errorf("execute update: %w", execErr)
	}
	if commandTag.RowsAffected() == 0 {
		return fmt.Errorf("entity not found: %s/%s", change.EntityType, change.EntityID)
	}

	return nil
}

func applyTaskTagChange(ctx context.Context, tx pgx.Tx, userID uuid.UUID, change models.ChangeRecord) error {
	if change.FieldName != "present" {
		return fmt.Errorf("unsupported task_tag field: %s", change.FieldName)
	}

	taskID, tagID, err := parseTaskTagEntityID(change.EntityID)
	if err != nil {
		return err
	}

	present, err := rawJSONToBool(change.NewValue)
	if err != nil {
		return err
	}

	if present {
		_, err = tx.Exec(ctx,
			`INSERT INTO task_tags (task_id, tag_id, user_id)
			 VALUES ($1, $2, $3)
			 ON CONFLICT DO NOTHING`,
			taskID, tagID, userID,
		)
		if err != nil {
			return fmt.Errorf("insert task_tag: %w", err)
		}
		return nil
	}

	_, err = tx.Exec(ctx,
		`DELETE FROM task_tags WHERE task_id = $1 AND tag_id = $2 AND user_id = $3`,
		taskID, tagID, userID,
	)
	if err != nil {
		return fmt.Errorf("delete task_tag: %w", err)
	}

	return nil
}

func rawJSONToValue(raw json.RawMessage) (interface{}, error) {
	if raw == nil {
		return nil, nil
	}

	var value interface{}
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	return value, nil
}

func rawJSONToBool(raw json.RawMessage) (bool, error) {
	var flag bool
	if err := json.Unmarshal(raw, &flag); err == nil {
		return flag, nil
	}

	var number float64
	if err := json.Unmarshal(raw, &number); err == nil {
		return number != 0, nil
	}

	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		switch text {
		case "true", "1":
			return true, nil
		case "false", "0":
			return false, nil
		}
	}

	return false, fmt.Errorf("invalid boolean sync value")
}

func parseTaskTagEntityID(entityID string) (string, string, error) {
	for i := range entityID {
		if entityID[i] != ':' {
			continue
		}

		taskID := entityID[:i]
		tagID := entityID[i+1:]
		if taskID == "" || tagID == "" {
			break
		}
		return taskID, tagID, nil
	}

	return "", "", fmt.Errorf("invalid task_tag entity id: %s", entityID)
}

func containsField(fields []string, field string) bool {
	for _, allowed := range fields {
		if allowed == field {
			return true
		}
	}
	return false
}

// PullChanges retrieves all sync_log entries for the given user that were made
// by other devices after the specified timestamp.
func PullChanges(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, payload models.SyncPullPayload) (*models.SyncPullResponse, error) {
	rows, err := pool.Query(ctx,
		`SELECT entity_type, entity_id, field_name, new_value, timestamp
		 FROM sync_log
		 WHERE user_id = $1 AND device_id != $2 AND timestamp > $3
		 ORDER BY timestamp ASC`,
		userID, payload.DeviceID, payload.LastSyncAt,
	)
	if err != nil {
		return nil, fmt.Errorf("query sync_log: %w", err)
	}
	defer rows.Close()

	var changes []models.ChangeRecord
	for rows.Next() {
		var cr models.ChangeRecord
		if err := rows.Scan(&cr.EntityType, &cr.EntityID, &cr.FieldName, &cr.NewValue, &cr.Timestamp); err != nil {
			return nil, fmt.Errorf("scan sync_log row: %w", err)
		}
		changes = append(changes, cr)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sync_log rows: %w", err)
	}

	if changes == nil {
		changes = []models.ChangeRecord{}
	}

	return &models.SyncPullResponse{
		Changes:    changes,
		ServerTime: time.Now().UTC(),
	}, nil
}
