package services_test

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gongahkia/hot-cross-buns-server/internal/models"
	"github.com/gongahkia/hot-cross-buns-server/internal/services"
)

// testPool returns a *pgxpool.Pool connected to the integration-test database.
// The DATABASE_URL environment variable must be set; the test is skipped
// otherwise.
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set – skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect to database: %v", err)
	}
	t.Cleanup(func() { pool.Close() })
	return pool
}

// newChange is a helper that builds a ChangeRecord for testing.
func newChange(entityType, entityID, field string, value interface{}, ts time.Time) models.ChangeRecord {
	raw, _ := json.Marshal(value)
	return models.ChangeRecord{
		EntityType: entityType,
		EntityID:   entityID,
		FieldName:  field,
		NewValue:   json.RawMessage(raw),
		Timestamp:  ts,
	}
}

// TestTwoClientSync_NoConflict verifies that changes pushed from two different
// devices with non-overlapping fields are both accepted without conflict.
func TestTwoClientSync_NoConflict(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	userID := uuid.New()

	now := time.Now().UTC()

	// Device A pushes a title change.
	payloadA := models.SyncPushPayload{
		DeviceID: "device-a",
		BatchID:  uuid.NewString(),
		Changes: []models.ChangeRecord{
			newChange("task", "task-1", "title", "Buy groceries", now),
		},
	}
	acceptedA, conflictsA, err := services.PushChanges(ctx, pool, userID, payloadA)
	if err != nil {
		t.Fatalf("PushChanges device-a: %v", err)
	}
	if acceptedA != 1 || conflictsA != 0 {
		t.Errorf("device-a: want accepted=1 conflicts=0, got accepted=%d conflicts=%d", acceptedA, conflictsA)
	}

	// Device B pushes a description change to the same task (different field).
	payloadB := models.SyncPushPayload{
		DeviceID: "device-b",
		BatchID:  uuid.NewString(),
		Changes: []models.ChangeRecord{
			newChange("task", "task-1", "description", "Milk, eggs, bread", now.Add(time.Second)),
		},
	}
	acceptedB, conflictsB, err := services.PushChanges(ctx, pool, userID, payloadB)
	if err != nil {
		t.Fatalf("PushChanges device-b: %v", err)
	}
	if acceptedB != 1 || conflictsB != 0 {
		t.Errorf("device-b: want accepted=1 conflicts=0, got accepted=%d conflicts=%d", acceptedB, conflictsB)
	}
}

// TestTwoClientSync_ConflictResolution verifies that when two devices push
// changes to the same field, the one with the newer timestamp wins and the
// older one is reported as a conflict.
func TestTwoClientSync_ConflictResolution(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	userID := uuid.New()

	now := time.Now().UTC()

	// Device A pushes first with an earlier timestamp.
	payloadA := models.SyncPushPayload{
		DeviceID: "device-a",
		BatchID:  uuid.NewString(),
		Changes: []models.ChangeRecord{
			newChange("task", "task-2", "title", "Original title", now),
		},
	}
	_, _, err := services.PushChanges(ctx, pool, userID, payloadA)
	if err != nil {
		t.Fatalf("PushChanges device-a: %v", err)
	}

	// Device B pushes the same field with a newer timestamp – should win.
	payloadB := models.SyncPushPayload{
		DeviceID: "device-b",
		BatchID:  uuid.NewString(),
		Changes: []models.ChangeRecord{
			newChange("task", "task-2", "title", "Updated title", now.Add(2*time.Second)),
		},
	}
	acceptedB, conflictsB, err := services.PushChanges(ctx, pool, userID, payloadB)
	if err != nil {
		t.Fatalf("PushChanges device-b: %v", err)
	}
	if acceptedB != 1 || conflictsB != 0 {
		t.Errorf("device-b (newer): want accepted=1 conflicts=0, got accepted=%d conflicts=%d", acceptedB, conflictsB)
	}
}

// TestTwoClientSync_OlderRejected verifies that a push with an older timestamp
// than an already-recorded entry is correctly rejected as a conflict.
func TestTwoClientSync_OlderRejected(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	userID := uuid.New()

	now := time.Now().UTC()

	// Device A pushes with a newer timestamp first.
	payloadA := models.SyncPushPayload{
		DeviceID: "device-a",
		BatchID:  uuid.NewString(),
		Changes: []models.ChangeRecord{
			newChange("task", "task-3", "title", "Newer title", now.Add(5*time.Second)),
		},
	}
	_, _, err := services.PushChanges(ctx, pool, userID, payloadA)
	if err != nil {
		t.Fatalf("PushChanges device-a: %v", err)
	}

	// Device B pushes the same field with an older timestamp – should be rejected.
	payloadB := models.SyncPushPayload{
		DeviceID: "device-b",
		BatchID:  uuid.NewString(),
		Changes: []models.ChangeRecord{
			newChange("task", "task-3", "title", "Stale title", now),
		},
	}
	acceptedB, conflictsB, err := services.PushChanges(ctx, pool, userID, payloadB)
	if err != nil {
		t.Fatalf("PushChanges device-b: %v", err)
	}
	if acceptedB != 0 || conflictsB != 1 {
		t.Errorf("device-b (older): want accepted=0 conflicts=1, got accepted=%d conflicts=%d", acceptedB, conflictsB)
	}
}
