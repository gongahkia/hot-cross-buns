package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/connector"
	"github.com/gongahkia/hot-cross-buns/internal/jobs"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func TestScheduledNotificationConditionsCannotHideFailedAccountReads(t *testing.T) {
	for _, failed := range []bool{false, true} {
		t.Run(fmt.Sprint(failed), func(t *testing.T) {
			state, source := t.TempDir(), t.TempDir()
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.Header().Set("Content-Type", "application/json")
				if failed {
					w.WriteHeader(429)
					fmt.Fprint(w, `{"error":"unavailable"}`)
				} else {
					fmt.Fprint(w, `{"messages":[]}`)
				}
			}))
			defer server.Close()
			registry, _ := connector.NewRegistry([]connector.Descriptor{{Version: 1, ID: "google", Name: "Mail", Kind: connector.KindGoogle, Resource: server.URL, Authentication: connector.AuthNone}})
			manager := &workScriptedModel{turns: []agent.Turn{{ToolCalls: []agent.ToolCall{{ID: "mail", Name: "connector_google_gmail_list", Arguments: json.RawMessage(`{"query":"is:unread","limit":5}`)}}}, {Text: `{"attention":false,"urgent":false,"summary":"Nothing needs attention","next_step":"","rationale":"No new mail","evidence":[],"change_ids":[]}`}}}
			service := workrun.Service{Executor: workrun.Executor{Model: manager, StateDir: state, Connectors: connector.Runtime{Registry: registry, HTTPClient: server.Client()}}}
			d := jobs.Definition{ID: "job-brief", SourcePath: source, Objective: "Read mail and report material changes", AlertWhen: "A substantive reply arrives", Mode: action.Inspect, Contract: artifact.InspectionContract(), ConnectorIDs: []string{"google"}, ReadOperations: map[string][]string{"google": {"gmail_list"}}, MaxSteps: 4}
			result, err := runJobProcessWith(context.Background(), d, state, func(ctx context.Context, _, _, _ string, r workrun.Request) (workrun.Outcome, error) {
				if !strings.Contains(r.System, "Notification agreement") {
					t.Fatal("notification agreement missing")
				}
				return service.Execute(ctx, r)
			}, "brief-case")
			if err != nil {
				t.Fatal(err)
			}
			if calls != 1 {
				t.Fatalf("calls: %d", calls)
			}
			if failed {
				if !result.WatchAttention || result.WatchDecision == nil || result.WatchDecision.Status != "review" {
					t.Fatalf("failed read hidden as quiet: %#v", result)
				}
			} else if result.WatchAttention {
				t.Fatalf("successful quiet read became noise: %#v", result)
			}
		})
	}
}
