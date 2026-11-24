package tools

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/connector"
)

func TestCalendarToolChangesRequireFreshApprovalAndCannotRunUnattended(t *testing.T) {
	for _, allow := range []bool{false, true} {
		t.Run(map[bool]string{false: "denied", true: "approved"}[allow], func(t *testing.T) {
			calls, reviews := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"id":"event-1"}`))
			}))
			defer server.Close()
			registry, err := connector.NewRegistry([]connector.Descriptor{{Version: 1, ID: "google", Name: "Google", Kind: connector.KindGoogle, Resource: server.URL, Authentication: connector.AuthNone}})
			if err != nil {
				t.Fatal(err)
			}
			runtime := connector.Runtime{Registry: registry, HTTPClient: server.Client()}
			surface, err := ConnectorTools(runtime, []string{"google"}, ConnectorPolicy{Mode: action.Act, ExternalActions: action.Approve, Approve: func(_ context.Context, p action.Proposal) (action.Decision, error) {
				reviews++
				if !strings.Contains(p.Preview, "primary") || !strings.Contains(p.Preview, "send_updates") {
					t.Fatal("review lost event target or notification choice")
				}
				if allow {
					return action.Allow, nil
				}
				return action.Deny, nil
			}})
			if err != nil {
				t.Fatal(err)
			}
			tool := toolNamed(t, surface, "connector_google_calendar_event_create")
			_, err = tool.Execute(context.Background(), []byte(`{"payload":{"calendar_id":"primary","send_updates":"none","summary":"Workshop","start":{"date":"2030-05-16"},"end":{"date":"2030-05-17"}}}`))
			if err != nil {
				t.Fatal(err)
			}
			if reviews != 1 || calls != map[bool]int{false: 0, true: 1}[allow] {
				t.Fatal("calendar bypassed exact action approval", calls, reviews)
			}
			readonly, err := ConnectorTools(runtime, []string{"google"}, ConnectorPolicy{Mode: action.Inspect, ExternalActions: action.Forbid})
			if err != nil {
				t.Fatal(err)
			}
			for _, tool := range readonly {
				if strings.Contains(tool.Definition().Name, "calendar_event_create") || strings.Contains(tool.Definition().Name, "calendar_event_update") || strings.Contains(tool.Definition().Name, "calendar_event_delete") {
					t.Fatal("unattended read surface gained writes")
				}
			}
		})
	}
}
