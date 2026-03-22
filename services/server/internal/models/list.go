package models

import (
	"time"

	"github.com/google/uuid"
)

// List represents a task list in the TickClone application.
type List struct {
	ID        uuid.UUID  `json:"id"`
	UserID    uuid.UUID  `json:"userId"`
	Name      string     `json:"name"`
	Color     *string    `json:"color"`
	SortOrder int        `json:"sortOrder"`
	IsInbox   bool       `json:"isInbox"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	DeletedAt *time.Time `json:"deletedAt"`
}
