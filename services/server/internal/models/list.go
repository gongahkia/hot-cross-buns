package models

import (
	"time"

	"github.com/google/uuid"
)

// List represents a task list in the Hot Cross Buns application.
type List struct {
	ID        uuid.UUID  `json:"id"`
	UserID    uuid.UUID  `json:"userId"`
	Name      string     `json:"name" validate:"required,max=255"`
	Color     *string    `json:"color" validate:"omitempty,hexcolor"`
	SortOrder int        `json:"sortOrder"`
	IsInbox   bool       `json:"isInbox"`
	AreaID    *uuid.UUID `json:"areaId"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	DeletedAt *time.Time `json:"deletedAt"`
}
