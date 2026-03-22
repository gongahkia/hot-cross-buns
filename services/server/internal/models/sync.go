package models

import (
	"encoding/json"
	"time"
)

// SyncPushPayload is the request body for POST /api/v1/sync/push.
type SyncPushPayload struct {
	DeviceID string         `json:"deviceId"`
	BatchID  string         `json:"batchId"`
	Changes  []ChangeRecord `json:"changes"`
}

// ChangeRecord represents a single field-level change to be synced.
type ChangeRecord struct {
	EntityType string          `json:"entityType"`
	EntityID   string          `json:"entityId"`
	FieldName  string          `json:"fieldName"`
	NewValue   json.RawMessage `json:"newValue"`
	Timestamp  time.Time       `json:"timestamp"`
}

// SyncPullPayload is the request body for POST /api/v1/sync/pull.
type SyncPullPayload struct {
	DeviceID   string    `json:"deviceId"`
	LastSyncAt time.Time `json:"lastSyncAt"`
}

// SyncPullResponse is the response body for POST /api/v1/sync/pull.
type SyncPullResponse struct {
	Changes    []ChangeRecord `json:"changes"`
	ServerTime time.Time      `json:"serverTime"`
}

// PushResponse is the response body for POST /api/v1/sync/push.
type PushResponse struct {
	BatchID   string `json:"batchId"`
	Accepted  int    `json:"accepted"`
	Conflicts int    `json:"conflicts"`
}
