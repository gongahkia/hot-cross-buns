package workactivity_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/connector"
	"github.com/gongahkia/hot-cross-buns/internal/model"
	"github.com/gongahkia/hot-cross-buns/internal/tools"
	"github.com/gongahkia/hot-cross-buns/internal/workactivity"
)

// opt-in cloud calls use synthetic data and a loopback Slack fixture, never a real account.
func TestLiveCloudBrandedActivity(t *testing.T) {
	directory := os.Getenv("HOT_CROSS_BUNS_LIVE_BRANDING_REPORT_DIR")
	if directory == "" {
		t.Skip("set HOT_CROSS_BUNS_LIVE_BRANDING_REPORT_DIR, HOT_CROSS_BUNS_LIVE_MODELS and OPENAI_API_KEY")
	}
	if os.Getenv("OPENAI_API_KEY") == "" {
		t.Fatal("OpenAI credential unavailable")
	}
	selected := strings.Split(os.Getenv("HOT_CROSS_BUNS_LIVE_MODELS"), ",")
	if len(selected) == 0 || len(selected) > 2 || selected[0] == "" {
		t.Fatal("choose one or two cloud models")
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range selected {
		t.Run(name, func(t *testing.T) {
			var requests atomic.Int32
			service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/search.messages" {
					t.Errorf("unexpected fixture operation %q", r.URL.Path)
					w.WriteHeader(404)
					return
				}
				requests.Add(1)
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"ok":true,"messages":{"matches":[{"text":"Synthetic verification code: BREAD-42","channel":{"name":"fixture"}}]}}`)
			}))
			defer service.Close()
			registry, err := connector.NewRegistry([]connector.Descriptor{{Version: 1, ID: "logo-fixture", Name: "Synthetic Slack fixture", Kind: connector.KindSlack, Resource: service.URL, Authentication: connector.AuthNone}})
			if err != nil {
				t.Fatal(err)
			}
			surface, err := tools.ConnectorTools(connector.Runtime{Registry: registry, HTTPClient: service.Client()}, []string{"logo-fixture"}, tools.ConnectorPolicy{Mode: action.Inspect, ExternalActions: action.Forbid})
			if err != nil {
				t.Fatal(err)
			}
			var search agent.Tool
			for _, tool := range surface {
				if strings.HasSuffix(tool.Definition().Name, "_search") {
					search = tool
				}
			}
			if search == nil {
				t.Fatal("search adapter missing")
			}
			transport := &brandingCloudTransport{}
			backend, err := model.New(model.Config{Provider: model.OpenAI, Model: name, Client: &http.Client{Transport: transport, Timeout: 60 * time.Second}})
			if err != nil {
				t.Fatal("cannot initialize cloud adapter")
			}
			budget := &agent.Budget{Limits: agent.Limits{ModelRequests: 3, Tokens: 16000}}
			trace := workactivity.New(time.Now())
			ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
			defer cancel()
			result, runErr := (agent.Runner{Model: agent.WithBudget(backend.Model, budget), Tools: []agent.Tool{search}}).Run(ctx, agent.RunOptions{
				Task:     "Search the synthetic Slack fixture for the verification code. Call the provided search tool once using query verification. Then reply with the returned code in one short sentence. This is a test fixture, not a real Slack account.",
				MaxSteps: 3, OnEvent: trace.Record,
			})
			state := "completed"
			if runErr != nil {
				state = "failed"
			}
			trace.Finish(time.Now(), state, result.FinalText)
			passed := runErr == nil && requests.Load() == 1 && strings.Contains(result.FinalText, "BREAD-42") && len(trace.Entries) > 0 && trace.ValidDetails()
			branded := 0
			for _, entry := range trace.Entries {
				if entry.Kind == "tool" && entry.Brand == "slack" && entry.State == "completed" {
					branded++
				}
			}
			passed = passed && branded == 1
			report := struct {
				Model           string              `json:"model"`
				Passed          bool                `json:"passed"`
				Answer          string              `json:"answer"`
				Usage           agent.Usage         `json:"usage"`
				Activity        *workactivity.Trace `json:"activity"`
				FixtureRequests int32               `json:"fixture_requests"`
				Note            string              `json:"note"`
			}{name, passed, result.FinalText, budget.Usage(), trace.Clone(), requests.Load(), "Real OpenAI model and native connector/runner/activity code. Slack upstream is a loopback synthetic fixture; no real Slack account was contacted."}
			encoded, err := json.MarshalIndent(report, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(directory, strings.ReplaceAll(name, "/", "_")+".json")
			if err := os.WriteFile(file, append(encoded, '\n'), 0600); err != nil {
				t.Fatal(err)
			}
			if runErr != nil {
				t.Fatalf("cloud run failed: %v", runErr)
			}
			if !passed {
				t.Fatalf("branded activity check failed (fixture calls %d, branded completions %d)", requests.Load(), branded)
			}
			t.Logf("verified %s: %d cloud requests, %d input tokens, %d output tokens", name, budget.Usage().ModelRequests, budget.Usage().InputTokens, budget.Usage().OutputTokens)
		})
	}
}

type brandingCloudTransport struct{ requests atomic.Int32 }

func (t *brandingCloudTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.Scheme != "https" || request.URL.Host != "api.openai.com" || request.URL.Path != "/v1/responses" {
		return nil, fmt.Errorf("live branding test permits only the official Responses endpoint")
	}
	if t.requests.Add(1) > 3 {
		return nil, fmt.Errorf("live branding request ceiling reached")
	}
	// bound generated tokens without changing the production provider adapter.
	body, err := io.ReadAll(request.Body)
	if err != nil {
		return nil, err
	}
	_ = request.Body.Close()
	var value map[string]any
	if err := json.Unmarshal(body, &value); err != nil {
		return nil, err
	}
	value["max_output_tokens"] = 4096
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	clone := request.Clone(request.Context())
	clone.Body = io.NopCloser(bytes.NewReader(encoded))
	clone.ContentLength = int64(len(encoded))
	return http.DefaultTransport.RoundTrip(clone)
}
