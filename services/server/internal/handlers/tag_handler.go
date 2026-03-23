package handlers

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	"github.com/gongahkia/cross-2-server/internal/models"
	"github.com/gongahkia/cross-2-server/internal/repository"
)

// TagHandler exposes HTTP endpoints for tag CRUD and task-tag associations.
type TagHandler struct {
	Pool *pgxpool.Pool
	Repo *repository.TagRepository
}

// NewTagHandler creates a TagHandler and registers its routes on the given Echo
// group (expected to be the /api/v1 group).
func NewTagHandler(g *echo.Group, pool *pgxpool.Pool) *TagHandler {
	h := &TagHandler{
		Pool: pool,
		Repo: &repository.TagRepository{},
	}

	g.POST("/tags", h.CreateTag)
	g.GET("/tags", h.GetTags)
	g.PATCH("/tags/:id", h.UpdateTag)
	g.DELETE("/tags/:id", h.DeleteTag)
	g.POST("/tasks/:taskId/tags/:tagId", h.AddTagToTask)
	g.DELETE("/tasks/:taskId/tags/:tagId", h.RemoveTagFromTask)
	g.GET("/tags/:id/tasks", h.GetTasksByTag)

	return h
}

// ---------- request types ----------

type createTagRequest struct {
	Name  string  `json:"name"`
	Color *string `json:"color"`
}

type updateTagRequest struct {
	Name  *string `json:"name"`
	Color *string `json:"color"`
}

// ---------- handlers ----------

// CreateTag handles POST /api/v1/tags.
func (h *TagHandler) CreateTag(c echo.Context) error {
	userID, err := extractUserID(c)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, newError("UNAUTHORIZED", "authentication required"))
	}

	var req createTagRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, newError("BAD_REQUEST", "invalid request body"))
	}
	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, newError("VALIDATION_ERROR", "name is required"))
	}

	tag := &models.Tag{
		Name:  req.Name,
		Color: req.Color,
	}

	if err := h.Repo.CreateTag(c.Request().Context(), h.Pool, userID, tag); err != nil {
		return c.JSON(http.StatusInternalServerError, newError("INTERNAL_ERROR", err.Error()))
	}

	return c.JSON(http.StatusCreated, tag)
}

// GetTags handles GET /api/v1/tags.
func (h *TagHandler) GetTags(c echo.Context) error {
	userID, err := extractUserID(c)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, newError("UNAUTHORIZED", "authentication required"))
	}

	tags, err := h.Repo.GetTagsByUser(c.Request().Context(), h.Pool, userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, newError("INTERNAL_ERROR", err.Error()))
	}

	if tags == nil {
		tags = []models.Tag{}
	}
	return c.JSON(http.StatusOK, tags)
}

// UpdateTag handles PATCH /api/v1/tags/:id.
func (h *TagHandler) UpdateTag(c echo.Context) error {
	userID, err := extractUserID(c)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, newError("UNAUTHORIZED", "authentication required"))
	}

	tagID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, newError("BAD_REQUEST", "invalid tag id"))
	}

	var req updateTagRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, newError("BAD_REQUEST", "invalid request body"))
	}

	updated, err := h.Repo.UpdateTag(c.Request().Context(), h.Pool, userID, tagID, req.Name, req.Color)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, newError("INTERNAL_ERROR", err.Error()))
	}

	return c.JSON(http.StatusOK, updated)
}

// DeleteTag handles DELETE /api/v1/tags/:id.
func (h *TagHandler) DeleteTag(c echo.Context) error {
	userID, err := extractUserID(c)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, newError("UNAUTHORIZED", "authentication required"))
	}

	tagID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, newError("BAD_REQUEST", "invalid tag id"))
	}

	if err := h.Repo.DeleteTag(c.Request().Context(), h.Pool, userID, tagID); err != nil {
		return c.JSON(http.StatusInternalServerError, newError("INTERNAL_ERROR", err.Error()))
	}

	return c.NoContent(http.StatusNoContent)
}

// AddTagToTask handles POST /api/v1/tasks/:taskId/tags/:tagId.
func (h *TagHandler) AddTagToTask(c echo.Context) error {
	userID, err := extractUserID(c)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, newError("UNAUTHORIZED", "authentication required"))
	}

	taskID, err := uuid.Parse(c.Param("taskId"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, newError("BAD_REQUEST", "invalid task id"))
	}

	tagID, err := uuid.Parse(c.Param("tagId"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, newError("BAD_REQUEST", "invalid tag id"))
	}

	if err := h.Repo.AddTagToTask(c.Request().Context(), h.Pool, userID, taskID, tagID); err != nil {
		return c.JSON(http.StatusInternalServerError, newError("INTERNAL_ERROR", err.Error()))
	}

	return c.NoContent(http.StatusNoContent)
}

// RemoveTagFromTask handles DELETE /api/v1/tasks/:taskId/tags/:tagId.
func (h *TagHandler) RemoveTagFromTask(c echo.Context) error {
	userID, err := extractUserID(c)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, newError("UNAUTHORIZED", "authentication required"))
	}

	taskID, err := uuid.Parse(c.Param("taskId"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, newError("BAD_REQUEST", "invalid task id"))
	}

	tagID, err := uuid.Parse(c.Param("tagId"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, newError("BAD_REQUEST", "invalid tag id"))
	}

	if err := h.Repo.RemoveTagFromTask(c.Request().Context(), h.Pool, userID, taskID, tagID); err != nil {
		return c.JSON(http.StatusInternalServerError, newError("INTERNAL_ERROR", err.Error()))
	}

	return c.NoContent(http.StatusNoContent)
}

// GetTasksByTag handles GET /api/v1/tags/:id/tasks.
func (h *TagHandler) GetTasksByTag(c echo.Context) error {
	userID, err := extractUserID(c)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, newError("UNAUTHORIZED", "authentication required"))
	}

	tagID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, newError("BAD_REQUEST", "invalid tag id"))
	}

	tasks, err := h.Repo.GetTasksByTag(c.Request().Context(), h.Pool, userID, tagID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, newError("INTERNAL_ERROR", err.Error()))
	}

	if tasks == nil {
		tasks = []models.Task{}
	}
	return c.JSON(http.StatusOK, tasks)
}
