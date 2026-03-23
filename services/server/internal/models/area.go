package models

import (
	"time"

	"github.com/google/uuid"
)

type Area struct {
	ID        uuid.UUID  `json:"id"`
	UserID    uuid.UUID  `json:"userId"`
	Name      string     `json:"name" validate:"required,max=200"`
	Color     *string    `json:"color"`
	SortOrder int        `json:"sortOrder"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	DeletedAt *time.Time `json:"deletedAt"`
}
