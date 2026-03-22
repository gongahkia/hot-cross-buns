package services

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gongahkia/tickclone-server/internal/models"
)

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
	var table string
	switch change.EntityType {
	case "task":
		table = "tasks"
	case "list":
		table = "lists"
	case "tag":
		table = "tags"
	default:
		return fmt.Errorf("unsupported entity type: %s", change.EntityType)
	}

	// Unmarshal the new_value from JSON to a Go value for the UPDATE statement.
	var value interface{}
	if change.NewValue != nil {
		if err := json.Unmarshal(change.NewValue, &value); err != nil {
			return fmt.Errorf("unmarshal new_value: %w", err)
		}
	}

	query := fmt.Sprintf(
		`UPDATE %s SET %s = $1, updated_at = now() WHERE id = $2 AND user_id = $3`,
		table, change.FieldName,
	)

	tag, err := tx.Exec(ctx, query, value, change.EntityID, userID)
	if err != nil {
		return fmt.Errorf("execute update: %w", err)
	}

	if tag.RowsAffected() == 0 {
		return fmt.Errorf("entity not found: %s/%s", change.EntityType, change.EntityID)
	}

	return nil
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
