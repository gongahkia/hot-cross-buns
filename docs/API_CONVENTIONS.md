# API Conventions

REST API patterns for the Hot Cross Buns sync server. All endpoints live under `/api/v1`.

See also: [ARCHITECTURE.md](./ARCHITECTURE.md) for data models, [STYLE_GUIDE.md](./STYLE_GUIDE.md) for Go naming.

---

## Base URL

```
http://localhost:8080/api/v1
```

---

## General Rules

- RESTful: plural nouns, HTTP verbs for actions
- JSON request/response bodies (`Content-Type: application/json`)
- Dates: ISO 8601 with timezone (`2026-03-22T14:30:00Z`)
- IDs: UUIDv7 strings
- Responses: flat JSON objects or arrays (no `{ data: ... }` wrapper for success)
- Errors: always use the standard error envelope (see [Error Format](#error-format))
- Field casing: **camelCase** in JSON (`createdAt`, `parentTaskId`, `listId`)
- Null fields: included in responses (not omitted), set to `null`
- Partial updates (PATCH): only include fields to change; omitted fields are untouched
- Timestamps: always UTC

---

## Authentication

All endpoints except `/api/v1/auth/*` and `GET /health` require a Bearer token.

```
Authorization: Bearer <jwt>
```

**JWT claims:**
- `sub`: user UUID
- `iat`: issued-at timestamp
- `exp`: expiry (30 days from issuance)
- Algorithm: HS256

When `AUTH_REQUIRED=false` (local mode), unauthenticated requests are handled as the default local user.

---

## HTTP Methods

| Method | Semantics | Request Body | Success Response |
|---|---|---|---|
| GET | Read resource(s) | None | `200` + JSON |
| POST | Create resource or action | JSON | `201` (create) or `200` (action) |
| PATCH | Partial update | JSON (partial) | `200` + full updated object |
| DELETE | Soft-delete | None | `204` (no body) |

---

## Endpoints

### Health

```
GET /health
```

Response `200`:
```json
{
  "status": "ok",
  "time": "2026-03-22T14:30:00Z"
}
```

---

### Auth

**Request magic link:**
```
POST /api/v1/auth/magic-link
```
```json
{
  "email": "user@example.com"
}
```
Response `200`:
```json
{
  "message": "If that email is registered, a link has been sent."
}
```

**Verify token:**
```
POST /api/v1/auth/verify
```
```json
{
  "token": "base64url-encoded-token"
}
```
Response `200`:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresAt": "2026-04-21T14:30:00Z"
}
```

---

### Lists

```
POST   /api/v1/lists
GET    /api/v1/lists
GET    /api/v1/lists/:id
PATCH  /api/v1/lists/:id
DELETE /api/v1/lists/:id
```

**Create:**

Request `POST /api/v1/lists`:
```json
{
  "name": "Work",
  "color": "#89b4fa"
}
```
Response `201`:
```json
{
  "id": "019513a4-7e2b-7000-8000-000000000001",
  "name": "Work",
  "color": "#89b4fa",
  "sortOrder": 0,
  "isInbox": false,
  "createdAt": "2026-03-22T14:30:00Z",
  "updatedAt": "2026-03-22T14:30:00Z"
}
```

**Update:**

Request `PATCH /api/v1/lists/:id`:
```json
{
  "color": "#f38ba8"
}
```
Response `200`: full list object with updated fields.

**Delete:** Response `204` (no body). Returns `409` if attempting to delete the Inbox.

---

### Tasks

```
POST   /api/v1/lists/:listId/tasks
GET    /api/v1/lists/:listId/tasks?includeCompleted=false
GET    /api/v1/tasks/:id
PATCH  /api/v1/tasks/:id
DELETE /api/v1/tasks/:id
POST   /api/v1/tasks/:id/move
POST   /api/v1/tasks/:id/complete
```

**Create:**

Request `POST /api/v1/lists/:listId/tasks`:
```json
{
  "title": "Buy groceries",
  "priority": 2,
  "dueDate": "2026-03-23T17:00:00Z",
  "dueTimezone": "Asia/Singapore",
  "parentTaskId": null,
  "recurrenceRule": null,
  "content": "- Milk\n- Eggs\n- Bread"
}
```
Response `201`:
```json
{
  "id": "019513a4-7e2b-7000-8000-000000000010",
  "listId": "019513a4-7e2b-7000-8000-000000000001",
  "parentTaskId": null,
  "title": "Buy groceries",
  "content": "- Milk\n- Eggs\n- Bread",
  "priority": 2,
  "status": 0,
  "dueDate": "2026-03-23T17:00:00Z",
  "dueTimezone": "Asia/Singapore",
  "recurrenceRule": null,
  "sortOrder": 0,
  "completedAt": null,
  "createdAt": "2026-03-22T14:30:00Z",
  "updatedAt": "2026-03-22T14:30:00Z",
  "subtasks": [],
  "tags": []
}
```

**Get tasks** (nested subtasks + tags):

Response `200`:
```json
[
  {
    "id": "019513a4-...-000010",
    "listId": "019513a4-...-000001",
    "parentTaskId": null,
    "title": "Buy groceries",
    "content": "- Milk\n- Eggs\n- Bread",
    "priority": 2,
    "status": 0,
    "dueDate": "2026-03-23T17:00:00Z",
    "dueTimezone": "Asia/Singapore",
    "recurrenceRule": null,
    "sortOrder": 0,
    "completedAt": null,
    "createdAt": "2026-03-22T14:30:00Z",
    "updatedAt": "2026-03-22T14:30:00Z",
    "subtasks": [
      {
        "id": "019513a4-...-000011",
        "title": "Get milk",
        "priority": 0,
        "status": 0,
        "subtasks": [],
        "tags": []
      }
    ],
    "tags": [
      {
        "id": "019513a4-...-000020",
        "name": "errand",
        "color": "#fab387"
      }
    ]
  }
]
```

**Move task:**

Request `POST /api/v1/tasks/:id/move`:
```json
{
  "listId": "019513a4-7e2b-7000-8000-000000000002",
  "sortOrder": 0
}
```
Response `200`: full task object with updated `listId` and `sortOrder`.

**Complete task (non-recurring):**

Request `POST /api/v1/tasks/:id/complete` (no body)

Response `200`:
```json
{
  "completed": {
    "id": "019513a4-...-000010",
    "status": 1,
    "completedAt": "2026-03-22T14:35:00Z"
  },
  "next": null
}
```

**Complete task (recurring):**

Response `200`:
```json
{
  "completed": {
    "id": "019513a4-...-000010",
    "status": 1,
    "completedAt": "2026-03-22T14:35:00Z"
  },
  "next": {
    "id": "019513a4-...-000012",
    "title": "Buy groceries",
    "dueDate": "2026-03-24T17:00:00Z",
    "status": 0,
    "completedAt": null
  }
}
```

---

### Tags

```
POST   /api/v1/tags
GET    /api/v1/tags
PATCH  /api/v1/tags/:id
DELETE /api/v1/tags/:id
POST   /api/v1/tasks/:taskId/tags/:tagId
DELETE /api/v1/tasks/:taskId/tags/:tagId
GET    /api/v1/tags/:id/tasks
```

**Create:**

Request `POST /api/v1/tags`:
```json
{
  "name": "urgent",
  "color": "#f38ba8"
}
```
Response `201`:
```json
{
  "id": "019513a4-7e2b-7000-8000-000000000020",
  "name": "urgent",
  "color": "#f38ba8",
  "createdAt": "2026-03-22T14:30:00Z"
}
```

**Associate / disassociate tag:** Response `204` (no body). Association is idempotent.

**Get tasks by tag:** Response `200` with array of task objects (same shape as list tasks).

---

### Sync

```
POST /api/v1/sync/push
POST /api/v1/sync/pull
```

**Push changes:**

Request `POST /api/v1/sync/push`:
```json
{
  "deviceId": "device-abc-123",
  "batchId": "019513a4-7e2b-7000-8000-0000000000b1",
  "changes": [
    {
      "entityType": "task",
      "entityId": "019513a4-...-000010",
      "fieldName": "title",
      "newValue": "Buy groceries and snacks",
      "timestamp": "2026-03-22T14:35:00Z"
    },
    {
      "entityType": "task",
      "entityId": "019513a4-...-000010",
      "fieldName": "priority",
      "newValue": 3,
      "timestamp": "2026-03-22T14:35:00Z"
    }
  ]
}
```
Response `200`:
```json
{
  "batchId": "019513a4-7e2b-7000-8000-0000000000b1",
  "accepted": 2,
  "conflicts": 0
}
```

**Pull changes:**

Request `POST /api/v1/sync/pull`:
```json
{
  "deviceId": "device-xyz-456",
  "lastSyncAt": "2026-03-22T14:00:00Z"
}
```
Response `200`:
```json
{
  "changes": [
    {
      "entityType": "task",
      "entityId": "019513a4-...-000010",
      "fieldName": "title",
      "newValue": "Buy groceries and snacks",
      "timestamp": "2026-03-22T14:35:00Z"
    }
  ],
  "serverTime": "2026-03-22T14:36:00Z"
}
```

**Sync change object fields:**
- `entityType`: `"list"`, `"task"`, or `"tag"`
- `entityId`: UUIDv7 of the entity
- `fieldName`: the specific field that changed (e.g., `"title"`, `"priority"`, `"status"`)
- `newValue`: raw JSON value (string, number, boolean, or null)
- `timestamp`: ISO 8601 when the change was made on the originating device

---

## Error Format

All errors use a consistent envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields are invalid.",
    "details": [
      {
        "field": "name",
        "message": "Required, must be 1-255 characters."
      },
      {
        "field": "color",
        "message": "Must be a valid hex color (e.g., #FF0000)."
      }
    ]
  }
}
```

### Error Codes

| HTTP Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Request body fails validation |
| 400 | `INVALID_REQUEST` | Malformed JSON, missing required fields |
| 401 | `UNAUTHORIZED` | Missing or invalid Bearer token |
| 403 | `FORBIDDEN` | Valid token but insufficient permissions |
| 404 | `NOT_FOUND` | Resource does not exist or is soft-deleted |
| 409 | `CONFLICT` | Business rule violation (delete inbox, subtask depth) |
| 409 | `SYNC_CONFLICT` | Sync push rejected due to older timestamp |
| 429 | `RATE_LIMITED` | Too many requests; check `Retry-After` header |
| 500 | `INTERNAL_ERROR` | Unexpected server error (no internal details exposed) |

### Error Examples

**401 Unauthorized:**
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired authentication token.",
    "details": []
  }
}
```

**409 Conflict (delete inbox):**
```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Cannot delete the Inbox list.",
    "details": []
  }
}
```

**409 Conflict (subtask depth):**
```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Subtask nesting limited to 1 level.",
    "details": [
      {
        "field": "parentTaskId",
        "message": "Target task is already a subtask."
      }
    ]
  }
}
```

**429 Rate Limited:**
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Try again later.",
    "details": []
  }
}
```
Response headers: `Retry-After: 12` (seconds until next allowed request)

---

## Rate Limits

| Endpoint Group | Limit | Window |
|---|---|---|
| `/api/v1/auth/*` | 5 requests | 1 minute |
| `/api/v1/sync/*` | 60 requests | 1 minute |
| All other `/api/v1/*` | 120 requests | 1 minute |

Rate limit headers on every response:
- `X-RateLimit-Limit`: max requests in window
- `X-RateLimit-Remaining`: requests left
- `X-RateLimit-Reset`: Unix timestamp when window resets

---

## Input Validation

| Field | Rule |
|---|---|
| `name` (list/tag) | Required, 1-255 characters |
| `title` (task) | Required, 1-500 characters |
| `content` (task) | Optional, max 10,000 characters |
| `color` | Optional, valid hex color (`#RRGGBB`) |
| `priority` | Integer 0-3 |
| `email` | Valid email format |
| `recurrenceRule` | Valid RFC 5545 RRULE string or null |
| `dueTimezone` | Valid IANA timezone string or null |
| UUIDs | Valid UUIDv7 format |
