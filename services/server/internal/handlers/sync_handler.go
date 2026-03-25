package handlers

import (
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	"github.com/gongahkia/cross-2-server/internal/models"
	"github.com/gongahkia/cross-2-server/internal/services"
)

// SyncHandler holds dependencies for sync HTTP handlers.
type SyncHandler struct {
	Pool *pgxpool.Pool
}

// NewSyncHandler creates a new SyncHandler.
func NewSyncHandler(pool *pgxpool.Pool) *SyncHandler {
	return &SyncHandler{Pool: pool}
}

// RegisterSyncRoutes wires up all sync-related routes on the given Echo group.
func (h *SyncHandler) RegisterSyncRoutes(g *echo.Group) {
	g.POST("/sync/push", h.Push)
	g.POST("/sync/pull", h.Pull)
}

// Push handles POST /api/v1/sync/push.
// It applies a batch of change records atomically and returns the number of
// accepted and conflicted changes.
func (h *SyncHandler) Push(c echo.Context) error {
	userID, err := getUserID(c)
	if err != nil {
		return apiError(c, http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid user id", nil)
	}

	var payload models.SyncPushPayload
	if err := c.Bind(&payload); err != nil {
		return apiError(c, http.StatusBadRequest, "INVALID_BODY", "invalid request body", nil)
	}

	if payload.DeviceID == "" {
		return apiError(c, http.StatusBadRequest, "VALIDATION_ERROR", "deviceId is required", nil)
	}
	if payload.BatchID == "" {
		return apiError(c, http.StatusBadRequest, "VALIDATION_ERROR", "batchId is required", nil)
	}
	if len(payload.Changes) == 0 {
		return apiError(c, http.StatusBadRequest, "VALIDATION_ERROR", "changes must not be empty", nil)
	}
	const maxChangesPerPush = 500
	if len(payload.Changes) > maxChangesPerPush {
		return apiError(c, http.StatusBadRequest, "VALIDATION_ERROR", "too many changes in a single push (max 500)", nil)
	}

	accepted, conflicts, err := services.PushChanges(c.Request().Context(), h.Pool, userID, payload)
	if err != nil {
		slog.Error("sync push failed", "error", err)
		return apiError(c, http.StatusInternalServerError, "SYNC_PUSH_FAILED", "failed to apply changes", nil)
	}

	return c.JSON(http.StatusOK, models.PushResponse{
		BatchID:   payload.BatchID,
		Accepted:  accepted,
		Conflicts: conflicts,
	})
}

// Pull handles POST /api/v1/sync/pull.
// It returns all changes made by other devices after the given timestamp.
func (h *SyncHandler) Pull(c echo.Context) error {
	userID, err := getUserID(c)
	if err != nil {
		return apiError(c, http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid user id", nil)
	}

	var payload models.SyncPullPayload
	if err := c.Bind(&payload); err != nil {
		return apiError(c, http.StatusBadRequest, "INVALID_BODY", "invalid request body", nil)
	}

	if payload.DeviceID == "" {
		return apiError(c, http.StatusBadRequest, "VALIDATION_ERROR", "deviceId is required", nil)
	}

	resp, err := services.PullChanges(c.Request().Context(), h.Pool, userID, payload)
	if err != nil {
		slog.Error("sync pull failed", "error", err)
		return apiError(c, http.StatusInternalServerError, "SYNC_PULL_FAILED", "failed to fetch changes", nil)
	}

	return c.JSON(http.StatusOK, resp)
}
