package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/action"
)

func validateGitLabResource(u *url.URL) error {
	parts := strings.Split(u.Path, "/")
	if u.RawQuery != "" || u.RawPath != "" || len(parts) != 5 || parts[1] != "api" || parts[2] != "v4" || parts[3] != "projects" || !githubNumber(parts[4]) {
		return errors.New("GitLab needs an exact project API URL with a numeric project ID: https://gitlab.com/api/v4/projects/123 (self-managed HTTPS hosts are supported)")
	}
	return nil
}

func gitlabOperations() []Operation {
	ops := serviceOperations([]serviceOperation{
		{"project_get", "Read the selected GitLab project and access metadata.", action.ConnectedRead},
		{"branches_list", "List project branches and exact commit IDs; follow page cursors.", action.ConnectedRead},
		{"commit_get", "Read an exact commit SHA before preparing a draft merge request.", action.ConnectedRead},
		{"issues_list", "List project issues; query is opened, closed or all. Follow page cursors.", action.ConnectedRead},
		{"issue_get", "Read an issue including updated_at before proposing changes.", action.ConnectedRead},
		{"issue_notes", "Read issue notes; follow page cursors.", action.ConnectedRead},
		{"merge_requests_list", "List project merge requests; query is opened, closed, merged or all.", action.ConnectedRead},
		{"merge_request_get", "Read one merge request including sha and merge status.", action.ConnectedRead},
		{"merge_request_diffs", "Read merge request diffs. Large/binary/generated files may be omitted or collapsed; report gaps.", action.ConnectedRead},
		{"merge_request_notes", "Read merge request notes; follow page cursors.", action.ConnectedRead},
		{"merge_request_pipelines", "Read pipelines for a merge request; inspect each pipeline and jobs before merging.", action.ConnectedRead},
		{"merge_request_approvals", "Read merge request approval status, subject to the GitLab edition and token permissions.", action.ConnectedRead},
		{"pipelines_list", "List project pipelines; pending/missing checks are not success.", action.ConnectedRead},
		{"pipeline_get", "Read one pipeline by ID.", action.ConnectedRead},
		{"pipeline_jobs", "Read pipeline jobs and conclusions; raw job logs are not supported.", action.ConnectedRead},
		{"issue_create", "Create an issue after exact approval. Payload title and optional description.", action.ConnectedMutate},
		{"issue_update", "Edit title/description or close/reopen an issue after exact approval and a fresh expected_updated_at check.", action.ConnectedMutate},
		{"issue_comment", "Post an issue note after exact approval. Payload number and body; quick actions are rejected.", action.Publish},
		{"merge_request_create", "Create a draft MR from existing same-project branches after exact approval; source_branch, target_branch, title, optional description and expected_head_sha. Code pushes are separate.", action.ConnectedMutate},
		{"merge_request_update", "Edit title/description or close/reopen a merge request after exact approval and a fresh head SHA check.", action.ConnectedMutate},
		{"merge_request_comment", "Post an MR note after exact approval and a fresh head SHA check; quick actions are rejected.", action.Publish},
		{"merge_request_approve", "Approve the exact expected_head_sha after foreground approval. GitLab edition and project policy may restrict access.", action.Publish},
		{"merge_request_merge", "Merge after explicit approval; number, expected_head_sha and squash (boolean) required. GitLab's SHA guard rejects a changed head. Read diffs, pipeline jobs and approvals first.", action.ConnectedMutate},
	})
	for i := range ops {
		if action.RequiresFreshApproval(ops[i].Capability) {
			ops[i].InputSchema = json.RawMessage(`{"type":"object","additionalProperties":false,"required":["payload"],"properties":{"payload":{"type":"object","description":"Exact operation fields only. Existing issue/MR: number. Issue update: expected_updated_at. All MR actions: expected_head_sha. Create/update: title,description; create MR: source_branch,target_branch; update: state_event close or reopen; comment: body; merge: squash boolean."}}}`)
		} else {
			ops[i].InputSchema = json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"resource_id":{"type":"string","description":"Issue/MR IID, pipeline ID, or exact 40-character commit SHA for commit_get"},"query":{"type":"string","description":"List state: opened, closed, merged (MR only), all"},"cursor":{"type":"string","description":"Page number 1–100"},"limit":{"type":"integer","minimum":1,"maximum":100}}}`)
		}
	}
	return ops
}

func gitlabRead(d Descriptor, op string, in serviceInput) (string, string, []byte, error) {
	path := ""
	q := url.Values{}
	switch op {
	case "project_get":
	case "branches_list":
		path = "/repository/branches"
	case "commit_get":
		if !githubSHA.MatchString(in.ResourceID) {
			return "", "", nil, errors.New("choose an exact commit SHA")
		}
		path = "/repository/commits/" + in.ResourceID
	case "issues_list", "merge_requests_list":
		path = "/issues"
		if op == "merge_requests_list" {
			path = "/merge_requests"
		}
		state := in.Query
		if state == "" {
			state = "opened"
		}
		if state != "opened" && state != "closed" && state != "all" && !(op == "merge_requests_list" && state == "merged") {
			return "", "", nil, errors.New("invalid GitLab list state")
		}
		q.Set("state", state)
	case "pipelines_list":
		path = "/pipelines"
	case "pipeline_get", "pipeline_jobs", "issue_get", "issue_notes", "merge_request_get", "merge_request_diffs", "merge_request_notes", "merge_request_pipelines", "merge_request_approvals":
		if !githubNumber(in.ResourceID) {
			return "", "", nil, errors.New("choose an exact positive issue/MR or pipeline ID")
		}
		switch {
		case strings.HasPrefix(op, "pipeline_"):
			path = "/pipelines/" + in.ResourceID
			if op == "pipeline_jobs" {
				path += "/jobs"
			}
		case strings.HasPrefix(op, "issue_"):
			path = "/issues/" + in.ResourceID
			if op == "issue_notes" {
				path += "/notes"
			}
		default:
			path = "/merge_requests/" + in.ResourceID
			if op != "merge_request_get" {
				path += "/" + strings.TrimPrefix(op, "merge_request_")
			}
		}
	default:
		return "", "", nil, errors.New("unsupported GitLab read")
	}
	page := 1
	if in.Cursor != "" {
		var err error
		page, err = strconv.Atoi(in.Cursor)
		if err != nil || page < 1 || page > 100 {
			return "", "", nil, errors.New("GitLab page must be 1–100")
		}
	}
	limit := in.Limit
	if limit == 0 {
		limit = 30
	}
	q.Set("page", strconv.Itoa(page))
	q.Set("per_page", strconv.Itoa(limit))
	return d.Resource + path + "?" + q.Encode(), http.MethodGet, nil, nil
}

type gitlabChange struct {
	Number      int     `json:"number,omitempty"`
	Expected    string  `json:"expected_head_sha,omitempty"`
	Updated     string  `json:"expected_updated_at,omitempty"`
	Source      string  `json:"source_branch,omitempty"`
	Target      string  `json:"target_branch,omitempty"`
	Title       *string `json:"title,omitempty"`
	Description *string `json:"description,omitempty"`
	Body        *string `json:"body,omitempty"`
	State       string  `json:"state_event,omitempty"`
	Squash      *bool   `json:"squash,omitempty"`
}

func gitlabAction(d Descriptor, op string, raw []byte) (string, []byte, error) {
	var in gitlabChange
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&in); err != nil {
		return "", nil, err
	}
	mr := strings.HasPrefix(op, "merge_request_")
	if mr && !githubSHA.MatchString(in.Expected) {
		return "", nil, errors.New("read and supply expected_head_sha for MR actions")
	}
	if !mr && (in.Expected != "" || in.Source != "" || in.Target != "" || in.Squash != nil) {
		return "", nil, errors.New("MR fields cannot be used for issues")
	}
	if mr && in.Updated != "" {
		return "", nil, errors.New("expected_updated_at is only for issue updates")
	}
	if in.Title != nil && (strings.TrimSpace(*in.Title) == "" || len(*in.Title) > 255) {
		return "", nil, errors.New("title must contain 1–255 characters")
	}
	for _, text := range []*string{in.Description, in.Body} {
		if text != nil {
			if len(*text) > 10000 {
				return "", nil, errors.New("GitLab text exceeds 10000 bytes")
			}
			for _, line := range strings.Split(*text, "\n") {
				if strings.HasPrefix(strings.TrimSpace(line), "/") {
					return "", nil, errors.New("GitLab quick actions are not supported; propose each action explicitly")
				}
			}
		}
	}
	create := op == "issue_create" || op == "merge_request_create"
	path := "/issues"
	if mr {
		path = "/merge_requests"
	}
	if create {
		if in.Number != 0 {
			return "", nil, errors.New("creation cannot target an existing number")
		}
	} else {
		if !githubNumber(strconv.Itoa(in.Number)) {
			return "", nil, errors.New("choose a positive issue or MR number")
		}
		path += "/" + strconv.Itoa(in.Number)
	}
	body := map[string]any{}
	switch op {
	case "issue_create", "merge_request_create":
		if in.Title == nil || in.Body != nil || in.State != "" || in.Updated != "" || in.Squash != nil {
			return "", nil, errors.New("creation requires title, optional description and MR branches only")
		}
		title := *in.Title
		if mr {
			for _, branch := range []string{in.Source, in.Target} {
				if branch == "" || len(branch) > 256 || strings.ContainsAny(branch, "\x00\r\n :?#\\") || strings.Contains(branch, "..") {
					return "", nil, errors.New("choose explicit same-project source and target branches")
				}
			}
			if !strings.HasPrefix(strings.ToLower(title), "draft:") {
				title = "Draft: " + title
			}
			body["source_branch"], body["target_branch"] = in.Source, in.Target
		}
		body["title"] = title
		if in.Description != nil {
			body["description"] = *in.Description
		}
	case "issue_update", "merge_request_update":
		if in.Body != nil || in.Source != "" || in.Target != "" || in.Squash != nil {
			return "", nil, errors.New("unsupported fields for update")
		}
		if !mr {
			if _, err := time.Parse(time.RFC3339Nano, in.Updated); err != nil {
				return "", nil, errors.New("read and supply expected_updated_at before editing an issue")
			}
		}
		if in.Title != nil {
			body["title"] = *in.Title
		}
		if in.Description != nil {
			body["description"] = *in.Description
		}
		if in.State != "" {
			if in.State != "close" && in.State != "reopen" {
				return "", nil, errors.New("state_event must be close or reopen")
			}
			body["state_event"] = in.State
		}
		if len(body) == 0 {
			return "", nil, errors.New("choose fields to change")
		}
	case "issue_comment", "merge_request_comment":
		if in.Body == nil || strings.TrimSpace(*in.Body) == "" || in.Title != nil || in.Description != nil || in.State != "" || in.Source != "" || in.Target != "" || in.Squash != nil || in.Updated != "" {
			return "", nil, errors.New("comment requires number, body and MR head SHA only")
		}
		body["body"] = *in.Body
		path += "/notes"
	case "merge_request_merge", "merge_request_approve":
		if in.Title != nil || in.Description != nil || in.Body != nil || in.State != "" || in.Source != "" || in.Target != "" {
			return "", nil, errors.New("unexpected merge/approval fields")
		}
		body["sha"] = in.Expected
		if op == "merge_request_merge" {
			if in.Squash == nil {
				return "", nil, errors.New("choose squash explicitly")
			}
			body["squash"] = *in.Squash
			path += "/merge"
		} else {
			if in.Squash != nil {
				return "", nil, errors.New("approval cannot set squash")
			}
			path += "/approve"
		}
	default:
		return "", nil, errors.New("unsupported GitLab action")
	}
	payload, err := json.Marshal(body)
	return d.Resource + path, payload, err
}
func (r Runtime) verifyGitLabAction(ctx context.Context, d Descriptor, p PreparedAction) error {
	if p.operation.ID == "issue_create" {
		return nil
	}
	var in gitlabChange
	if err := json.Unmarshal(p.payload, &in); err != nil {
		return err
	}
	mr := strings.HasPrefix(p.operation.ID, "merge_request_")
	path := "/issues/" + strconv.Itoa(in.Number)
	if mr {
		path = "/merge_requests/" + strconv.Itoa(in.Number)
	}
	if p.operation.ID == "merge_request_create" {
		path = "/repository/commits/" + url.PathEscape(in.Source)
	}
	result, err := r.requestJSON(ctx, d, "verify_target", http.MethodGet, d.Resource+path, nil, false)
	if err != nil {
		return err
	}
	var found struct {
		ID      json.RawMessage `json:"id"`
		IID     int             `json:"iid"`
		SHA     string          `json:"sha"`
		Updated string          `json:"updated_at"`
	}
	if json.Unmarshal(result.Data, &found) != nil {
		return errors.New("invalid GitLab preflight response")
	}
	if p.operation.ID == "merge_request_create" {
		var sha string
		_ = json.Unmarshal(found.ID, &sha)
		if sha != in.Expected {
			return errors.New("GitLab source branch changed; read the new commit before proposing again")
		}
		return nil
	}
	if found.IID != in.Number {
		return errors.New("GitLab returned a different issue or merge request")
	}
	if mr && found.SHA != in.Expected {
		return errors.New("GitLab head changed; read the new diff, pipelines and approvals before proposing again")
	}
	if p.operation.ID == "issue_update" && found.Updated != in.Updated {
		return errors.New("GitLab issue changed; read it again before editing")
	}
	return nil
}
func gitlabEvidence(op string, data json.RawMessage) (ExecutionEvidence, error) {
	var receipt struct {
		ID       int64  `json:"id"`
		State    string `json:"state"`
		Approved bool   `json:"approved"`
	}
	if json.Unmarshal(data, &receipt) != nil || receipt.ID <= 0 && op != "merge_request_approve" || op == "merge_request_merge" && receipt.State != "merged" || op == "merge_request_approve" && !receipt.Approved {
		return ExecutionEvidence{}, action.MarkUncertain(errors.New("GitLab did not confirm the action; inspect the target before retrying"))
	}
	evidence := ExecutionEvidence{}
	if receipt.ID > 0 {
		evidence.ProviderResourceID = fmt.Sprint(receipt.ID)
	}
	return evidence, nil
}
