package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/action"
)

func TestGitHubReadPrepareAndChangedHeadGuard(t *testing.T) {
	sha := strings.Repeat("a", 40)
	writes := 0
	changed := false
	uncertain := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("Accept") != "application/vnd.github+json" {
			t.Error("missing GitHub media type")
		}
		if r.Method == "GET" {
			if strings.Contains(r.URL.Path, "/pulls/4") {
				head := sha
				if changed {
					head = strings.Repeat("b", 40)
				}
				fmt.Fprintf(w, `{"id":12,"head":{"sha":%q}}`, head)
			} else if strings.Contains(r.URL.Path, "/commits/branch") {
				fmt.Fprintf(w, `{"sha":%q}`, sha)
			} else {
				fmt.Fprint(w, `[]`)
			}
			return
		}
		writes++
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if _, found := body["expected_head_sha"]; found {
			t.Error("internal approval metadata sent to GitHub")
		}
		if uncertain {
			fmt.Fprint(w, `{}`)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/merge") {
			if r.Method != "PUT" || body["sha"] != sha {
				t.Error("missing atomic merge SHA guard")
			}
			fmt.Fprintf(w, `{"merged":true,"sha":%q}`, sha)
		} else {
			fmt.Fprint(w, `{"id":12,"number":4}`)
		}
	}))
	defer server.Close()
	d := Descriptor{Version: DescriptorVersion, ID: "github", Name: "Repo", Kind: KindGitHub, Resource: server.URL + "/repos/owner/repo", Authentication: AuthNone}
	registry, err := NewRegistry([]Descriptor{d})
	if err != nil {
		t.Fatal(err)
	}
	runtime := Runtime{Registry: registry, HTTPClient: server.Client()}
	for _, test := range []struct{ op, input string }{{"pulls_list", `{}`}, {"pull_get", `{"resource_id":"4"}`}, {"pull_files", `{"resource_id":"4","cursor":"2"}`}, {"pull_reviews", `{"resource_id":"4"}`}, {"pull_comments", `{"resource_id":"4"}`}, {"commit_checks", `{"resource_id":"` + sha + `"}`}, {"commit_status", `{"resource_id":"` + sha + `"}`}} {
		if _, err = runtime.Invoke(context.Background(), action.Inspect, d.ID, test.op, json.RawMessage(test.input)); err != nil {
			t.Fatalf("read %s: %v", test.op, err)
		}
	}
	for _, test := range []struct{ op, fields string }{{"pull_create", `"head":"branch","base":"main","title":"Draft"`}, {"pull_update", `"number":4,"title":"New"`}, {"pull_comment", `"number":4,"body":"Review"`}, {"pull_review", `"number":4,"event":"COMMENT","body":"Checked"`}, {"pull_merge", `"number":4,"merge_method":"squash"`}} {
		input := json.RawMessage(fmt.Sprintf(`{"payload":{"expected_head_sha":%q,%s}}`, sha, test.fields))
		prepared, err := runtime.PrepareAction(d.ID, test.op, input)
		if err != nil {
			t.Fatalf("prepare %s: %v", test.op, err)
		}
		if !strings.Contains(prepared.Proposal.Preview, sha) {
			t.Fatal("review omits commit")
		}
		if _, err = runtime.ExecutePreparedWithEvidence(context.Background(), action.Inspect, prepared); err == nil {
			t.Fatal("read mode mutated GitHub")
		}
		evidence, err := runtime.ExecutePreparedWithEvidence(context.Background(), action.Act, prepared)
		if err != nil || evidence.ResponseSHA256 == "" {
			t.Fatalf("execute %s: %v", test.op, err)
		}
	}
	if writes != 5 {
		t.Fatalf("writes: %d", writes)
	}
	prepared, err := runtime.PrepareAction(d.ID, "pull_comment", json.RawMessage(fmt.Sprintf(`{"payload":{"number":4,"expected_head_sha":%q,"body":"Check"}}`, sha)))
	if err != nil {
		t.Fatal(err)
	}
	changed = true
	if _, err = runtime.ExecutePreparedWithEvidence(context.Background(), action.Act, prepared); err == nil || writes != 5 {
		t.Fatal("stale PR mutated")
	}
	changed = false
	uncertain = true
	_, err = runtime.ExecutePreparedWithEvidence(context.Background(), action.Act, prepared)
	type uncertainError interface{ OutcomeUncertain() bool }
	var flag uncertainError
	if !errors.As(err, &flag) || !flag.OutcomeUncertain() {
		t.Fatalf("missing receipt was called successful: %v", err)
	}
}
func TestGitHubRejectsBroaderTargetsAndUnboundActions(t *testing.T) {
	d := Descriptor{Version: DescriptorVersion, ID: "github", Name: "GitHub", Kind: KindGitHub, Resource: "https://api.github.com/repos/owner/repo", Authentication: AuthBearer}
	for _, resource := range []string{"https://api.github.com", "https://api.github.com/repos/owner/repo?token=secret", "https://example.test/repos/owner/repo", "https://api.github.com/repos/../repo"} {
		invalid := d
		invalid.Resource = resource
		if invalid.Validate() == nil {
			t.Fatalf("invalid target: %s", resource)
		}
	}
	if _, _, err := githubAction(d, "pull_merge", []byte(`{"number":4,"merge_method":"squash"}`)); err == nil {
		t.Fatal("unbound merge prepared")
	}
	for _, id := range []string{"../4", "0", "04", "4/comments"} {
		if _, _, _, err := githubRead(d, "pull_get", serviceInput{ResourceID: id}); err == nil {
			t.Fatalf("invalid PR %q", id)
		}
	}
}

func TestGitHubIssuesAndWorkflowRuntime(t *testing.T) {
	writes := 0
	updated := "2026-11-26T00:00:00Z"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if !strings.HasPrefix(r.URL.Path, "/repos/owner/repo") {
			t.Error("escaped repo")
		}
		if r.Method == http.MethodGet {
			if r.URL.Path == "/repos/owner/repo/issues/4" {
				fmt.Fprintf(w, `{"id":12,"number":4,"updated_at":%q}`, updated)
			} else {
				fmt.Fprint(w, `[]`)
			}
			return
		}
		writes++
		if r.URL.Path == "/repos/owner/repo/issues/4" && r.Method != "PATCH" {
			t.Error("wrong issue update method")
		}
		fmt.Fprint(w, `{"id":12,"number":4}`)
	}))
	defer server.Close()
	d := Descriptor{Version: 1, ID: "github", Name: "GitHub", Kind: KindGitHub, Resource: server.URL + "/repos/owner/repo", Authentication: AuthNone}
	registry, err := NewRegistry([]Descriptor{d})
	if err != nil {
		t.Fatal(err)
	}
	runtime := Runtime{Registry: registry, HTTPClient: server.Client()}
	for _, op := range []string{"repo_get", "branches_list", "issues_list", "issue_get", "issue_comments", "workflow_runs", "workflow_run_get", "workflow_jobs"} {
		if _, err := runtime.Invoke(context.Background(), action.Inspect, d.ID, op, json.RawMessage(`{"resource_id":"4","cursor":"2","limit":5}`)); err != nil {
			t.Fatalf("%s: %v", op, err)
		}
	}
	for _, tc := range []struct{ op, input string }{
		{"issue_create", `{"payload":{"title":"Bug","body":"Details"}}`},
		{"issue_update", `{"payload":{"number":4,"expected_updated_at":"2026-11-26T00:00:00Z","state":"closed"}}`},
		{"issue_comment", `{"payload":{"number":4,"body":"Comment"}}`},
	} {
		p, err := runtime.PrepareAction(d.ID, tc.op, json.RawMessage(tc.input))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := runtime.ExecutePreparedWithEvidence(context.Background(), action.Act, p); err != nil {
			t.Fatalf("%s: %v", tc.op, err)
		}
	}
	p, err := runtime.PrepareAction(d.ID, "issue_update", json.RawMessage(`{"payload":{"number":4,"expected_updated_at":"2026-11-26T00:00:00Z","title":"Changed"}}`))
	if err != nil {
		t.Fatal(err)
	}
	updated = "2026-11-26T00:01:00Z"
	if _, err := runtime.ExecutePreparedWithEvidence(context.Background(), action.Act, p); err == nil || writes != 3 {
		t.Fatal("stale issue edited")
	}
	if _, _, _, err := githubRead(d, "workflow_jobs", serviceInput{ResourceID: "12345678901"}); err != nil {
		t.Fatal("valid workflow ID rejected", err)
	}
	if _, _, err := githubIssueAction(d, "issue_update", []byte(`{"number":4,"title":"No timestamp"}`)); err == nil {
		t.Fatal("unbound edit")
	}
}
