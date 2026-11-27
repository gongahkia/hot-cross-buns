package telemetry

import (
	"context"
	"encoding/json"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestOTLPMetadataRedactionHierarchyAndFailure(t *testing.T) {
	trace := New("private-run", time.Now())
	trace.Record(agent.Event{Kind: agent.EventToolCalled, At: time.Now(), TaskID: "private-run/child", Text: "SECRET_PROMPT", ToolCall: &agent.ToolCall{Name: "read_file", Arguments: json.RawMessage(`{"path":"SECRET_DOCUMENT"}`)}})
	trace.Spans[0].End = time.Now()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		if strings.Contains(string(data), "SECRET") {
			t.Error("private content exported")
		}
		var body map[string]any
		if json.Unmarshal(data, &body) != nil || body["resourceSpans"] == nil {
			t.Error("invalid OTLP body")
		}
		w.WriteHeader(200)
	}))
	defer server.Close()
	if err := ExportOTLP(context.Background(), server.Client(), server.URL, trace); err != nil {
		t.Fatal(err)
	}
	if len(trace.Spans) != 3 || trace.Spans[2].Parent != trace.Spans[1].ID {
		t.Fatalf("hierarchy: %+v", trace.Spans)
	}
	failure := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(503)
		_, _ = w.Write([]byte("SECRET_PROVIDER_ERROR"))
	}))
	defer failure.Close()
	err := ExportOTLP(context.Background(), failure.Client(), failure.URL, trace)
	if err == nil || strings.Contains(err.Error(), "SECRET") {
		t.Fatalf("failure: %v", err)
	}
	for i := 0; i < 1000; i++ {
		trace.Record(agent.Event{Kind: agent.EventTurnStarted, At: time.Now()})
	}
	if trace.Dropped == 0 || len(trace.Spans) > 512 {
		t.Fatal("retention unbounded")
	}
}

func TestCLIFailureMetadataPersistsInExistingPrivateTrace(t *testing.T) {
	trace := New("fixture-run", time.Now())
	code := 7
	trace.Record(agent.Event{Kind: agent.EventSubagent, At: time.Now(), Text: "PRIVATE_PROMPT", ProviderDiagnostic: &agent.ProviderDiagnostic{Provider: "pi", Transport: "cli", Method: "rpc", Phase: "native handshake", ExitCode: &code}})
	root := t.TempDir()
	if err := trace.Finish(root, ""); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "trace.json"))
	if err != nil {
		t.Fatal(err)
	}
	var stored Trace
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	if len(stored.Spans) != 2 || stored.Spans[1].ProviderDiagnostic == nil || *stored.Spans[1].ProviderDiagnostic.ExitCode != 7 || strings.Contains(string(data), "PRIVATE_PROMPT") {
		t.Fatalf("CLI trace lost safe metadata: %s", data)
	}
	info, _ := os.Stat(filepath.Join(root, "trace.json"))
	if info.Mode().Perm() != 0600 {
		t.Fatalf("trace permissions: %v", info.Mode())
	}
}

func TestLinkedTraceExportsSafeUsageAndLifecycleMetadata(t *testing.T) {
	workflow := "private-conversation\x00private-turn"
	routing := NewLinked("route", workflow, "", time.Now())
	work := NewLinked("run", workflow, "route", time.Now())
	if routing.ID != work.ID || work.Spans[0].Parent != routing.Spans[0].ID {
		t.Fatal("workflow is disconnected")
	}
	done := work.Phase("approval")
	done(context.Canceled)
	work.Record(agent.Event{Kind: agent.EventModelAttemptStarted, Step: 2, Attempt: 3, At: time.Now()})
	work.Record(agent.Event{Kind: agent.EventModelAttemptFinished, Step: 2, Attempt: 3, At: time.Now(), Outcome: "failed", Usage: &agent.Usage{InputTokens: 123, OutputTokens: 7, Reported: true}, ProviderDiagnostic: &agent.ProviderDiagnostic{Status: 429, Endpoint: "https://private.invalid/PRIVATE_ERROR"}})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		text := string(data)
		for _, secret := range []string{"private-conversation", "private-turn", "PRIVATE_ERROR"} {
			if strings.Contains(text, secret) {
				t.Error("private metadata exported")
			}
		}
		for _, field := range []string{"gen_ai.usage.input_tokens", "123", "hcb.attempt", "hcb.provider.http_status", "429", "hcb.outcome"} {
			if !strings.Contains(text, field) {
				t.Errorf("missing %s", field)
			}
		}
	}))
	defer server.Close()
	if err := ExportOTLP(context.Background(), server.Client(), server.URL, work); err != nil {
		t.Fatal(err)
	}
	if work.Spans[1].Outcome != "failed" || work.Spans[1].End.Before(work.Spans[1].Start) {
		t.Fatal("lifecycle phase did not finish")
	}
}
