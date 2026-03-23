package models

import (
	"time"

	"github.com/google/uuid"
)

// Task represents a task in the Cross 2 application.
type Task struct {
	ID             uuid.UUID  `json:"id"`
	UserID         uuid.UUID  `json:"userId"`
	ListID         uuid.UUID  `json:"listId"`
	ParentTaskID   *uuid.UUID `json:"parentTaskId"`
	Title          string     `json:"title" validate:"required,max=500"`
	Content        *string    `json:"content"`
	Priority       int        `json:"priority" validate:"gte=0,lte=3"`
	Status         int        `json:"status"`
	DueDate        *time.Time `json:"dueDate"`
	DueTimezone    *string    `json:"dueTimezone"`
	RecurrenceRule *string    `json:"recurrenceRule"`
	SortOrder      int        `json:"sortOrder"`
	CompletedAt    *time.Time `json:"completedAt"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	DeletedAt      *time.Time `json:"deletedAt"`
	Subtasks       []Task     `json:"subtasks"`
	Tags           []Tag      `json:"tags"`
}

// TaskUpdatePayload contains optional fields for partially updating a task.
type TaskUpdatePayload struct {
	ListID         *uuid.UUID `json:"listId"`
	ParentTaskID   *uuid.UUID `json:"parentTaskId"`
	Title          *string    `json:"title"`
	Content        *string    `json:"content"`
	Priority       *int       `json:"priority"`
	Status         *int       `json:"status"`
	DueDate        *time.Time `json:"dueDate"`
	DueTimezone    *string    `json:"dueTimezone"`
	RecurrenceRule *string    `json:"recurrenceRule"`
	SortOrder      *int       `json:"sortOrder"`
}
