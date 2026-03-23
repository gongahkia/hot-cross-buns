package models

import (
	"time"

	"github.com/google/uuid"
)

type Heading struct {
	ID        uuid.UUID  `json:"id"`
	UserID    uuid.UUID  `json:"userId"`
	ListID    uuid.UUID  `json:"listId"`
	Name      string     `json:"name" validate:"required,max=200"`
	SortOrder int        `json:"sortOrder"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	DeletedAt *time.Time `json:"deletedAt"`
}
