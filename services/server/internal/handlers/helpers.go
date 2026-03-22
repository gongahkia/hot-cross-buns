package handlers

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// getUserID extracts the authenticated user ID from the Echo context.
// It checks both "userID" and "user_id" context keys for compatibility.
func getUserID(c echo.Context) (uuid.UUID, error) {
	raw := c.Get("userID")
	if raw == nil {
		raw = c.Get("user_id")
	}
	if raw == nil {
		return uuid.Nil, echo.NewHTTPError(http.StatusUnauthorized, "user id not found in context")
	}
	switch v := raw.(type) {
	case uuid.UUID:
		return v, nil
	case string:
		return uuid.Parse(v)
	default:
		return uuid.Nil, echo.NewHTTPError(http.StatusUnauthorized, "invalid user id type")
	}
}

// extractUserID is an alias for getUserID kept for backward compatibility.
var extractUserID = getUserID

// apiError returns a structured JSON error response matching the format:
//
//	{"error":{"code":"...","message":"...","details":[]}}
func apiError(c echo.Context, status int, code string, message string, details []string) error {
	if details == nil {
		details = []string{}
	}
	return c.JSON(status, map[string]interface{}{
		"error": map[string]interface{}{
			"code":    code,
			"message": message,
			"details": details,
		},
	})
}

// newError is a convenience wrapper that calls apiError with no details.
// It is used in list_handler.go for brevity. Note: it returns the error
// response directly as a JSON-serialisable value (not an error).
func newError(code string, message string) map[string]interface{} {
	return map[string]interface{}{
		"error": map[string]interface{}{
			"code":    code,
			"message": message,
			"details": []string{},
		},
	}
}
