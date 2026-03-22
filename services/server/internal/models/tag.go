package models

import (
	"time"

	"github.com/google/uuid"
)

// Tag represents a user-defined tag that can be applied to tasks.
type Tag struct {
	ID        uuid.UUID `json:"id"`
	UserID    uuid.UUID `json:"userId"`
	Name      string    `json:"name"`
	Color     *string   `json:"color"`
	CreatedAt time.Time `json:"createdAt"`
}
