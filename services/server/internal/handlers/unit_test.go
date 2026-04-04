package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/gongahkia/hot-cross-buns-server/internal/middleware"
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

// testJWTSecret is the HMAC secret used to sign/verify tokens in tests.
const testJWTSecret = "test-secret-for-unit-tests"

// makeJWT creates a signed HS256 JWT with the given subject and expiry.
func makeJWT(subject string, expiresAt time.Time) string {
	claims := jwt.RegisteredClaims{
		Subject:   subject,
		ExpiresAt: jwt.NewNumericDate(expiresAt),
		IssuedAt:  jwt.NewNumericDate(time.Now().UTC()),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(testJWTSecret))
	if err != nil {
		panic("makeJWT: " + err.Error())
	}
	return signed
}

// parseErrorResponse parses the standard {"error":{"code":...,"message":...}} body.
type errorEnvelope struct {
	Error struct {
		Code    string   `json:"code"`
		Message string   `json:"message"`
		Details []string `json:"details"`
	} `json:"error"`
}

// parseSimpleError parses the simpler {"error":"..."} body used by the auth middleware.
type simpleErrorEnvelope struct {
	Error string `json:"error"`
}

// ---------------------------------------------------------------------------
// ListHandler unit tests
// ---------------------------------------------------------------------------

func TestListHandler_CreateValidation_EmptyName(t *testing.T) {
	// POST with empty name -> expect 400 with VALIDATION_ERROR.
	c, rec := newTestContext(http.MethodPost, "/api/v1/lists", `{"name":""}`)
	testUserID := uuid.New()
	setUserID(c, testUserID)

	h := &ListHandler{
		App:  nil,
		Repo: nil,
	}

	err := h.CreateList(c)
	if err != nil {
		t.Fatalf("CreateList returned an unexpected error: %v", err)
	}

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected status %d, got %d", http.StatusBadRequest, rec.Code)
	}

	var env errorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("failed to parse response body: %v", err)
	}
	if env.Error.Code != "VALIDATION_ERROR" {
		t.Errorf("expected error code VALIDATION_ERROR, got %q", env.Error.Code)
	}
	if len(env.Error.Details) == 0 {
		t.Error("expected non-empty details array for validation error")
	}
}

func TestListHandler_CreateValidation_NameTooLong(t *testing.T) {
	// POST with name > 255 chars -> expect 400 with VALIDATION_ERROR.
	longName := strings.Repeat("a", 256)
	body := `{"name":"` + longName + `"}`

	c, rec := newTestContext(http.MethodPost, "/api/v1/lists", body)
	testUserID := uuid.New()
	setUserID(c, testUserID)

	h := &ListHandler{
		App:  nil,
		Repo: nil,
	}

	err := h.CreateList(c)
	if err != nil {
		t.Fatalf("CreateList returned an unexpected error: %v", err)
	}

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected status %d, got %d", http.StatusBadRequest, rec.Code)
	}

	var env errorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("failed to parse response body: %v", err)
	}
	if env.Error.Code != "VALIDATION_ERROR" {
		t.Errorf("expected error code VALIDATION_ERROR, got %q", env.Error.Code)
	}
}

func TestListHandler_CreateValidation_ValidNameHitsRepo(t *testing.T) {
	// POST with a valid name (1-255 chars) will pass validation but panic or
	// fail when it tries to use the nil Repo. We use recover to confirm we got
	// past the validation layer.
	c, rec := newTestContext(http.MethodPost, "/api/v1/lists", `{"name":"Groceries"}`)
	testUserID := uuid.New()
	setUserID(c, testUserID)

	h := &ListHandler{
		App:  nil,
		Repo: nil,
	}

	// The handler will attempt h.Repo.CreateList on the nil Repo, causing a
	// nil-pointer panic. Catching that panic proves the request got past
	// validation.
	panicked := false
	func() {
		defer func() {
			if r := recover(); r != nil {
				panicked = true
			}
		}()
		_ = h.CreateList(c)
	}()

	if !panicked {
		// If it did not panic, the handler returned normally. Check that it
		// did not reject the request at the validation layer.
		if rec.Code == http.StatusBadRequest {
			t.Error("valid name was rejected at validation layer")
		}
	}
	// If it panicked, validation passed (good).
}

func TestListHandler_DeleteInbox_MissingUserID(t *testing.T) {
	// DELETE without userID in context -> expect 401 with structured error.
	c, rec := newTestContext(http.MethodDelete, "/api/v1/lists/"+uuid.New().String(), "")
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())
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

	var env errorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("failed to parse response body: %v", err)
	}
	if env.Error.Code != "UNAUTHORIZED" {
		t.Errorf("expected error code UNAUTHORIZED, got %q", env.Error.Code)
	}
}

// ---------------------------------------------------------------------------
// TaskHandler unit tests
// ---------------------------------------------------------------------------

func TestTaskHandler_CreateSubtaskDepth_MissingAuth(t *testing.T) {
	// POST to create a task without userID -> expect 401.
	listID := uuid.New()
	parentID := uuid.New()
	c, rec := newTestContext(http.MethodPost, "/api/v1/lists/"+listID.String()+"/tasks",
		`{"title":"subtask","parentTaskId":"`+parentID.String()+`"}`)
	c.SetParamNames("listId")
	c.SetParamValues(listID.String())
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

	var env errorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("failed to parse response body: %v", err)
	}
	if env.Error.Code != "UNAUTHORIZED" {
		t.Errorf("expected error code UNAUTHORIZED, got %q", env.Error.Code)
	}
}

func TestTaskHandler_CreateTask_EmptyTitle(t *testing.T) {
	// POST with empty title -> expect 400 VALIDATION_ERROR.
	listID := uuid.New()
	c, rec := newTestContext(http.MethodPost, "/api/v1/lists/"+listID.String()+"/tasks",
		`{"title":"  "}`)
	c.SetParamNames("listId")
	c.SetParamValues(listID.String())
	setUserID(c, uuid.New())

	h := &TaskHandler{
		Pool: nil,
		Repo: nil,
	}

	err := h.CreateTask(c)
	if err != nil {
		t.Fatalf("CreateTask returned an unexpected error: %v", err)
	}

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected status %d, got %d", http.StatusBadRequest, rec.Code)
	}

	var env errorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("failed to parse response body: %v", err)
	}
	if env.Error.Code != "VALIDATION_ERROR" {
		t.Errorf("expected error code VALIDATION_ERROR, got %q", env.Error.Code)
	}
}

func TestTaskHandler_CreateTask_InvalidListID(t *testing.T) {
	// POST with an invalid (non-UUID) listId param -> expect 400.
	c, rec := newTestContext(http.MethodPost, "/api/v1/lists/not-a-uuid/tasks",
		`{"title":"test task"}`)
	c.SetParamNames("listId")
	c.SetParamValues("not-a-uuid")
	setUserID(c, uuid.New())

	h := &TaskHandler{
		Pool: nil,
		Repo: nil,
	}

	err := h.CreateTask(c)
	if err != nil {
		t.Fatalf("CreateTask returned an unexpected error: %v", err)
	}

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected status %d, got %d", http.StatusBadRequest, rec.Code)
	}

	var env errorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("failed to parse response body: %v", err)
	}
	if env.Error.Code != "INVALID_LIST_ID" {
		t.Errorf("expected error code INVALID_LIST_ID, got %q", env.Error.Code)
	}
}

// ---------------------------------------------------------------------------
// Auth middleware unit tests (using the real AuthMiddleware from middleware pkg)
// ---------------------------------------------------------------------------

func TestAuthMiddleware_MissingToken(t *testing.T) {
	// Request without Authorization header to a protected endpoint -> expect 401.
	e := echo.New()

	// Register a protected route behind the auth middleware.
	mw := middleware.AuthMiddleware(testJWTSecret, nil, true)
	e.Use(mw)
	e.GET("/api/v1/lists", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/lists", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status %d, got %d", http.StatusUnauthorized, rec.Code)
	}

	var env simpleErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("failed to parse response body: %v", err)
	}
	if env.Error != "missing authorization header" {
		t.Errorf("expected error 'missing authorization header', got %q", env.Error)
	}
}

func TestAuthMiddleware_ExpiredToken(t *testing.T) {
	// Send an expired JWT -> expect 401.
	e := echo.New()

	mw := middleware.AuthMiddleware(testJWTSecret, nil, true)
	e.Use(mw)
	e.GET("/api/v1/lists", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})

	expiredToken := makeJWT(uuid.New().String(), time.Now().UTC().Add(-1*time.Hour))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/lists", nil)
	req.Header.Set("Authorization", "Bearer "+expiredToken)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status %d, got %d", http.StatusUnauthorized, rec.Code)
	}

	var env simpleErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("failed to parse response body: %v", err)
	}
	if env.Error != "invalid or expired token" {
		t.Errorf("expected error 'invalid or expired token', got %q", env.Error)
	}
}

func TestAuthMiddleware_InvalidFormat(t *testing.T) {
	// Send Authorization header without "Bearer " prefix -> expect 401.
	e := echo.New()

	mw := middleware.AuthMiddleware(testJWTSecret, nil, true)
	e.Use(mw)
	e.GET("/api/v1/lists", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/lists", nil)
	req.Header.Set("Authorization", "Basic dXNlcjpwYXNz")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status %d, got %d", http.StatusUnauthorized, rec.Code)
	}

	var env simpleErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("failed to parse response body: %v", err)
	}
	if env.Error != "invalid authorization header format" {
		t.Errorf("expected error 'invalid authorization header format', got %q", env.Error)
	}
}

func TestAuthMiddleware_WrongSecret(t *testing.T) {
	// Sign a JWT with a different secret -> expect 401.
	e := echo.New()

	mw := middleware.AuthMiddleware(testJWTSecret, nil, true)
	e.Use(mw)
	e.GET("/api/v1/lists", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})

	// Sign with a different secret.
	claims := jwt.RegisteredClaims{
		Subject:   uuid.New().String(),
		ExpiresAt: jwt.NewNumericDate(time.Now().UTC().Add(1 * time.Hour)),
		IssuedAt:  jwt.NewNumericDate(time.Now().UTC()),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte("wrong-secret"))
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/lists", nil)
	req.Header.Set("Authorization", "Bearer "+signed)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected status %d, got %d", http.StatusUnauthorized, rec.Code)
	}
}

func TestAuthMiddleware_ValidToken(t *testing.T) {
	// Create a valid JWT and send it to /health (skipped) and a protected route.
	// The middleware skips /health, so we test with a protected route and verify
	// the request passes through to the handler.
	e := echo.New()

	userID := uuid.New().String()

	mw := middleware.AuthMiddleware(testJWTSecret, nil, true)
	e.Use(mw)
	e.GET("/api/v1/lists", func(c echo.Context) error {
		// The middleware should have set "userID" in the context.
		ctxUserID := c.Get("userID")
		if ctxUserID == nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "no userID in context"})
		}
		if ctxUserID.(string) != userID {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "wrong userID: got " + ctxUserID.(string),
			})
		}
		return c.JSON(http.StatusOK, map[string]string{"userID": ctxUserID.(string)})
	})

	validToken := makeJWT(userID, time.Now().UTC().Add(1*time.Hour))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/lists", nil)
	req.Header.Set("Authorization", "Bearer "+validToken)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status %d, got %d; body: %s", http.StatusOK, rec.Code, rec.Body.String())
	}

	var resp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response body: %v", err)
	}
	if resp["userID"] != userID {
		t.Errorf("expected userID %s in response, got %s", userID, resp["userID"])
	}
}

func TestAuthMiddleware_HealthSkipped(t *testing.T) {
	// The middleware skips /health — no token needed.
	e := echo.New()

	mw := middleware.AuthMiddleware(testJWTSecret, nil, true)
	e.Use(mw)
	e.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected status %d for /health, got %d; body: %s", http.StatusOK, rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// getUserID helper tests
// ---------------------------------------------------------------------------

func TestGetUserID_Missing(t *testing.T) {
	c, _ := newTestContext(http.MethodGet, "/api/v1/lists", "")
	// No userID set.

	uid, err := getUserID(c)
	if err == nil {
		t.Fatalf("expected error from getUserID with no context value, got uid=%v", uid)
	}
}

func TestGetUserID_UUIDType(t *testing.T) {
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

func TestGetUserID_StringType(t *testing.T) {
	c, _ := newTestContext(http.MethodGet, "/api/v1/lists", "")
	expected := uuid.New()
	// The auth middleware sets userID as a string.
	c.Set("userID", expected.String())

	got, err := getUserID(c)
	if err != nil {
		t.Fatalf("getUserID returned an unexpected error: %v", err)
	}
	if got != expected {
		t.Errorf("expected userID %s, got %s", expected, got)
	}
}
