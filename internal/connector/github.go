package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/action"
)

var githubName = regexp.MustCompile(`\A[A-Za-z0-9_.-]{1,100}\z`)
var githubSHA = regexp.MustCompile(`\A[0-9a-f]{40}\z`)

func validateGitHubResource(resource *url.URL) error {
	parts := strings.Split(strings.Trim(resource.Path, "/"), "/")
	if resource.RawQuery != "" || resource.RawPath != "" || len(parts) != 3 || parts[0] != "repos" || !githubName.MatchString(parts[1]) || !githubName.MatchString(parts[2]) || parts[1] == "." || parts[1] == ".." || parts[2] == "." || parts[2] == ".." || strings.HasSuffix(resource.Path, "/") {
		return errors.New("GitHub connection needs an exact repository API URL: https://api.github.com/repos/owner/repo")
	}
	if resource.Scheme == "https" && resource.Host != "api.github.com" {
		return errors.New("GitHub connections use api.github.com; other services need their own connector")
	}
	return nil
}

func githubOperations() []Operation {
	ops := serviceOperations([]serviceOperation{
		{"repo_get", "Read selected repository metadata and permissions.", action.ConnectedRead},
		{"contents_get", "Read a file or directory at an exact commit SHA. resource_id is its relative path (empty for root); query is the 40-character commit SHA. Files are base64 JSON, subject to size limits; directory lists are capped by GitHub. Do not follow returned download URLs with this credential.", action.ConnectedRead},
		{"branches_list", "List repository branches with commit SHAs; follow page cursors.", action.ConnectedRead},
		{"issues_list", "List repository issues (GitHub also includes PRs); query is open, closed or all. Follow page cursors.", action.ConnectedRead},
		{"issue_get", "Read an issue and its updated_at before proposing edits.", action.ConnectedRead},
		{"issue_comments", "Read conversation comments on an issue.", action.ConnectedRead},
		{"workflow_runs", "List GitHub Actions runs; pending or missing results are not success.", action.ConnectedRead},
		{"workflow_run_get", "Read one GitHub Actions run by ID.", action.ConnectedRead},
		{"workflow_jobs", "Read jobs and step conclusions for a workflow run; raw log downloads are not supported.", action.ConnectedRead},
		{"issue_create", "Create a repository issue after exact approval; payload title and optional body.", action.ConnectedMutate},
		{"issue_update", "Edit title/body or close/reopen an issue after exact approval; payload number, expected_updated_at and changed fields. A fresh timestamp check detects stale proposals.", action.ConnectedMutate},
		{"issue_comment", "Comment on an issue after exact approval; payload number and body.", action.Publish},
		{"pulls_list", "List pull requests in the selected repository. Follow bounded page cursors; one page is not complete coverage.", action.ConnectedRead},
		{"pull_get", "Read one pull request including head SHA, branches and mergeability.", action.ConnectedRead},
		{"pull_files", "Read changed files and patches for one PR. Binary or large file patches may be absent; report gaps.", action.ConnectedRead},
		{"pull_reviews", "Read submitted reviews for one PR.", action.ConnectedRead},
		{"pull_comments", "Read conversation comments for one PR.", action.ConnectedRead},
		{"commit_checks", "Read check runs for an exact commit SHA.", action.ConnectedRead},
		{"commit_status", "Read combined commit status for an exact commit SHA.", action.ConnectedRead},
		{"pull_create", "Create a draft PR from an existing same-repository branch after exact approval. Requires head, base, title and expected_head_sha; creating/pushing code is a separate operation.", action.ConnectedMutate},
		{"pull_update", "Edit title/body or close/reopen one PR after exact approval and a fresh head SHA check.", action.ConnectedMutate},
		{"pull_comment", "Publish a PR conversation comment after exact approval and a fresh head SHA check.", action.Publish},
		{"pull_review", "Submit COMMENT, APPROVE or REQUEST_CHANGES against the exact reviewed commit after foreground approval.", action.Publish},
		{"pull_merge", "Merge one PR after explicit approval. Requires expected_head_sha and merge_method; GitHub's sha guard rejects a changed head. Read all checks, statuses and reviews first; never infer a missing/pending check passed.", action.ConnectedMutate},
	})
	for i := range ops {
		if ops[i].ID == "contents_get" {
			ops[i].InputSchema = json.RawMessage(`{"type":"object","additionalProperties":false,"required":["query"],"properties":{"resource_id":{"type":"string","description":"Relative file/directory path, empty for root"},"query":{"type":"string","description":"Exact 40-character commit SHA"}}}`)
			continue
		}
		if action.RequiresFreshApproval(ops[i].Capability) {
			ops[i].InputSchema = json.RawMessage(`{"type":"object","additionalProperties":false,"required":["payload"],"properties":{"payload":{"type":"object","description":"For issue_create: title,body; issue_update: number,expected_updated_at,title,body,state; issue_comment: number,body. PR fields: number, expected_head_sha; create: head,base,title,body; update: title,body,state; comment: body; review: body,event; merge: merge_method (merge,squash,rebase)."}}}`)
		} else {
			ops[i].InputSchema = json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"resource_id":{"type":"string","description":"Issue/PR number, workflow run ID, or exact 40-character commit SHA for commit operations"},"cursor":{"type":"string","description":"Page number (1–100)"},"limit":{"type":"integer","minimum":1,"maximum":100},"query":{"type":"string","enum":["open","closed","all"]}}}`)
		}
	}
	return ops
}
func githubNumber(value string) bool {
	n, err := strconv.ParseInt(value, 10, 64)
	return err == nil && n > 0 && strconv.FormatInt(n, 10) == value
}
func githubRead(d Descriptor, op string, in serviceInput) (string, string, []byte, error) {
	base := d.Resource
	path := ""
	query := url.Values{}
	switch op {
	case "contents_get":
		if !githubSHA.MatchString(in.Query) {
			return "", "", nil, errors.New("choose an exact commit SHA for repository content")
		}
		escaped, err := repositoryPath(in.ResourceID)
		if err != nil {
			return "", "", nil, err
		}
		path = "/contents"
		if escaped != "" {
			path += "/" + escaped
		}
		query.Set("ref", in.Query)
	case "repo_get":
		path = ""
	case "branches_list":
		path = "/branches"
	case "workflow_runs":
		path = "/actions/runs"
	case "workflow_run_get", "workflow_jobs":
		if !githubNumber(in.ResourceID) {
			return "", "", nil, errors.New("choose a positive workflow run ID")
		}
		path = "/actions/runs/" + in.ResourceID
		if op == "workflow_jobs" {
			path += "/jobs"
		}
	case "issue_get", "issue_comments":
		if !githubNumber(in.ResourceID) {
			return "", "", nil, errors.New("choose a positive issue number")
		}
		path = "/issues/" + in.ResourceID
		if op == "issue_comments" {
			path += "/comments"
		}
	case "pulls_list", "issues_list":
		path = "/pulls"
		if op == "issues_list" {
			path = "/issues"
		}
		state := in.Query
		if state == "" {
			state = "open"
		}
		if state != "open" && state != "closed" && state != "all" {
			return "", "", nil, errors.New("invalid PR state")
		}
		query.Set("state", state)
	case "pull_get", "pull_files", "pull_reviews", "pull_comments":
		if !githubNumber(in.ResourceID) {
			return "", "", nil, errors.New("choose an exact positive PR number")
		}
		if op == "pull_comments" {
			path = "/issues/" + in.ResourceID + "/comments"
		} else {
			path = "/pulls/" + in.ResourceID
			switch op {
			case "pull_files":
				path += "/files"
			case "pull_reviews":
				path += "/reviews"
			}
		}
	case "commit_checks", "commit_status":
		if !githubSHA.MatchString(in.ResourceID) {
			return "", "", nil, errors.New("read checks for an exact commit SHA")
		}
		path = "/commits/" + in.ResourceID + "/check-runs"
		if op == "commit_status" {
			path = "/commits/" + in.ResourceID + "/status"
		}
	default:
		return "", "", nil, errors.New("unsupported GitHub read")
	}
	page := 1
	if in.Cursor != "" {
		var err error
		page, err = strconv.Atoi(in.Cursor)
		if err != nil || page < 1 || page > 100 {
			return "", "", nil, errors.New("GitHub page must be 1–100")
		}
	}
	limit := in.Limit
	if limit == 0 {
		limit = 30
	}
	query.Set("page", strconv.Itoa(page))
	query.Set("per_page", strconv.Itoa(limit))
	return base + path + "?" + query.Encode(), http.MethodGet, nil, nil
}

type githubChange struct {
	Number   int     `json:"number,omitempty"`
	Expected string  `json:"expected_head_sha"`
	Head     string  `json:"head,omitempty"`
	Base     string  `json:"base,omitempty"`
	Title    *string `json:"title,omitempty"`
	Body     *string `json:"body,omitempty"`
	State    string  `json:"state,omitempty"`
	Event    string  `json:"event,omitempty"`
	Method   string  `json:"merge_method,omitempty"`
}

func githubAction(d Descriptor, op string, raw []byte) (string, []byte, error) {
	if strings.HasPrefix(op, "issue_") {
		return githubIssueAction(d, op, raw)
	}
	var in githubChange
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", nil, err
	}
	// Reject unknown fields; none can smuggle a second API target or write.
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&in); err != nil {
		return "", nil, err
	}
	if !githubSHA.MatchString(in.Expected) {
		return "", nil, errors.New("read and supply the exact expected_head_sha before reviewing a PR action")
	}
	if in.Body != nil && len(*in.Body) > 10000 || in.Title != nil && (strings.TrimSpace(*in.Title) == "" || len(*in.Title) > 256) {
		return "", nil, errors.New("GitHub title/body exceeds its limits")
	}
	body := map[string]any{}
	path := "/pulls/" + strconv.Itoa(in.Number)
	if op != "pull_create" && (!githubNumber(strconv.Itoa(in.Number)) || in.Head != "" || in.Base != "") {
		return "", nil, errors.New("choose one existing PR number")
	}
	switch op {
	case "pull_create":
		if in.Number != 0 || in.Head == "" || in.Base == "" || in.Title == nil || len(in.Head) > 256 || len(in.Base) > 256 || strings.ContainsAny(in.Head+in.Base, "\x00\r\n :?#\\") || strings.Contains(in.Head, "..") || strings.Contains(in.Base, "..") {
			return "", nil, errors.New("create a draft PR from explicit same-repository head and base branches")
		}
		body["head"], body["base"], body["title"], body["draft"] = in.Head, in.Base, *in.Title, true
		path = "/pulls"
		if in.Body != nil {
			body["body"] = *in.Body
		}
	case "pull_update":
		if in.Title != nil {
			body["title"] = *in.Title
		}
		if in.Body != nil {
			body["body"] = *in.Body
		}
		if in.State != "" {
			if in.State != "open" && in.State != "closed" {
				return "", nil, errors.New("state must be open or closed")
			}
			body["state"] = in.State
		}
		if len(body) == 0 {
			return "", nil, errors.New("choose title, body or state changes")
		}
	case "pull_comment":
		if in.Body == nil || strings.TrimSpace(*in.Body) == "" {
			return "", nil, errors.New("comment requires a body")
		}
		body["body"] = *in.Body
		path = "/issues/" + strconv.Itoa(in.Number) + "/comments"
	case "pull_review":
		if in.Event != "COMMENT" && in.Event != "APPROVE" && in.Event != "REQUEST_CHANGES" {
			return "", nil, errors.New("choose COMMENT, APPROVE or REQUEST_CHANGES")
		}
		body["commit_id"], body["event"] = in.Expected, in.Event
		if in.Body != nil {
			body["body"] = *in.Body
		}
		if in.Event != "APPROVE" && (in.Body == nil || strings.TrimSpace(*in.Body) == "") {
			return "", nil, errors.New("comment or requested changes need an explanation")
		}
		path += "/reviews"
	case "pull_merge":
		if in.Method != "merge" && in.Method != "squash" && in.Method != "rebase" {
			return "", nil, errors.New("choose merge, squash or rebase explicitly")
		}
		body["sha"], body["merge_method"] = in.Expected, in.Method
		path += "/merge"
	default:
		return "", nil, errors.New("unsupported GitHub action")
	}
	// Unused fields are rejected rather than silently omitted from an approval.
	if op != "pull_update" && in.State != "" || op != "pull_review" && in.Event != "" || op != "pull_merge" && in.Method != "" || op != "pull_update" && op != "pull_create" && in.Title != nil || op == "pull_merge" && in.Body != nil {
		return "", nil, errors.New("fields do not match this GitHub action")
	}
	payload, err := json.Marshal(body)
	return d.Resource + path, payload, err
}
func (r Runtime) verifyGitHubHead(ctx context.Context, d Descriptor, p PreparedAction) error {
	if strings.HasPrefix(p.operation.ID, "issue_") {
		return r.verifyGitHubIssue(ctx, d, p)
	}
	var in githubChange
	if err := json.Unmarshal(p.payload, &in); err != nil {
		return err
	}
	endpoint := d.Resource + "/pulls/" + strconv.Itoa(in.Number)
	if p.operation.ID == "pull_create" {
		endpoint = d.Resource + "/commits/" + url.PathEscape(in.Head)
	}
	result, err := r.requestJSON(ctx, d, "verify_head", http.MethodGet, endpoint, nil, false)
	if err != nil {
		return err
	}
	var found struct {
		SHA  string `json:"sha"`
		Head struct {
			SHA string `json:"sha"`
		} `json:"head"`
	}
	if json.Unmarshal(result.Data, &found) != nil {
		return errors.New("invalid GitHub head response")
	}
	sha := found.Head.SHA
	if p.operation.ID == "pull_create" {
		sha = found.SHA
	}
	if sha != in.Expected {
		return errors.New("GitHub head changed; read the new diff, checks and reviews before proposing this action again")
	}
	return nil
}
func githubEvidence(op string, data json.RawMessage) (ExecutionEvidence, error) {
	var value struct {
		ID     int64  `json:"id"`
		Number int    `json:"number"`
		SHA    string `json:"sha"`
		Merged bool   `json:"merged"`
	}
	if json.Unmarshal(data, &value) != nil {
		return ExecutionEvidence{}, action.MarkUncertain(errors.New("GitHub action returned invalid confirmation; inspect before retrying"))
	}
	evidence := ExecutionEvidence{}
	if op == "pull_merge" {
		if !value.Merged || !githubSHA.MatchString(value.SHA) {
			return evidence, action.MarkUncertain(errors.New("GitHub did not confirm a merge; inspect the PR before retrying"))
		}
		evidence.ReceiptID = value.SHA
	} else {
		if value.ID <= 0 {
			return evidence, action.MarkUncertain(errors.New("GitHub returned no action identity; inspect before retrying"))
		}
		evidence.ProviderResourceID = fmt.Sprint(value.ID)
	}
	return evidence, nil
}

type githubIssueChange struct {
	Number   int     `json:"number,omitempty"`
	Expected string  `json:"expected_updated_at,omitempty"`
	Title    *string `json:"title,omitempty"`
	Body     *string `json:"body,omitempty"`
	State    string  `json:"state,omitempty"`
}

func githubIssueAction(d Descriptor, op string, raw []byte) (string, []byte, error) {
	var in githubIssueChange
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&in); err != nil {
		return "", nil, err
	}
	if in.Title != nil && (strings.TrimSpace(*in.Title) == "" || len(*in.Title) > 256) || in.Body != nil && len(*in.Body) > 10000 {
		return "", nil, errors.New("GitHub title/body exceeds its limits")
	}
	body := map[string]any{}
	path := "/issues"
	if op != "issue_create" {
		if !githubNumber(strconv.Itoa(in.Number)) {
			return "", nil, errors.New("choose a positive issue number")
		}
		path += "/" + strconv.Itoa(in.Number)
	}
	switch op {
	case "issue_create":
		if in.Number != 0 || in.Title == nil || in.Expected != "" || in.State != "" {
			return "", nil, errors.New("issue creation requires title and optional body only")
		}
		body["title"] = *in.Title
		if in.Body != nil {
			body["body"] = *in.Body
		}
	case "issue_update":
		if _, err := time.Parse(time.RFC3339Nano, in.Expected); err != nil {
			return "", nil, errors.New("read and supply expected_updated_at before editing an issue")
		}
		if in.Title != nil {
			body["title"] = *in.Title
		}
		if in.Body != nil {
			body["body"] = *in.Body
		}
		if in.State != "" {
			if in.State != "open" && in.State != "closed" {
				return "", nil, errors.New("issue state must be open or closed")
			}
			body["state"] = in.State
		}
		if len(body) == 0 {
			return "", nil, errors.New("choose issue fields to change")
		}
	case "issue_comment":
		if in.Body == nil || strings.TrimSpace(*in.Body) == "" || in.Title != nil || in.State != "" || in.Expected != "" {
			return "", nil, errors.New("issue comment requires number and body only")
		}
		path += "/comments"
		body["body"] = *in.Body
	default:
		return "", nil, errors.New("unsupported GitHub issue action")
	}
	payload, err := json.Marshal(body)
	return d.Resource + path, payload, err
}
func (r Runtime) verifyGitHubIssue(ctx context.Context, d Descriptor, p PreparedAction) error {
	if p.operation.ID == "issue_create" {
		return nil
	}
	var in githubIssueChange
	if err := json.Unmarshal(p.payload, &in); err != nil {
		return err
	}
	result, err := r.requestJSON(ctx, d, "issue_get", http.MethodGet, d.Resource+"/issues/"+strconv.Itoa(in.Number), nil, false)
	if err != nil {
		return err
	}
	var found struct {
		Updated string          `json:"updated_at"`
		Pull    json.RawMessage `json:"pull_request"`
		Number  int             `json:"number"`
	}
	if json.Unmarshal(result.Data, &found) != nil || found.Number != in.Number || len(found.Pull) > 0 {
		return errors.New("target is not the selected GitHub issue; use PR operations for pull requests")
	}
	if p.operation.ID == "issue_update" && found.Updated != in.Expected {
		return errors.New("GitHub issue changed; read it again before proposing edits")
	}
	return nil
}

func repositoryPath(path string) (string, error) {
	if len(path) > 2048 || strings.ContainsAny(path, "\x00\r\n\\") {
		return "", errors.New("invalid repository path")
	}
	if path == "" {
		return "", nil
	}
	parts := strings.Split(path, "/")
	for i, part := range parts {
		if part == "" || part == "." || part == ".." {
			return "", errors.New("use a relative repository path without traversal")
		}
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/"), nil
}
