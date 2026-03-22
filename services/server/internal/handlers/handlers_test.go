package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	"github.com/gongahkia/tickclone-server/internal/app"
	"github.com/gongahkia/tickclone-server/internal/database"
	"github.com/gongahkia/tickclone-server/internal/handlers"
	authmw "github.com/gongahkia/tickclone-server/internal/middleware"
	"github.com/gongahkia/tickclone-server/internal/models"
	"github.com/gongahkia/tickclone-server/internal/repository"
	"github.com/gongahkia/tickclone-server/internal/services"
)

// ---------------------------------------------------------------------------
// Integration test scaffolding
//
// These tests require a running PostgreSQL instance. They are gated behind the
// INTEGRATION_TEST environment variable so they are skipped during normal
// `go test` runs. Set INTEGRATION_TEST=1 to enable.
//
// Example:
//   INTEGRATION_TEST=1 DATABASE_URL=postgres://... go test -v ./internal/handlers/
// ---------------------------------------------------------------------------

const testSecret = "test-secret-for-jwt-signing-32chars!"

func skipIfNotIntegration(t *testing.T) {
	t.Helper()
	if os.Getenv("INTEGRATION_TEST") != "1" {
		t.Skip("skipping integration test; set INTEGRATION_TEST=1 to run")
	}
}

// migrationsPath returns the absolute path to the migrations directory.
func migrationsPath() string {
	_, filename, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(filename), "..", "..", "migrations")
}

// testEnv bundles the shared state needed by every integration test.
type testEnv struct {
	Pool   *pgxpool.Pool
	Server *httptest.Server
	App    *app.App
}

// setup initialises shared test state (database pool, Echo app, etc.).
// It registers a cleanup function via t.Cleanup so callers do not need to
// defer teardown manually.
func setup(t *testing.T) *testEnv {
	t.Helper()
	skipIfNotIntegration(t)

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		t.Fatal("DATABASE_URL must be set for integration tests")
	}

	ctx := context.Background()

	// Run migrations.
	if err := database.RunMigrations(dbURL, migrationsPath()); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	// Create a pgxpool.Pool.
	pool, err := database.NewPool(ctx, dbURL)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	cfg := &app.Config{
		MagicLinkSecret: testSecret,
		AuthRequired:    true,
	}

	application := &app.App{
		DB:     pool,
		Log:    logger,
		Config: cfg,
	}

	// Build the Echo app with all handlers registered.
	e := echo.New()
	e.HideBanner = true

	// Use the auth middleware in JWT mode.
	e.Use(authmw.AuthMiddleware(testSecret, pool, true))

	g := e.Group("/api/v1")

	// Auth handler (no auth middleware needed for these routes - middleware skips /api/v1/auth/).
	authSvc := &services.AuthService{}
	emailSvc := &services.EmailService{}
	authHandler := &handlers.AuthHandler{
		App:          application,
		AuthService:  authSvc,
		EmailService: emailSvc,
	}
	authHandler.RegisterRoutes(g)

	// List handler.
	handlers.NewListHandler(g, application)

	// Task handler.
	taskRepo := repository.NewTaskRepository()
	taskHandler := handlers.NewTaskHandler(pool, taskRepo)
	taskHandler.RegisterTaskRoutes(g)

	// Tag handler.
	handlers.NewTagHandler(g, pool)

	// Sync handler.
	syncHandler := handlers.NewSyncHandler(pool)
	syncHandler.RegisterSyncRoutes(g)

	ts := httptest.NewServer(e)

	t.Cleanup(func() {
		ts.Close()
		// Truncate test data. Order matters due to foreign keys.
		_, _ = pool.Exec(ctx, "DELETE FROM sync_log")
		_, _ = pool.Exec(ctx, "DELETE FROM task_tags")
		_, _ = pool.Exec(ctx, "DELETE FROM tasks")
		_, _ = pool.Exec(ctx, "DELETE FROM tags")
		_, _ = pool.Exec(ctx, "DELETE FROM lists")
		_, _ = pool.Exec(ctx, "DELETE FROM magic_links")
		_, _ = pool.Exec(ctx, "DELETE FROM users")
		pool.Close()
	})

	return &testEnv{
		Pool:   pool,
		Server: ts,
		App:    application,
	}
}

// createTestUser inserts a user row and returns the user ID.
func createTestUser(t *testing.T, pool *pgxpool.Pool, email string) uuid.UUID {
	t.Helper()
	var userID uuid.UUID
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email) VALUES ($1)
		 ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
		 RETURNING id`,
		email,
	).Scan(&userID)
	if err != nil {
		t.Fatalf("create test user: %v", err)
	}
	return userID
}

// authenticatedRequest creates an HTTP request with a valid JWT Bearer token
// for the given user ID.
func authenticatedRequest(t *testing.T, method, url string, body []byte, userID uuid.UUID) *http.Request {
	t.Helper()
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	authSvc := &services.AuthService{}
	token, err := authSvc.GenerateSessionToken(userID, testSecret)
	if err != nil {
		t.Fatalf("generate JWT: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	return req
}

// doRequest is a convenience wrapper that executes an authenticated HTTP request
// and returns the response.
func doRequest(t *testing.T, method, url string, body interface{}, userID uuid.UUID) *http.Response {
	t.Helper()
	var bodyBytes []byte
	if body != nil {
		var err error
		bodyBytes, err = json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
	}
	req := authenticatedRequest(t, method, url, bodyBytes, userID)
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("do request %s %s: %v", method, url, err)
	}
	return resp
}

// readJSON reads and unmarshals a response body into v. It also returns the raw bytes.
func readJSON(t *testing.T, resp *http.Response, v interface{}) []byte {
	t.Helper()
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if v != nil {
		if err := json.Unmarshal(data, v); err != nil {
			t.Fatalf("unmarshal body: %v\nbody: %s", err, string(data))
		}
	}
	return data
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

func TestListCRUD(t *testing.T) {
	env := setup(t)
	userID := createTestUser(t, env.Pool, "listcrud@test.com")
	base := env.Server.URL + "/api/v1"

	// 1. POST /api/v1/lists => 201
	resp := doRequest(t, http.MethodPost, base+"/lists", map[string]string{"name": "Shopping"}, userID)
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create list: expected 201, got %d; body: %s", resp.StatusCode, string(body))
	}
	var createdList models.List
	readJSON(t, resp, &createdList)
	if createdList.Name != "Shopping" {
		t.Errorf("expected name Shopping, got %s", createdList.Name)
	}
	if createdList.ID == uuid.Nil {
		t.Fatal("created list ID should not be nil")
	}

	// 2. GET /api/v1/lists => 200, contains created list
	resp = doRequest(t, http.MethodGet, base+"/lists", nil, userID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get lists: expected 200, got %d", resp.StatusCode)
	}
	var lists []models.List
	readJSON(t, resp, &lists)
	found := false
	for _, l := range lists {
		if l.ID == createdList.ID {
			found = true
			break
		}
	}
	if !found {
		t.Error("created list not found in GET /lists response")
	}

	// 3. PATCH /api/v1/lists/:id => 200
	resp = doRequest(t, http.MethodPatch, base+"/lists/"+createdList.ID.String(), map[string]string{"name": "Groceries"}, userID)
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("update list: expected 200, got %d; body: %s", resp.StatusCode, string(body))
	}
	var updatedList models.List
	readJSON(t, resp, &updatedList)
	if updatedList.Name != "Groceries" {
		t.Errorf("expected name Groceries, got %s", updatedList.Name)
	}

	// 4. DELETE /api/v1/lists/:id => 204
	resp = doRequest(t, http.MethodDelete, base+"/lists/"+createdList.ID.String(), nil, userID)
	if resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("delete list: expected 204, got %d; body: %s", resp.StatusCode, string(body))
	}
	resp.Body.Close()

	// 5. GET /api/v1/lists/:id => 404 (soft-deleted)
	resp = doRequest(t, http.MethodGet, base+"/lists/"+createdList.ID.String(), nil, userID)
	if resp.StatusCode != http.StatusNotFound {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("get deleted list: expected 404, got %d; body: %s", resp.StatusCode, string(body))
	}
	resp.Body.Close()
}

func TestTaskCRUD(t *testing.T) {
	env := setup(t)
	userID := createTestUser(t, env.Pool, "taskcrud@test.com")
	base := env.Server.URL + "/api/v1"

	// Create a list first.
	resp := doRequest(t, http.MethodPost, base+"/lists", map[string]string{"name": "Work"}, userID)
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create list: expected 201, got %d; body: %s", resp.StatusCode, string(body))
	}
	var list models.List
	readJSON(t, resp, &list)

	// 1. POST /api/v1/lists/:listId/tasks => 201
	resp = doRequest(t, http.MethodPost, base+"/lists/"+list.ID.String()+"/tasks",
		map[string]string{"title": "Write tests"}, userID)
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create task: expected 201, got %d; body: %s", resp.StatusCode, string(body))
	}
	var parentTask models.Task
	readJSON(t, resp, &parentTask)
	if parentTask.Title != "Write tests" {
		t.Errorf("expected title 'Write tests', got %q", parentTask.Title)
	}

	// 2. Create a subtask under the parent task.
	resp = doRequest(t, http.MethodPost, base+"/lists/"+list.ID.String()+"/tasks",
		map[string]interface{}{"title": "Write unit tests", "parentTaskId": parentTask.ID.String()}, userID)
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create subtask: expected 201, got %d; body: %s", resp.StatusCode, string(body))
	}
	var subtask models.Task
	readJSON(t, resp, &subtask)

	// 3. GET /api/v1/tasks/:id => 200, verify nesting
	resp = doRequest(t, http.MethodGet, base+"/tasks/"+parentTask.ID.String(), nil, userID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get task: expected 200, got %d", resp.StatusCode)
	}
	var fetchedTask models.Task
	readJSON(t, resp, &fetchedTask)
	if len(fetchedTask.Subtasks) != 1 {
		t.Fatalf("expected 1 subtask, got %d", len(fetchedTask.Subtasks))
	}
	if fetchedTask.Subtasks[0].ID != subtask.ID {
		t.Errorf("subtask ID mismatch: expected %s, got %s", subtask.ID, fetchedTask.Subtasks[0].ID)
	}

	// 4. PATCH /api/v1/tasks/:id => 200, mark complete
	status := 1
	resp = doRequest(t, http.MethodPatch, base+"/tasks/"+parentTask.ID.String(),
		map[string]interface{}{"status": status}, userID)
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("update task: expected 200, got %d; body: %s", resp.StatusCode, string(body))
	}
	var completedTask models.Task
	readJSON(t, resp, &completedTask)
	if completedTask.Status != 1 {
		t.Errorf("expected status 1, got %d", completedTask.Status)
	}

	// 5. DELETE /api/v1/tasks/:id => 204
	resp = doRequest(t, http.MethodDelete, base+"/tasks/"+parentTask.ID.String(), nil, userID)
	if resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("delete task: expected 204, got %d; body: %s", resp.StatusCode, string(body))
	}
	resp.Body.Close()

	// 6. GET /api/v1/tasks/:id => 404
	resp = doRequest(t, http.MethodGet, base+"/tasks/"+parentTask.ID.String(), nil, userID)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("get deleted task: expected 404, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestSubtaskDepthLimit(t *testing.T) {
	env := setup(t)
	userID := createTestUser(t, env.Pool, "depthlimit@test.com")
	base := env.Server.URL + "/api/v1"

	// Create a list.
	resp := doRequest(t, http.MethodPost, base+"/lists", map[string]string{"name": "Depth Test"}, userID)
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create list: expected 201, got %d; body: %s", resp.StatusCode, string(body))
	}
	var list models.List
	readJSON(t, resp, &list)

	// Create a top-level task.
	resp = doRequest(t, http.MethodPost, base+"/lists/"+list.ID.String()+"/tasks",
		map[string]string{"title": "Top level"}, userID)
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create task: expected 201, got %d; body: %s", resp.StatusCode, string(body))
	}
	var topTask models.Task
	readJSON(t, resp, &topTask)

	// Create a subtask under the top-level task => 201.
	resp = doRequest(t, http.MethodPost, base+"/lists/"+list.ID.String()+"/tasks",
		map[string]interface{}{"title": "Subtask level 1", "parentTaskId": topTask.ID.String()}, userID)
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create subtask: expected 201, got %d; body: %s", resp.StatusCode, string(body))
	}
	var subtask models.Task
	readJSON(t, resp, &subtask)

	// Attempt to create a sub-subtask under the subtask => 400 NESTING_DEPTH_EXCEEDED.
	resp = doRequest(t, http.MethodPost, base+"/lists/"+list.ID.String()+"/tasks",
		map[string]interface{}{"title": "Sub-subtask level 2", "parentTaskId": subtask.ID.String()}, userID)
	if resp.StatusCode != http.StatusBadRequest {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create sub-subtask: expected 400, got %d; body: %s", resp.StatusCode, string(body))
	}

	var errResp map[string]interface{}
	raw := readJSON(t, resp, &errResp)
	errObj, ok := errResp["error"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected error object in response, got: %s", string(raw))
	}
	if code, ok := errObj["code"].(string); !ok || code != "NESTING_DEPTH_EXCEEDED" {
		t.Errorf("expected error code NESTING_DEPTH_EXCEEDED, got %v", errObj["code"])
	}
}

func TestTagOperations(t *testing.T) {
	env := setup(t)
	userID := createTestUser(t, env.Pool, "tagops@test.com")
	base := env.Server.URL + "/api/v1"

	// Create a list and task for tag association.
	resp := doRequest(t, http.MethodPost, base+"/lists", map[string]string{"name": "Tag Test List"}, userID)
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create list: expected 201, got %d; body: %s", resp.StatusCode, string(body))
	}
	var list models.List
	readJSON(t, resp, &list)

	resp = doRequest(t, http.MethodPost, base+"/lists/"+list.ID.String()+"/tasks",
		map[string]string{"title": "Tagged task"}, userID)
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create task: expected 201, got %d; body: %s", resp.StatusCode, string(body))
	}
	var task models.Task
	readJSON(t, resp, &task)

	// 1. POST /api/v1/tags => 201
	resp = doRequest(t, http.MethodPost, base+"/tags", map[string]string{"name": "urgent"}, userID)
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create tag: expected 201, got %d; body: %s", resp.StatusCode, string(body))
	}
	var tag models.Tag
	readJSON(t, resp, &tag)
	if tag.Name != "urgent" {
		t.Errorf("expected tag name 'urgent', got %q", tag.Name)
	}

	// 2. GET /api/v1/tags => 200
	resp = doRequest(t, http.MethodGet, base+"/tags", nil, userID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get tags: expected 200, got %d", resp.StatusCode)
	}
	var tags []models.Tag
	readJSON(t, resp, &tags)
	if len(tags) < 1 {
		t.Fatal("expected at least 1 tag")
	}

	// 3. POST /api/v1/tasks/:taskId/tags/:tagId => 204
	resp = doRequest(t, http.MethodPost, base+"/tasks/"+task.ID.String()+"/tags/"+tag.ID.String(), nil, userID)
	if resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("add tag to task: expected 204, got %d; body: %s", resp.StatusCode, string(body))
	}
	resp.Body.Close()

	// 4. GET /api/v1/tags/:id/tasks => 200, contains the task
	resp = doRequest(t, http.MethodGet, base+"/tags/"+tag.ID.String()+"/tasks", nil, userID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get tasks by tag: expected 200, got %d", resp.StatusCode)
	}
	var tagTasks []models.Task
	readJSON(t, resp, &tagTasks)
	if len(tagTasks) != 1 {
		t.Fatalf("expected 1 task for tag, got %d", len(tagTasks))
	}
	if tagTasks[0].ID != task.ID {
		t.Errorf("expected task ID %s, got %s", task.ID, tagTasks[0].ID)
	}

	// 5. DELETE /api/v1/tasks/:taskId/tags/:tagId => 204
	resp = doRequest(t, http.MethodDelete, base+"/tasks/"+task.ID.String()+"/tags/"+tag.ID.String(), nil, userID)
	if resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("remove tag from task: expected 204, got %d; body: %s", resp.StatusCode, string(body))
	}
	resp.Body.Close()

	// Verify tag removed: GET /api/v1/tags/:id/tasks => 200, empty
	resp = doRequest(t, http.MethodGet, base+"/tags/"+tag.ID.String()+"/tasks", nil, userID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get tasks by tag after removal: expected 200, got %d", resp.StatusCode)
	}
	var emptyTasks []models.Task
	readJSON(t, resp, &emptyTasks)
	if len(emptyTasks) != 0 {
		t.Errorf("expected 0 tasks after tag removal, got %d", len(emptyTasks))
	}

	// 6. DELETE /api/v1/tags/:id => 204
	resp = doRequest(t, http.MethodDelete, base+"/tags/"+tag.ID.String(), nil, userID)
	if resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("delete tag: expected 204, got %d; body: %s", resp.StatusCode, string(body))
	}
	resp.Body.Close()
}

func TestRecurringTaskCompletion(t *testing.T) {
	env := setup(t)
	userID := createTestUser(t, env.Pool, "recurring@test.com")
	base := env.Server.URL + "/api/v1"

	// Create a list.
	resp := doRequest(t, http.MethodPost, base+"/lists", map[string]string{"name": "Recurring List"}, userID)
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create list: expected 201, got %d; body: %s", resp.StatusCode, string(body))
	}
	var list models.List
	readJSON(t, resp, &list)

	// Create a task with a recurrence_rule and due_date.
	dueDate := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second)
	taskPayload := map[string]interface{}{
		"title":          "Daily standup",
		"recurrenceRule": "FREQ=DAILY;COUNT=5",
		"dueDate":        dueDate.Format(time.RFC3339),
	}
	resp = doRequest(t, http.MethodPost, base+"/lists/"+list.ID.String()+"/tasks", taskPayload, userID)
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create recurring task: expected 201, got %d; body: %s", resp.StatusCode, string(body))
	}
	var recurringTask models.Task
	readJSON(t, resp, &recurringTask)

	// POST /api/v1/tasks/:id/complete => 200
	resp = doRequest(t, http.MethodPost, base+"/tasks/"+recurringTask.ID.String()+"/complete", nil, userID)
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("complete recurring task: expected 200, got %d; body: %s", resp.StatusCode, string(body))
	}

	var completeResp struct {
		Completed *models.Task `json:"completed"`
		Next      *models.Task `json:"next"`
	}
	readJSON(t, resp, &completeResp)

	// Verify response contains both completed and next task.
	if completeResp.Completed == nil {
		t.Fatal("expected completed task in response")
	}
	if completeResp.Completed.Status != 1 {
		t.Errorf("expected completed task status 1, got %d", completeResp.Completed.Status)
	}

	if completeResp.Next == nil {
		t.Fatal("expected next task in response for recurring task")
	}
	if completeResp.Next.Status != 0 {
		t.Errorf("expected next task status 0, got %d", completeResp.Next.Status)
	}
	if completeResp.Next.DueDate == nil {
		t.Fatal("expected next task to have a due date")
	}

	// The next task's due date should be after the original due date.
	if !completeResp.Next.DueDate.After(dueDate.Add(-time.Second)) {
		t.Errorf("expected next due date after %v, got %v", dueDate, *completeResp.Next.DueDate)
	}
}

func TestMagicLinkAuth(t *testing.T) {
	env := setup(t)
	base := env.Server.URL + "/api/v1"
	testEmail := fmt.Sprintf("magiclink-%s@test.com", uuid.NewString()[:8])

	// 1. POST /api/v1/auth/magic-link with a valid email => 200
	// Auth endpoints are skipped by the middleware, so no JWT needed.
	body, _ := json.Marshal(map[string]string{"email": testEmail})
	req, err := http.NewRequest(http.MethodPost, base+"/auth/magic-link", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("magic link request: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("magic link: expected 200, got %d; body: %s", resp.StatusCode, string(respBody))
	}
	var magicResp map[string]string
	readJSON(t, resp, &magicResp)
	if magicResp["message"] == "" {
		t.Error("expected a message in magic link response")
	}

	// 2. Extract token from DB (test helper).
	var token string
	err = env.Pool.QueryRow(context.Background(),
		`SELECT ml.token FROM magic_links ml
		 JOIN users u ON ml.user_id = u.id
		 WHERE u.email = $1 AND ml.used_at IS NULL
		 ORDER BY ml.expires_at DESC
		 LIMIT 1`,
		testEmail,
	).Scan(&token)
	if err != nil {
		t.Fatalf("query magic link token: %v", err)
	}
	if token == "" {
		t.Fatal("no magic link token found in DB")
	}

	// 3. POST /api/v1/auth/verify with the token => 200, get JWT.
	verifyBody, _ := json.Marshal(map[string]string{"token": token})
	req, err = http.NewRequest(http.MethodPost, base+"/auth/verify", bytes.NewReader(verifyBody))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err = client.Do(req)
	if err != nil {
		t.Fatalf("verify request: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("verify: expected 200, got %d; body: %s", resp.StatusCode, string(respBody))
	}
	var verifyResp struct {
		Token     string `json:"token"`
		ExpiresAt string `json:"expiresAt"`
	}
	readJSON(t, resp, &verifyResp)
	if verifyResp.Token == "" {
		t.Fatal("expected JWT token in verify response")
	}

	// 4. Use the JWT to call an authenticated endpoint => 200.
	req, err = http.NewRequest(http.MethodGet, base+"/lists", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+verifyResp.Token)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatalf("authenticated request: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("authenticated GET /lists: expected 200, got %d; body: %s", resp.StatusCode, string(respBody))
	}
	resp.Body.Close()

	// 5. POST /api/v1/auth/verify with the same token again => 401 (consumed).
	req, err = http.NewRequest(http.MethodPost, base+"/auth/verify", bytes.NewReader(verifyBody))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err = client.Do(req)
	if err != nil {
		t.Fatalf("second verify request: %v", err)
	}
	if resp.StatusCode != http.StatusUnauthorized {
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("second verify: expected 401, got %d; body: %s", resp.StatusCode, string(respBody))
	}
	resp.Body.Close()
}

func TestSyncPushPull(t *testing.T) {
	env := setup(t)
	userID := createTestUser(t, env.Pool, "sync@test.com")
	base := env.Server.URL + "/api/v1"

	// Create a list and a task via HTTP so that entities exist for sync operations.
	resp := doRequest(t, http.MethodPost, base+"/lists", map[string]string{"name": "Sync List"}, userID)
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create list: expected 201, got %d; body: %s", resp.StatusCode, string(body))
	}
	var list models.List
	readJSON(t, resp, &list)

	resp = doRequest(t, http.MethodPost, base+"/lists/"+list.ID.String()+"/tasks",
		map[string]string{"title": "Sync task"}, userID)
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create task: expected 201, got %d; body: %s", resp.StatusCode, string(body))
	}
	var task models.Task
	readJSON(t, resp, &task)

	now := time.Now().UTC()
	batchID := uuid.NewString()

	// Build a change record.
	newTitle, _ := json.Marshal("Synced title")
	pushPayload := models.SyncPushPayload{
		DeviceID: "device-A",
		BatchID:  batchID,
		Changes: []models.ChangeRecord{
			{
				EntityType: "task",
				EntityID:   task.ID.String(),
				FieldName:  "title",
				NewValue:   json.RawMessage(newTitle),
				Timestamp:  now,
			},
		},
	}

	// 1. POST /api/v1/sync/push from device A => 200
	resp = doRequest(t, http.MethodPost, base+"/sync/push", pushPayload, userID)
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("sync push: expected 200, got %d; body: %s", resp.StatusCode, string(body))
	}
	var pushResp models.PushResponse
	readJSON(t, resp, &pushResp)
	if pushResp.Accepted != 1 {
		t.Errorf("expected 1 accepted change, got %d", pushResp.Accepted)
	}
	if pushResp.BatchID != batchID {
		t.Errorf("expected batchId %s, got %s", batchID, pushResp.BatchID)
	}

	// 2. POST /api/v1/sync/pull from device B => 200
	pullPayload := models.SyncPullPayload{
		DeviceID:   "device-B",
		LastSyncAt: now.Add(-time.Minute),
	}
	resp = doRequest(t, http.MethodPost, base+"/sync/pull", pullPayload, userID)
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("sync pull: expected 200, got %d; body: %s", resp.StatusCode, string(body))
	}
	var pullResp models.SyncPullResponse
	readJSON(t, resp, &pullResp)

	// 3. Verify pulled changes contain the pushed data.
	if len(pullResp.Changes) < 1 {
		t.Fatal("expected at least 1 change in pull response")
	}
	found := false
	for _, change := range pullResp.Changes {
		if change.EntityID == task.ID.String() && change.FieldName == "title" {
			found = true
			var title string
			if err := json.Unmarshal(change.NewValue, &title); err == nil {
				if title != "Synced title" {
					t.Errorf("expected synced title 'Synced title', got %q", title)
				}
			}
			break
		}
	}
	if !found {
		t.Error("pushed change not found in pull response")
	}

	// 4. Pull from device A with lastSyncAt=now should return no changes
	// (device A's own changes are excluded).
	pullPayloadA := models.SyncPullPayload{
		DeviceID:   "device-A",
		LastSyncAt: now.Add(-time.Minute),
	}
	resp = doRequest(t, http.MethodPost, base+"/sync/pull", pullPayloadA, userID)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("sync pull device-A: expected 200, got %d", resp.StatusCode)
	}
	var pullRespA models.SyncPullResponse
	readJSON(t, resp, &pullRespA)
	if len(pullRespA.Changes) != 0 {
		t.Errorf("expected 0 changes for device-A (own changes excluded), got %d", len(pullRespA.Changes))
	}
}
