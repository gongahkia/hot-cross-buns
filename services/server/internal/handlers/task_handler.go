package handlers

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	"github.com/gongahkia/tickclone-server/internal/models"
	"github.com/gongahkia/tickclone-server/internal/repository"
)

type TaskHandler struct {
	Pool *pgxpool.Pool
	Repo *repository.TaskRepository
}

func NewTaskHandler(pool *pgxpool.Pool, repo *repository.TaskRepository) *TaskHandler {
	return &TaskHandler{Pool: pool, Repo: repo}
}

// RegisterTaskRoutes wires up all task-related routes on the given Echo group.
func (h *TaskHandler) RegisterTaskRoutes(g *echo.Group) {
	g.POST("/lists/:listId/tasks", h.CreateTask)
	g.GET("/lists/:listId/tasks", h.GetTasksByList)
	g.GET("/tasks/:id", h.GetTaskByID)
	g.PATCH("/tasks/:id", h.UpdateTask)
	g.DELETE("/tasks/:id", h.DeleteTask)
	g.POST("/tasks/:id/move", h.MoveTask)
}

// CreateTask handles POST /api/v1/lists/:listId/tasks
func (h *TaskHandler) CreateTask(c echo.Context) error {
	userID, err := getUserID(c)
	if err != nil {
		return apiError(c, http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid user id", nil)
	}

	listID, err := uuid.Parse(c.Param("listId"))
	if err != nil {
		return apiError(c, http.StatusBadRequest, "INVALID_LIST_ID", "invalid list id format", nil)
	}

	var task models.Task
	if err := c.Bind(&task); err != nil {
		return apiError(c, http.StatusBadRequest, "INVALID_BODY", "invalid request body", nil)
	}

	if strings.TrimSpace(task.Title) == "" {
		return apiError(c, http.StatusBadRequest, "VALIDATION_ERROR", "title is required", nil)
	}

	task.ListID = listID

	if err := h.Repo.CreateTask(c.Request().Context(), h.Pool, userID, &task); err != nil {
		if strings.Contains(err.Error(), "parent task not found") {
			return apiError(c, http.StatusNotFound, "PARENT_NOT_FOUND", err.Error(), nil)
		}
		if strings.Contains(err.Error(), "cannot nest subtasks") {
			return apiError(c, http.StatusBadRequest, "NESTING_DEPTH_EXCEEDED", err.Error(), nil)
		}
		return apiError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create task", nil)
	}

	return c.JSON(http.StatusCreated, task)
}

// GetTasksByList handles GET /api/v1/lists/:listId/tasks
func (h *TaskHandler) GetTasksByList(c echo.Context) error {
	userID, err := getUserID(c)
	if err != nil {
		return apiError(c, http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid user id", nil)
	}

	listID, err := uuid.Parse(c.Param("listId"))
	if err != nil {
		return apiError(c, http.StatusBadRequest, "INVALID_LIST_ID", "invalid list id format", nil)
	}

	includeCompleted := strings.ToLower(c.QueryParam("includeCompleted")) == "true"

	tasks, err := h.Repo.GetTasksByList(c.Request().Context(), h.Pool, userID, listID, includeCompleted)
	if err != nil {
		return apiError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to fetch tasks", nil)
	}

	if tasks == nil {
		tasks = []models.Task{}
	}

	return c.JSON(http.StatusOK, tasks)
}

// GetTaskByID handles GET /api/v1/tasks/:id
func (h *TaskHandler) GetTaskByID(c echo.Context) error {
	userID, err := getUserID(c)
	if err != nil {
		return apiError(c, http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid user id", nil)
	}

	taskID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apiError(c, http.StatusBadRequest, "INVALID_TASK_ID", "invalid task id format", nil)
	}

	task, err := h.Repo.GetTaskByID(c.Request().Context(), h.Pool, userID, taskID)
	if err != nil {
		return apiError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to fetch task", nil)
	}
	if task == nil {
		return apiError(c, http.StatusNotFound, "NOT_FOUND", "task not found", nil)
	}

	return c.JSON(http.StatusOK, task)
}

// UpdateTask handles PATCH /api/v1/tasks/:id
func (h *TaskHandler) UpdateTask(c echo.Context) error {
	userID, err := getUserID(c)
	if err != nil {
		return apiError(c, http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid user id", nil)
	}

	taskID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apiError(c, http.StatusBadRequest, "INVALID_TASK_ID", "invalid task id format", nil)
	}

	var payload models.TaskUpdatePayload
	if err := c.Bind(&payload); err != nil {
		return apiError(c, http.StatusBadRequest, "INVALID_BODY", "invalid request body", nil)
	}

	fields := make(map[string]interface{})
	if payload.Title != nil {
		if strings.TrimSpace(*payload.Title) == "" {
			return apiError(c, http.StatusBadRequest, "VALIDATION_ERROR", "title cannot be empty", nil)
		}
		fields["title"] = *payload.Title
	}
	if payload.Content != nil {
		fields["content"] = *payload.Content
	}
	if payload.ListID != nil {
		fields["list_id"] = *payload.ListID
	}
	if payload.ParentTaskID != nil {
		fields["parent_task_id"] = *payload.ParentTaskID
	}
	if payload.Priority != nil {
		fields["priority"] = *payload.Priority
	}
	if payload.Status != nil {
		fields["status"] = *payload.Status
	}
	if payload.DueDate != nil {
		fields["due_date"] = *payload.DueDate
	}
	if payload.DueTimezone != nil {
		fields["due_timezone"] = *payload.DueTimezone
	}
	if payload.RecurrenceRule != nil {
		fields["recurrence_rule"] = *payload.RecurrenceRule
	}
	if payload.SortOrder != nil {
		fields["sort_order"] = *payload.SortOrder
	}

	updated, err := h.Repo.UpdateTask(c.Request().Context(), h.Pool, userID, taskID, fields)
	if err != nil {
		return apiError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update task", nil)
	}
	if updated == nil {
		return apiError(c, http.StatusNotFound, "NOT_FOUND", "task not found", nil)
	}

	return c.JSON(http.StatusOK, updated)
}

// DeleteTask handles DELETE /api/v1/tasks/:id
func (h *TaskHandler) DeleteTask(c echo.Context) error {
	userID, err := getUserID(c)
	if err != nil {
		return apiError(c, http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid user id", nil)
	}

	taskID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apiError(c, http.StatusBadRequest, "INVALID_TASK_ID", "invalid task id format", nil)
	}

	if err := h.Repo.DeleteTask(c.Request().Context(), h.Pool, userID, taskID); err != nil {
		if strings.Contains(err.Error(), "task not found") {
			return apiError(c, http.StatusNotFound, "NOT_FOUND", "task not found", nil)
		}
		return apiError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete task", nil)
	}

	return c.NoContent(http.StatusNoContent)
}

// MoveTask handles POST /api/v1/tasks/:id/move
func (h *TaskHandler) MoveTask(c echo.Context) error {
	userID, err := getUserID(c)
	if err != nil {
		return apiError(c, http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid user id", nil)
	}

	taskID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apiError(c, http.StatusBadRequest, "INVALID_TASK_ID", "invalid task id format", nil)
	}

	var body struct {
		ListID    uuid.UUID `json:"listId"`
		SortOrder int       `json:"sortOrder"`
	}
	if err := c.Bind(&body); err != nil {
		return apiError(c, http.StatusBadRequest, "INVALID_BODY", "invalid request body", nil)
	}

	if body.ListID == uuid.Nil {
		return apiError(c, http.StatusBadRequest, "VALIDATION_ERROR", "listId is required", nil)
	}

	if err := h.Repo.MoveTask(c.Request().Context(), h.Pool, userID, taskID, body.ListID, body.SortOrder); err != nil {
		if strings.Contains(err.Error(), "task not found") {
			return apiError(c, http.StatusNotFound, "NOT_FOUND", "task not found", nil)
		}
		return apiError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to move task", nil)
	}

	task, err := h.Repo.GetTaskByID(c.Request().Context(), h.Pool, userID, taskID)
	if err != nil || task == nil {
		return apiError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to fetch moved task", nil)
	}

	return c.JSON(http.StatusOK, task)
}

// getUserID and apiError are defined in helpers.go
