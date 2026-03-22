package handlers

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/gongahkia/tickclone-server/internal/app"
	"github.com/gongahkia/tickclone-server/internal/models"
	"github.com/gongahkia/tickclone-server/internal/repository"
)

// ListHandler handles HTTP requests for list CRUD operations.
type ListHandler struct {
	App  *app.App
	Repo *repository.ListRepository
}

// NewListHandler creates a ListHandler and registers its routes on the given
// Echo group (expected to be the /api/v1 group).
func NewListHandler(g *echo.Group, a *app.App) *ListHandler {
	h := &ListHandler{
		App:  a,
		Repo: repository.NewListRepository(),
	}

	g.POST("/lists", h.CreateList)
	g.GET("/lists", h.GetLists)
	g.GET("/lists/:id", h.GetListByID)
	g.PATCH("/lists/:id", h.UpdateList)
	g.DELETE("/lists/:id", h.DeleteList)

	return h
}

// --- request types ---

type createListRequest struct {
	Name  string  `json:"name"`
	Color *string `json:"color"`
}

type updateListRequest struct {
	Name      *string `json:"name"`
	Color     *string `json:"color"`
	SortOrder *int    `json:"sortOrder"`
}

// --- handlers ---

// CreateList handles POST /api/v1/lists.
func (h *ListHandler) CreateList(c echo.Context) error {
	userID, err := getUserID(c)
	if err != nil {
		return apiError(c, http.StatusUnauthorized, "UNAUTHORIZED", "Invalid or expired authentication token.", nil)
	}

	var req createListRequest
	if err := c.Bind(&req); err != nil {
		return apiError(c, http.StatusBadRequest, "INVALID_REQUEST", "Malformed JSON request body.", nil)
	}

	if len(req.Name) == 0 || len(req.Name) > 255 {
		return apiError(c, http.StatusBadRequest, "VALIDATION_ERROR", "One or more fields are invalid.",
			[]string{"name: Required, must be 1-255 characters."})
	}

	list := &models.List{
		Name:  req.Name,
		Color: req.Color,
	}

	if err := h.Repo.CreateList(c.Request().Context(), h.App.DB, userID, list); err != nil {
		slog.Error("failed to create list", "error", err, "userID", userID)
		return apiError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred.", nil)
	}

	return c.JSON(http.StatusCreated, list)
}

// GetLists handles GET /api/v1/lists.
func (h *ListHandler) GetLists(c echo.Context) error {
	userID, err := getUserID(c)
	if err != nil {
		return apiError(c, http.StatusUnauthorized, "UNAUTHORIZED", "Invalid or expired authentication token.", nil)
	}

	lists, err := h.Repo.GetListsByUser(c.Request().Context(), h.App.DB, userID)
	if err != nil {
		slog.Error("failed to get lists", "error", err, "userID", userID)
		return apiError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred.", nil)
	}

	return c.JSON(http.StatusOK, lists)
}

// GetListByID handles GET /api/v1/lists/:id.
func (h *ListHandler) GetListByID(c echo.Context) error {
	userID, err := getUserID(c)
	if err != nil {
		return apiError(c, http.StatusUnauthorized, "UNAUTHORIZED", "Invalid or expired authentication token.", nil)
	}

	listID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apiError(c, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid list ID format.", nil)
	}

	list, err := h.Repo.GetListByID(c.Request().Context(), h.App.DB, userID, listID)
	if err != nil {
		slog.Error("failed to get list", "error", err, "userID", userID, "listID", listID)
		return apiError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred.", nil)
	}
	if list == nil {
		return apiError(c, http.StatusNotFound, "NOT_FOUND", "List not found.", nil)
	}

	return c.JSON(http.StatusOK, list)
}

// UpdateList handles PATCH /api/v1/lists/:id.
func (h *ListHandler) UpdateList(c echo.Context) error {
	userID, err := getUserID(c)
	if err != nil {
		return apiError(c, http.StatusUnauthorized, "UNAUTHORIZED", "Invalid or expired authentication token.", nil)
	}

	listID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apiError(c, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid list ID format.", nil)
	}

	var req updateListRequest
	if err := c.Bind(&req); err != nil {
		return apiError(c, http.StatusBadRequest, "INVALID_REQUEST", "Malformed JSON request body.", nil)
	}

	if req.Name != nil && (len(*req.Name) == 0 || len(*req.Name) > 255) {
		return apiError(c, http.StatusBadRequest, "VALIDATION_ERROR", "One or more fields are invalid.",
			[]string{"name: Required, must be 1-255 characters."})
	}

	list, err := h.Repo.UpdateList(c.Request().Context(), h.App.DB, userID, listID, req.Name, req.Color, req.SortOrder)
	if err != nil {
		slog.Error("failed to update list", "error", err, "userID", userID, "listID", listID)
		return apiError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred.", nil)
	}
	if list == nil {
		return apiError(c, http.StatusNotFound, "NOT_FOUND", "List not found.", nil)
	}

	return c.JSON(http.StatusOK, list)
}

// DeleteList handles DELETE /api/v1/lists/:id.
func (h *ListHandler) DeleteList(c echo.Context) error {
	userID, err := getUserID(c)
	if err != nil {
		return apiError(c, http.StatusUnauthorized, "UNAUTHORIZED", "Invalid or expired authentication token.", nil)
	}

	listID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apiError(c, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid list ID format.", nil)
	}

	err = h.Repo.DeleteList(c.Request().Context(), h.App.DB, userID, listID)
	if err != nil {
		if errors.Is(err, repository.ErrCannotDeleteInbox) {
			return apiError(c, http.StatusConflict, "CONFLICT", "Cannot delete the Inbox list.", nil)
		}
		if errors.Is(err, repository.ErrListNotFound) {
			return apiError(c, http.StatusNotFound, "NOT_FOUND", "List not found.", nil)
		}
		slog.Error("failed to delete list", "error", err, "userID", userID, "listID", listID)
		return apiError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred.", nil)
	}

	return c.NoContent(http.StatusNoContent)
}
