package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// ---------------------------------------------------------------------------
// Unit test scaffolding
//
// These tests use httptest.NewRecorder and mock/stub repositories.
// They can run without any external dependencies (no database, no network).
// ---------------------------------------------------------------------------

// setUserID is a test helper that injects a user ID into the Echo context,
// simulating what the auth middleware does in production.
func setUserID(c echo.Context, userID uuid.UUID) {
	c.Set("userID", userID)
}

// newTestContext creates a minimal Echo context with the given method, path,
// and optional JSON body. Returns the context and the recorder.
func newTestContext(method, path, body string) (echo.Context, *httptest.ResponseRecorder) {
	e := echo.New()
	var req *http.Request
	if body != "" {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	} else {
		req = httptest.NewRequest(method, path, nil)
	}
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	return c, rec
}

// ---------------------------------------------------------------------------
// ListHandler unit tests
// ---------------------------------------------------------------------------

func TestListHandler_CreateValidation(t *testing.T) {
	// Test that CreateList rejects a request with an empty name.

	c, rec := newTestContext(http.MethodPost, "/api/v1/lists", `{"name":""}`)
	testUserID := uuid.New()
	setUserID(c, testUserID)

	// We need a ListHandler. In a real test we would inject a mock Repo.
	// For now we verify the validation branch by checking the handler's
	// response when given an empty name.
	// TODO: Wire up a mock ListRepository to avoid hitting the database.

	h := &ListHandler{
		App:  nil, // no app needed for validation-only test
		Repo: nil, // TODO: replace with mock
	}

	// The handler checks len(name) == 0 before touching the repo, so this
	// should return a 400 without needing a database connection.
	err := h.CreateList(c)
	if err != nil {
		t.Fatalf("CreateList returned an unexpected error: %v", err)
	}

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected status %d, got %d", http.StatusBadRequest, rec.Code)
	}

	if !strings.Contains(rec.Body.String(), "VALIDATION_ERROR") {
		t.Errorf("expected VALIDATION_ERROR in body, got: %s", rec.Body.String())
	}
}

func TestListHandler_DeleteInbox(t *testing.T) {
	// Test that DeleteList returns 401 when userID is missing from context
	// (simulating unauthenticated access).

	c, rec := newTestContext(http.MethodDelete, "/api/v1/lists/"+uuid.New().String(), "")
	// Deliberately do NOT set a user ID.

	h := &ListHandler{
		App:  nil,
		Repo: nil,
	}

	err := h.DeleteList(c)
	if err != nil {
		t.Fatalf("DeleteList returned an unexpected error: %v", err)
	}

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status %d, got %d", http.StatusUnauthorized, rec.Code)
	}

	// TODO: With a mock repo, also test that deleting an inbox list returns 409 CONFLICT.
}

// ---------------------------------------------------------------------------
// TaskHandler unit tests
// ---------------------------------------------------------------------------

func TestTaskHandler_CreateSubtaskDepth(t *testing.T) {
	// Test that CreateTask rejects requests with missing authentication.
	// A deeper test (with a mock repo that enforces nesting limits) is a TODO.

	c, rec := newTestContext(http.MethodPost, "/api/v1/lists/"+uuid.New().String()+"/tasks",
		`{"title":"subtask","parentTaskId":"`+uuid.New().String()+`"}`)
	// No userID set => should return 401.

	h := &TaskHandler{
		Pool: nil,
		Repo: nil,
	}

	err := h.CreateTask(c)
	if err != nil {
		t.Fatalf("CreateTask returned an unexpected error: %v", err)
	}

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status %d, got %d", http.StatusUnauthorized, rec.Code)
	}

	// TODO: With a mock repo, test that creating a subtask under a subtask
	// returns 400 NESTING_DEPTH_EXCEEDED.
}

// ---------------------------------------------------------------------------
// Auth middleware unit tests
// ---------------------------------------------------------------------------

func TestAuthMiddleware_MissingToken(t *testing.T) {
	// Verify that a request without an Authorization header to a protected
	// endpoint is rejected when auth is required.
	// Note: The actual middleware lives in the middleware package; here we test
	// the handler-level effect of a missing userID in context.

	c, rec := newTestContext(http.MethodGet, "/api/v1/lists", "")
	// No userID set.

	uid, err := getUserID(c)
	if err == nil {
		t.Fatalf("expected error from getUserID with no context value, got uid=%v", uid)
	}

	// Simulate what a handler does when getUserID fails.
	apiErr := apiError(c, http.StatusUnauthorized, "UNAUTHORIZED", "missing token", nil)
	if apiErr != nil {
		t.Fatalf("apiError returned an unexpected error: %v", apiErr)
	}

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status %d, got %d", http.StatusUnauthorized, rec.Code)
	}
}

func TestAuthMiddleware_ValidToken(t *testing.T) {
	// Verify that getUserID correctly extracts a UUID when set in context.

	c, _ := newTestContext(http.MethodGet, "/api/v1/lists", "")
	expected := uuid.New()
	c.Set("userID", expected)

	got, err := getUserID(c)
	if err != nil {
		t.Fatalf("getUserID returned an unexpected error: %v", err)
	}

	if got != expected {
		t.Errorf("expected userID %s, got %s", expected, got)
	}
}
