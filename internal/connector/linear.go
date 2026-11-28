package connector

import (
	"encoding/json"
	"errors"
	"github.com/gongahkia/hot-cross-buns/internal/action"
	"net/http"
	"strings"
)

const linearIssueFields = `id identifier title description url updatedAt dueDate priority estimate team { id name key } state { id name type } assignee { id name } project { id name } labels { nodes { id name } }`
const linearProjectFields = `id name description content url updatedAt startDate targetDate status { id name } lead { id name }`

func linearOperations() []serviceOperation {
	ops := []serviceOperation{
		{"whoami", "Verify the Linear viewer and organization.", action.ConnectedRead},
		{"teams_list", "List accessible Linear teams, cursor/limit supported.", action.ConnectedRead},
		{"users_list", "List accessible Linear users, cursor/limit supported.", action.ConnectedRead},
		{"states_list", "List workflow states for resource_id team UUID, cursor/limit supported.", action.ConnectedRead},
		{"labels_list", "List issue labels, optionally filtered to resource_id team UUID.", action.ConnectedRead},
		{"issues_list", "List issues; query filters title case-insensitively and resource_id optionally selects team UUID. Cursor is pageInfo.endCursor.", action.ConnectedRead},
		{"issue_get", "Read issue by resource_id UUID or identifier such as ENG-123.", action.ConnectedRead},
		{"issue_comments", "Read issue comments by resource_id issue UUID or identifier, cursor/limit supported.", action.ConnectedRead},
		{"projects_list", "List projects; query filters name case-insensitively, cursor/limit supported.", action.ConnectedRead},
		{"project_get", "Read one project by resource_id UUID.", action.ConnectedRead},
		{"issue_create", "Create an issue after exact approval. Payload title, teamId; optional description, assigneeId, stateId, projectId, parentId, cycleId, labelIds, priority, estimate, dueDate.", action.ConnectedMutate},
		{"issue_update", "Update an issue after exact approval. Payload resource_id and changed issue fields; teamId can move the issue.", action.ConnectedMutate},
		{"comment_create", "Publish a comment after exact approval. Payload issueId, body Markdown, optional parentId for a reply.", action.Publish},
		{"comment_update", "Edit a comment after exact approval. Payload resource_id and body.", action.ConnectedMutate},
		{"project_create", "Create a project after exact approval. Payload name and nonempty teamIds array; optional description, content, leadId, memberIds, statusId, startDate, targetDate, priority.", action.ConnectedMutate},
		{"project_update", "Update a project after exact approval. Payload resource_id and changed project fields.", action.ConnectedMutate},
	}
	for _, resource := range []string{"issue", "project"} {
		for _, verb := range []string{"archive", "unarchive", "delete"} {
			ops = append(ops, serviceOperation{resource + "_" + verb, "After exact approval, " + verb + " one Linear " + resource + ". Payload resource_id only. Deleting can affect linked work.", action.ConnectedMutate})
		}
	}
	return append(ops, serviceOperation{"comment_delete", "Delete one comment after exact approval. Payload resource_id only.", action.ConnectedMutate})
}
func linearRead(d Descriptor, op string, in serviceInput) (string, string, []byte, error) {
	if len(in.Payload) > 0 || in.Fields != "" || in.TimeMin != "" || in.TimeMax != "" {
		return "", "", nil, errors.New("Linear reads accept query, resource_id, cursor and limit only")
	}
	vars := map[string]any{"first": nativeLimit(in)}
	if in.Cursor != "" {
		vars["after"] = in.Cursor
	}
	page := `pageInfo { hasNextPage endCursor }`
	args := `first:$first, after:$after`
	decl := `$first:Int!, $after:String`
	query := ""
	switch op {
	case "whoami":
		if in.ResourceID != "" || in.Query != "" || in.Cursor != "" || in.Limit != 0 {
			return "", "", nil, errors.New("viewer check accepts no arguments")
		}
		query = `query { viewer { id name email } organization { id name urlKey } }`
		vars = map[string]any{}
	case "issue_get", "project_get":
		if !nativeID(in.ResourceID) || in.Query != "" || in.Cursor != "" || in.Limit != 0 {
			return "", "", nil, errors.New("provide only the exact resource_id")
		}
		field, fields := "issue", linearIssueFields
		if op == "project_get" {
			field, fields = "project", linearProjectFields
		}
		query = `query($id:String!) { ` + field + `(id:$id) { ` + fields + ` } }`
		vars = map[string]any{"id": in.ResourceID}
	case "issue_comments":
		if !nativeID(in.ResourceID) || in.Query != "" {
			return "", "", nil, errors.New("provide an issue resource_id")
		}
		vars["id"] = in.ResourceID
		query = `query(` + decl + `,$id:String!){issue(id:$id){comments(` + args + `){nodes{id body createdAt updatedAt user{id name}} ` + page + `}}}`
	case "teams_list", "users_list":
		if in.ResourceID != "" || in.Query != "" {
			return "", "", nil, errors.New("this list accepts only cursor and limit")
		}
		field, fields := "teams", "id name key"
		if op == "users_list" {
			field, fields = "users", "id name email active"
		}
		query = `query(` + decl + `){` + field + `(` + args + `){nodes{` + fields + `} ` + page + `}}`
	case "states_list":
		if !nativeID(in.ResourceID) || in.Query != "" {
			return "", "", nil, errors.New("provide a team UUID in resource_id")
		}
		vars["id"] = in.ResourceID
		query = `query(` + decl + `,$id:String!){team(id:$id){states(` + args + `){nodes{id name type position} ` + page + `}}}`
	case "issues_list", "labels_list", "projects_list":
		filter := map[string]any{}
		field, typ, fields := "issues", "IssueFilter", linearIssueFields
		if op == "labels_list" {
			field, typ, fields = "issueLabels", "IssueLabelFilter", "id name color team{id name}"
		}
		if op == "projects_list" {
			field, typ, fields = "projects", "ProjectFilter", linearProjectFields
		}
		if in.Query != "" {
			if op == "labels_list" {
				return "", "", nil, errors.New("label listing does not accept query")
			}
			key := "title"
			if op == "projects_list" {
				key = "name"
			}
			filter[key] = map[string]string{"containsIgnoreCase": in.Query}
		}
		if in.ResourceID != "" {
			if !nativeID(in.ResourceID) || op == "projects_list" {
				return "", "", nil, errors.New("team resource_id is available for issues and labels only")
			}
			filter["team"] = map[string]any{"id": map[string]string{"eq": in.ResourceID}}
		}
		vars["filter"] = filter
		query = `query(` + decl + `,$filter:` + typ + `){` + field + `(` + args + `,filter:$filter){nodes{` + fields + `} ` + page + `}}`
	default:
		return "", "", nil, errors.New("unsupported Linear read")
	}
	return d.Resource, http.MethodPost, nativeJSON(map[string]any{"query": query, "variables": vars}), nil
}
func linearAction(d Descriptor, op string, raw []byte) (string, []byte, error) {
	parts := strings.Split(op, "_")
	if len(parts) != 2 {
		return "", nil, errors.New("unsupported Linear action")
	}
	resource, verb := parts[0], parts[1]
	allowed := map[string]string{"issue": "title description teamId assigneeId stateId projectId parentId cycleId labelIds priority estimate dueDate", "project": "name description content teamIds leadId memberIds statusId startDate targetDate priority", "comment": "issueId body parentId"}[resource]
	if allowed == "" {
		return "", nil, errors.New("unsupported Linear resource")
	}
	if verb == "update" && resource == "comment" {
		allowed = "body"
	}
	if verb == "archive" || verb == "unarchive" || verb == "delete" {
		allowed = ""
	}
	var id string
	var v map[string]json.RawMessage
	var err error
	if verb == "create" {
		v, err = nativeObject(raw, allowed)
	} else {
		id, v, err = nativeResourcePayload(raw, allowed)
		if !nativeID(id) {
			return "", nil, errors.New("provide a valid resource_id")
		}
	}
	if err != nil {
		return "", nil, err
	}
	if verb == "create" {
		required := []string{"title", "teamId"}
		if resource == "project" {
			required = []string{"name"}
			var teams []string
			if json.Unmarshal(v["teamIds"], &teams) != nil || len(teams) == 0 {
				return "", nil, errors.New("project needs nonempty teamIds")
			}
		}
		if resource == "comment" {
			required = []string{"issueId", "body"}
		}
		if err = nativeRequire(v, required...); err != nil {
			return "", nil, err
		}
	}
	if verb == "update" && len(v) == 0 {
		return "", nil, errors.New("provide fields to update")
	}
	for key, b := range v {
		switch key {
		case "priority", "estimate":
			var n int
			if json.Unmarshal(b, &n) != nil || n < 0 || key == "priority" && n > 4 || key == "estimate" && n > 64 {
				return "", nil, errors.New("invalid Linear priority or estimate")
			}
		case "teamIds", "labelIds", "memberIds":
			var ids []string
			if json.Unmarshal(b, &ids) != nil || len(ids) > 100 {
				return "", nil, errors.New("ID arrays must contain at most 100 strings")
			}
			for _, id := range ids {
				if !nativeID(id) {
					return "", nil, errors.New("invalid Linear ID")
				}
			}
		default:
			s, e := nativeString(v, key, false)
			if e != nil {
				return "", nil, e
			}
			if strings.HasSuffix(key, "Id") && !nativeID(s) {
				return "", nil, errors.New("invalid Linear ID")
			}
		}
	}
	name := resource + strings.ToUpper(verb[:1]) + verb[1:]
	vars := map[string]any{}
	decl, args, fields := "", "", "success"
	if verb == "create" || verb == "update" {
		typ := strings.ToUpper(resource[:1]) + resource[1:] + strings.ToUpper(verb[:1]) + verb[1:] + "Input"
		decl = "$input:" + typ + "!"
		args = "input:$input"
		vars["input"] = v
		if verb == "update" {
			decl += ",$id:String!"
			args += ",id:$id"
			vars["id"] = id
		}
		selection := "id"
		if resource == "issue" {
			selection = "id identifier url"
		}
		if resource == "project" {
			selection = "id name url"
		}
		fields += " " + resource + "{" + selection + "}"
	} else {
		if verb != "archive" && verb != "unarchive" && verb != "delete" || resource == "comment" && verb != "delete" {
			return "", nil, errors.New("unsupported Linear mutation")
		}
		decl = "$id:String!"
		args = "id:$id"
		vars["id"] = id
	}
	return d.Resource, nativeJSON(map[string]any{"query": `mutation(` + decl + `){` + name + `(` + args + `){` + fields + `}}`, "variables": vars}), nil
}
