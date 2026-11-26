package connector

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/action"
)

func TestGitLabRuntimeReadsAndReviewedActions(t *testing.T) {
	sha := strings.Repeat("a", 40)
	changed, missing := false, false
	writes := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/v4/projects/123") {
			t.Errorf("escaped project: %s", r.URL)
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			head := sha
			if changed {
				head = strings.Repeat("b", 40)
			}
			switch r.URL.Path {
			case "/api/v4/projects/123/merge_requests/4":
				fmt.Fprintf(w, `{"id":12,"iid":4,"sha":%q}`, head)
			case "/api/v4/projects/123/repository/commits/feature":
				fmt.Fprintf(w, `{"id":%q}`, head)
			case "/api/v4/projects/123/issues/4":
				fmt.Fprint(w, `{"id":12,"iid":4,"updated_at":"2026-11-26T00:00:00Z"}`)
			default:
				fmt.Fprint(w, `[]`)
			}
			return
		}
		writes++
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		for _, key := range []string{"number", "expected_head_sha", "expected_updated_at"} {
			if _, ok := body[key]; ok {
				t.Errorf("approval metadata leaked: %s", key)
			}
		}
		if strings.HasSuffix(r.URL.Path, "/merge") || strings.HasSuffix(r.URL.Path, "/approve") {
			if body["sha"] != sha {
				t.Error("missing SHA guard")
			}
		}
		if strings.HasSuffix(r.URL.Path, "/merge") && r.Method != http.MethodPut {
			t.Error("wrong merge method")
		}
		if r.URL.Path == "/api/v4/projects/123/merge_requests" && !strings.HasPrefix(body["title"].(string), "Draft:") {
			t.Error("MR was not draft")
		}
		if missing {
			fmt.Fprint(w, `{}`)
			return
		}
		fmt.Fprint(w, `{"id":12,"iid":4,"state":"merged","approved":true}`)
	}))
	defer server.Close()
	d := Descriptor{Version: 1, ID: "gitlab", Name: "GitLab", Kind: KindGitLab, Resource: server.URL + "/api/v4/projects/123", Authentication: AuthNone}
	registry, err := NewRegistry([]Descriptor{d})
	if err != nil {
		t.Fatal(err)
	}
	runtime := Runtime{Registry: registry, HTTPClient: server.Client()}
	for _, op := range d.Operations() {
		if action.RequiresFreshApproval(op.Capability) {
			continue
		}
		input := `{"resource_id":"4","cursor":"2","limit":5}`
		if op.ID == "file_get" || op.ID == "repository_tree" {
			input = `{"resource_id":"src/main.go","query":"` + sha + `"}`
		}
		if op.ID == "commit_get" {
			input = `{"resource_id":"` + sha + `"}`
		}
		if _, err := runtime.Invoke(context.Background(), action.Inspect, d.ID, op.ID, json.RawMessage(input)); err != nil {
			t.Fatalf("%s: %v", op.ID, err)
		}
	}
	cases := []struct{ op, fields string }{
		{"issue_create", `"title":"Issue","description":"Details"`},
		{"issue_update", `"number":4,"expected_updated_at":"2026-11-26T00:00:00Z","state_event":"close"`},
		{"issue_comment", `"number":4,"body":"Comment"`},
		{"merge_request_create", `"source_branch":"feature","target_branch":"main","title":"Feature"`},
		{"merge_request_update", `"number":4,"title":"New title"`},
		{"merge_request_comment", `"number":4,"body":"Reviewed"`},
		{"merge_request_approve", `"number":4`},
		{"merge_request_merge", `"number":4,"squash":false`},
	}
	for _, tc := range cases {
		fields := tc.fields
		if strings.HasPrefix(tc.op, "merge_request_") {
			fields += `,"expected_head_sha":"` + sha + `"`
		}
		p, err := runtime.PrepareAction(d.ID, tc.op, json.RawMessage(`{"payload":{`+fields+`}}`))
		if err != nil {
			t.Fatalf("prepare %s: %v", tc.op, err)
		}
		before := writes
		if _, err := runtime.ExecutePreparedWithEvidence(context.Background(), action.Inspect, p); err == nil || writes != before {
			t.Fatal("read mode wrote")
		}
		evidence, err := runtime.ExecutePreparedWithEvidence(context.Background(), action.Act, p)
		if err != nil || evidence.ResponseSHA256 == "" {
			t.Fatalf("execute %s: %v", tc.op, err)
		}
	}
	if writes != len(cases) {
		t.Fatalf("writes=%d", writes)
	}
	p, err := runtime.PrepareAction(d.ID, "merge_request_merge", json.RawMessage(`{"payload":{"number":4,"expected_head_sha":"`+sha+`","squash":true}}`))
	if err != nil {
		t.Fatal(err)
	}
	changed = true
	if _, err := runtime.ExecutePreparedWithEvidence(context.Background(), action.Act, p); err == nil || writes != len(cases) {
		t.Fatal("changed MR was merged")
	}
	changed = false
	missing = true
	if _, err := runtime.ExecutePreparedWithEvidence(context.Background(), action.Act, p); err == nil {
		t.Fatal("missing receipt accepted")
	}
}
func TestGitLabRejectsBroaderTargetsAndQuickActions(t *testing.T) {
	d := Descriptor{Version: 1, ID: "gitlab", Name: "GitLab", Kind: KindGitLab, Resource: "https://gitlab.com/api/v4/projects/123", Authentication: AuthBearer}
	if err := d.Validate(); err != nil {
		t.Fatal(err)
	}
	self := d
	self.Resource = "https://gitlab.example.com/api/v4/projects/321"
	if err := self.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, resource := range []string{"https://gitlab.com/api/v4/projects", "https://gitlab.com/api/v4/projects/group%2Frepo", "https://gitlab.com/api/v4/projects/123/", "https://gitlab.com/api/v4/projects/123?token=secret", "https://gitlab.com/api/v4/projects/../123", "http://gitlab.com/api/v4/projects/123"} {
		bad := d
		bad.Resource = resource
		if bad.Validate() == nil {
			t.Errorf("accepted %s", resource)
		}
	}
	for _, raw := range []string{`{"number":4,"body":"/close"}`, `{"number":4,"body":"Comment\n /assign @someone"}`, `{"number":4,"body":"Hi","url":"https://evil.test"}`} {
		if _, _, err := gitlabAction(d, "issue_comment", []byte(raw)); err == nil {
			t.Error("unsafe comment accepted", raw)
		}
	}
	for _, id := range []string{"../4", "04", "0", "4/merge"} {
		if _, _, _, err := gitlabRead(d, "merge_request_get", serviceInput{ResourceID: id}); err == nil {
			t.Error("invalid MR", id)
		}
	}
	if _, _, _, err := gitlabRead(d, "issues_list", serviceInput{Cursor: "101"}); err == nil {
		t.Error("unbounded page")
	}
	if _, _, err := gitlabAction(d, "merge_request_merge", []byte(`{"number":4,"squash":true}`)); err == nil {
		t.Error("unbound merge")
	}
	for _, raw := range []string{`{}`, `{"id":12,"state":"opened"}`} {
		if _, err := gitlabEvidence("merge_request_merge", json.RawMessage(raw)); err == nil {
			t.Error("unconfirmed merge succeeded")
		}
	}
}
