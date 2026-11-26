package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/connector"
)

func TestCollaborationConnectionsUseToolEvidenceAndApprovalBroker(t *testing.T) {
	const id = "d9824bdc-8445-4327-be8b-5b47500af6ce"
	for _, tc := range []struct{ kind, path, read, readInput, write, writeInput, receipt string }{
		{connector.KindGitHub, "/repos/owner/repo", "repo_get", `{}`, "issue_create", `{"payload":{"title":"Bug"}}`, `{"id":12,"number":4}`},
		{connector.KindGitLab, "/api/v4/projects/123", "project_get", `{}`, "issue_create", `{"payload":{"title":"Bug"}}`, `{"id":12,"iid":4}`},
		{connector.KindSlack, "/slack", "thread_replies", `{"resource_id":"C123","thread_ts":"1482960137.003543"}`, "post_message", `{"payload":{"channel":"C123","text":"Hello"}}`, `{"ok":true,"channel":"C123","ts":"1482960137.003543"}`},
		{connector.KindNotion, "/notion", "data_source_query", `{"resource_id":"` + id + `"}`, "block_update", `{"payload":{"resource_id":"` + id + `","paragraph":{"rich_text":[]}}}`, `{"id":"` + id + `"}`},
	} {
		t.Run(tc.kind, func(t *testing.T) {
			writes := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.Method == http.MethodGet || strings.HasSuffix(r.URL.Path, "/query") {
					fmt.Fprint(w, `{"ok":true,"data":"untrusted content"}`)
					return
				}
				writes++
				fmt.Fprint(w, tc.receipt)
			}))
			defer server.Close()
			d := connector.Descriptor{Version: 1, ID: tc.kind, Name: tc.kind, Kind: tc.kind, Resource: server.URL + tc.path, Authentication: connector.AuthNone}
			registry, err := connector.NewRegistry([]connector.Descriptor{d})
			if err != nil {
				t.Fatal(err)
			}
			runtime := connector.Runtime{Registry: registry, HTTPClient: server.Client()}
			sources := 0
			inspect, err := ConnectorTools(runtime, []string{d.ID}, ConnectorPolicy{Mode: action.Inspect, ExternalActions: action.Forbid, OnSource: func(p connector.Provenance) {
				sources++
				if p.ConnectorID != d.ID || p.SHA256 == "" {
					t.Error("missing evidence")
				}
			}})
			if err != nil {
				t.Fatal(err)
			}
			for _, tool := range inspect {
				if tool.Definition().Name == "connector_"+d.ID+"_"+tc.write {
					t.Fatal("write exposed in inspect")
				}
			}
			if _, err := toolNamed(t, inspect, "connector_"+d.ID+"_"+tc.read).Execute(context.Background(), json.RawMessage(tc.readInput)); err != nil || sources != 1 {
				t.Fatal("read evidence missing", err)
			}
			for _, decision := range []action.Decision{action.Deny, action.Allow} {
				approvals := 0
				var records []action.Record
				surface, err := ConnectorTools(runtime, []string{d.ID}, ConnectorPolicy{Mode: action.Act, ExternalActions: action.Approve, Approve: func(_ context.Context, p action.Proposal) (action.Decision, error) {
					approvals++
					if !strings.HasPrefix(p.Target, d.Resource) || p.Preview == "" {
						t.Error("approval omitted target/payload")
					}
					return decision, nil
				}, OnAction: func(r action.Record) { records = append(records, r) }})
				if err != nil {
					t.Fatal(err)
				}
				executeTool(t, toolNamed(t, surface, "connector_"+d.ID+"_"+tc.write), tc.writeInput)
				if approvals != 1 || len(records) != 1 {
					t.Fatal("approval not mediated")
				}
				if decision == action.Deny && writes != 0 {
					t.Fatal("denied write executed")
				}
				if decision == action.Allow && (writes != 1 || records[0].Status != action.Executed || records[0].ResponseSHA256 == "") {
					t.Fatalf("approved result missing evidence: %+v", records)
				}
			}
		})
	}
}
