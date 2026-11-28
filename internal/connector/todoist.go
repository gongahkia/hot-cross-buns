package connector

import (
	"encoding/json"
	"errors"
	"github.com/gongahkia/hot-cross-buns/internal/action"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

func todoistOperations() []serviceOperation {
	ops := []serviceOperation{{"whoami", "Verify the Todoist account.", action.ConnectedRead}, {"tasks_search", "Search active Todoist tasks using query as the Todoist filter. Follow next_cursor in cursor.", action.ConnectedRead}, {"task_comments", "Read comments for resource_id task ID; follow next_cursor.", action.ConnectedRead}, {"project_comments", "Read comments for resource_id project ID; follow next_cursor.", action.ConnectedRead}}
	for _, item := range []struct{ singular, plural string }{{"task", "tasks"}, {"project", "projects"}, {"section", "sections"}, {"label", "labels"}} {
		ops = append(ops, serviceOperation{item.plural + "_list", "List Todoist " + item.plural + " with cursor/limit; resource_id optionally filters tasks/sections to one project.", action.ConnectedRead}, serviceOperation{item.singular + "_get", "Read one Todoist " + item.singular + " by resource_id. IDs are opaque v1 IDs, never temporary IDs.", action.ConnectedRead}, serviceOperation{item.singular + "_create", "Create a Todoist " + item.singular + " after exact approval. Use content for tasks, name for other resources. Sections also require project_id.", action.ConnectedMutate}, serviceOperation{item.singular + "_update", "Update a Todoist " + item.singular + " after exact approval. Payload resource_id and changed fields; inspect current values first.", action.ConnectedMutate}, serviceOperation{item.singular + "_delete", "Delete one Todoist " + item.singular + " after exact approval. Payload resource_id only; deletion can affect children.", action.ConnectedMutate})
	}
	return append(ops, []serviceOperation{{"comment_get", "Read a comment by resource_id.", action.ConnectedRead}, {"comment_create", "Publish a comment after exact approval: payload content and exactly one of task_id/project_id.", action.Publish}, {"comment_update", "Edit a comment after exact approval: payload resource_id and content.", action.ConnectedMutate}, {"comment_delete", "Delete a comment after exact approval: payload resource_id.", action.ConnectedMutate}, {"task_close", "Complete one task after exact approval: payload resource_id.", action.ConnectedMutate}, {"task_reopen", "Reopen one task after exact approval: payload resource_id.", action.ConnectedMutate}, {"task_move", "Move one task after exact approval: payload resource_id and exactly one of project_id/section_id/parent_id.", action.ConnectedMutate}, {"project_archive", "Archive one project after exact approval: payload resource_id.", action.ConnectedMutate}, {"project_unarchive", "Unarchive one project after exact approval: payload resource_id.", action.ConnectedMutate}}...)
}
func todoistID(id string) bool { return nativeID(id) && !strings.HasPrefix(id, "tmp-") }
func todoistRead(d Descriptor, op string, in serviceInput) (string, string, []byte, error) {
	if len(in.Payload) > 0 || in.Fields != "" || in.TimeMin != "" || in.TimeMax != "" {
		return "", "", nil, errors.New("Todoist reads accept only query, resource_id, limit and cursor")
	}
	q := url.Values{"limit": {strconv.Itoa(nativeLimit(in))}}
	if in.Cursor != "" {
		q.Set("cursor", in.Cursor)
	}
	path := ""
	switch op {
	case "whoami":
		if in.ResourceID != "" || in.Query != "" || in.Cursor != "" || in.Limit != 0 {
			return "", "", nil, errors.New("account check accepts no arguments")
		}
		path = "/user"
		q = url.Values{}
	case "tasks_search":
		if strings.TrimSpace(in.Query) == "" || in.ResourceID != "" {
			return "", "", nil, errors.New("provide a Todoist filter in query")
		}
		path = "/tasks/filter"
		q.Set("query", in.Query)
	case "task_comments", "project_comments":
		if !todoistID(in.ResourceID) || in.Query != "" {
			return "", "", nil, errors.New("provide the exact task or project ID")
		}
		path = "/comments"
		key := "task_id"
		if op == "project_comments" {
			key = "project_id"
		}
		q.Set(key, in.ResourceID)
	default:
		parts := strings.Split(op, "_")
		if len(parts) != 2 {
			return "", "", nil, errors.New("unsupported Todoist read")
		}
		if !strings.Contains(" tasks projects sections labels task project section label comment ", " "+parts[0]+" ") {
			return "", "", nil, errors.New("unsupported Todoist resource")
		}
		path = "/" + parts[0]
		if parts[1] == "get" {
			if !todoistID(in.ResourceID) || in.Cursor != "" || in.Query != "" || in.Limit != 0 {
				return "", "", nil, errors.New("single-resource read requires only resource_id")
			}
			path += "s/" + url.PathEscape(in.ResourceID)
			q = url.Values{}
		} else if parts[1] == "list" {
			if in.Query != "" {
				return "", "", nil, errors.New("use tasks_search for a Todoist filter")
			}
			if in.ResourceID != "" {
				if (parts[0] != "tasks" && parts[0] != "sections") || !todoistID(in.ResourceID) {
					return "", "", nil, errors.New("project filter is available only for tasks and sections")
				}
				q.Set("project_id", in.ResourceID)
			}
		} else {
			return "", "", nil, errors.New("unsupported Todoist read")
		}
	}
	endpoint := d.Resource + path
	if len(q) > 0 {
		endpoint += "?" + q.Encode()
	}
	return endpoint, http.MethodGet, nil, nil
}
func todoistAction(d Descriptor, op string, raw []byte) (string, []byte, error) {
	parts := strings.Split(op, "_")
	if len(parts) != 2 {
		return "", nil, errors.New("unsupported Todoist action")
	}
	resource, verb := parts[0], parts[1]
	fields := map[string]string{"task": "content description project_id section_id parent_id order labels priority assignee_id due_string due_date due_datetime due_lang duration duration_unit deadline_date", "project": "name description parent_id color icon is_favorite view_style workspace_id", "section": "name project_id order", "label": "name color order is_favorite", "comment": "content task_id project_id"}[resource]
	if fields == "" {
		return "", nil, errors.New("unsupported Todoist resource")
	}
	if verb == "move" {
		fields = "project_id section_id parent_id"
	}
	if verb == "delete" || verb == "close" || verb == "reopen" || verb == "archive" || verb == "unarchive" {
		fields = ""
	}
	if verb == "update" {
		switch resource {
		case "task":
			fields = "content description labels priority assignee_id due_string due_date due_datetime due_lang duration duration_unit deadline_date child_order is_collapsed day_order"
		case "project":
			fields = "name description color icon is_favorite view_style"
		case "section":
			fields = "name order"
		case "comment":
			fields = "content"
		}
	}
	var id string
	var v map[string]json.RawMessage
	var err error
	if verb == "create" {
		v, err = nativeObject(raw, fields)
	} else {
		id, v, err = nativeResourcePayload(raw, fields)
		if !todoistID(id) {
			return "", nil, errors.New("provide an exact Todoist resource_id")
		}
	}
	if err != nil {
		return "", nil, err
	}
	if verb == "create" {
		required := "name"
		if resource == "task" || resource == "comment" {
			required = "content"
		}
		if err = nativeRequire(v, required); err != nil {
			return "", nil, err
		}
		if resource == "section" {
			if err = nativeRequire(v, "project_id"); err != nil {
				return "", nil, err
			}
		}
	}
	if resource == "comment" && verb == "create" {
		_, task := v["task_id"]
		_, project := v["project_id"]
		if task == project {
			return "", nil, errors.New("comment needs exactly one task_id or project_id")
		}
	}
	if verb == "move" {
		if resource != "task" || len(v) != 1 {
			return "", nil, errors.New("task move needs exactly one destination")
		}
	}
	if verb == "update" && len(v) == 0 {
		return "", nil, errors.New("provide fields to update")
	}
	for key, value := range v {
		switch key {
		case "labels":
			var labels []string
			if json.Unmarshal(value, &labels) != nil || len(labels) > 100 {
				return "", nil, errors.New("labels must be an array of up to 100 names")
			}
			for _, s := range labels {
				if s == "" || len(s) > 128 {
					return "", nil, errors.New("invalid label name")
				}
			}
		case "priority", "order", "child_order", "day_order", "duration":
			var n int
			if json.Unmarshal(value, &n) != nil || n < 0 || n > 100000 || key == "priority" && (n < 1 || n > 4) {
				return "", nil, errors.New("invalid numeric task field")
			}
		case "is_favorite", "is_collapsed":
			var b bool
			if json.Unmarshal(value, &b) != nil {
				return "", nil, errors.New("invalid boolean task field")
			}
		default:
			s, e := nativeString(v, key, false)
			if e != nil {
				return "", nil, e
			}
			if strings.HasSuffix(key, "_id") && !todoistID(s) {
				return "", nil, errors.New("invalid Todoist ID field")
			}
		}
	}
	path := "/" + resource + "s"
	if verb != "create" {
		path += "/" + url.PathEscape(id)
	}
	if verb == "close" || verb == "reopen" || verb == "move" || verb == "archive" || verb == "unarchive" {
		path += "/" + verb
	}
	if verb == "delete" || verb == "close" || verb == "reopen" || verb == "archive" || verb == "unarchive" {
		return d.Resource + path, nil, nil
	}
	if verb != "create" && verb != "update" && verb != "move" {
		return "", nil, errors.New("unsupported Todoist action")
	}
	return d.Resource + path, nativeJSON(v), nil
}
