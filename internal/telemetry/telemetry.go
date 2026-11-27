// Package telemetry exports bounded metadata without making vendor schemas durable state.
package telemetry

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
)

type Span struct {
	Outcome            string                    `json:"outcome,omitempty"`
	ProviderDiagnostic *agent.ProviderDiagnostic `json:"provider_diagnostic,omitempty"`
	ID                 string                    `json:"id"`
	Parent             string                    `json:"parent,omitempty"`
	Name               string                    `json:"name"`
	Start              time.Time                 `json:"start"`
	End                time.Time                 `json:"end"`
	Task               string                    `json:"task,omitempty"`
	Step               int                       `json:"step,omitempty"`
	Attempt            int                       `json:"attempt,omitempty"`
	Usage              *agent.Usage              `json:"usage,omitempty"`
}
type Trace struct {
	Version     int    `json:"version"`
	ID          string `json:"id"`
	Spans       []Span `json:"spans"`
	Dropped     int    `json:"dropped"`
	ExportError string `json:"export_error,omitempty"`
	mu          sync.Mutex
	open        map[string]int
}

func ID(value string, n int) string {
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])[:n]
}
func New(run string, at time.Time) *Trace {
	id := ID(run, 32)
	return &Trace{Version: 1, ID: id, Spans: []Span{{ID: ID(run+"/work", 16), Name: "work", Start: at}}, open: map[string]int{}}
}

// NewLinked joins host-selected routing and work records without exporting
// conversation identifiers or interpreting correlation as execution authority.
func NewLinked(run, workflow, parent string, at time.Time) *Trace {
	t := New(run, at)
	if workflow != "" {
		t.ID = ID(workflow, 32)
	}
	if parent != "" {
		t.Spans[0].Parent = ID(parent+"/work", 16)
	}
	return t
}

func (t *Trace) Phase(name string) func(error) {
	start := time.Now().UTC()
	t.mu.Lock()
	if len(t.Spans) >= 511 {
		t.Dropped++
		t.mu.Unlock()
		return func(error) {}
	}
	i := len(t.Spans)
	t.Spans = append(t.Spans, Span{ID: ID(fmt.Sprintf("%s/phase/%d", t.Spans[0].ID, i), 16), Parent: t.Spans[0].ID, Name: name, Start: start})
	t.mu.Unlock()
	return func(err error) {
		t.mu.Lock()
		defer t.mu.Unlock()
		t.Spans[i].End = time.Now().UTC()
		t.Spans[i].Outcome = "completed"
		if err != nil {
			t.Spans[i].Outcome = "failed"
		}
	}
}
func (t *Trace) Record(event agent.Event) {
	switch event.Kind {
	case agent.EventTextDelta, agent.EventText:
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	key := fmt.Sprintf("%s/%d/%d", event.TaskID, event.Step, event.Attempt)
	approval := event.Kind == agent.EventApprovalRequested || event.Kind == agent.EventApprovalResolved
	if approval {
		key += "/approval"
	}
	if event.ToolCall != nil {
		key += "/" + event.ToolCall.ID
	}
	if event.Kind == agent.EventModelAttemptFinished || event.Kind == agent.EventToolFinished || event.Kind == agent.EventApprovalResolved {
		if index, ok := t.open[key]; ok {
			t.Spans[index].End = event.At
			t.Spans[index].Usage = event.Usage
			t.Spans[index].ProviderDiagnostic = event.ProviderDiagnostic
			t.Spans[index].Outcome = "completed"
			if event.ToolError != "" || event.ProviderDiagnostic != nil {
				t.Spans[index].Outcome = "failed"
			}
			if event.Outcome != "" {
				t.Spans[index].Outcome = event.Outcome
			}
			delete(t.open, key)
			return
		}
	}
	if len(t.Spans) >= 511 {
		t.Dropped++
		return
	}
	parent := t.Spans[0].ID
	if event.TaskID != "" {
		parent = ID(event.TaskID, 16)
		found := false
		for i, span := range t.Spans {
			if span.ID == parent {
				found = true
				t.Spans[i].End = event.At
			}
		}
		if !found {
			t.Spans = append(t.Spans, Span{ID: parent, Parent: t.Spans[0].ID, Name: "specialist", Task: event.TaskID, Start: event.At, End: event.At})
		}
	}
	name := string(event.Kind)
	if event.Kind == agent.EventModelAttemptStarted {
		name = "model_attempt"
	}
	if event.ToolCall != nil {
		name = "tool/" + event.ToolCall.Name
	}
	if event.Kind == agent.EventToolCalled || event.Kind == agent.EventModelAttemptStarted || event.Kind == agent.EventApprovalRequested {
		t.open[key] = len(t.Spans)
	}
	t.Spans = append(t.Spans, Span{ID: ID(fmt.Sprintf("%s/%d", t.ID, len(t.Spans)), 16), Parent: parent, Name: name, ProviderDiagnostic: event.ProviderDiagnostic, Start: event.At, End: event.At, Task: event.TaskID, Step: event.Step, Attempt: event.Attempt})
}
func (t *Trace) Finish(directory, endpoint string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.Spans[0].End = time.Now().UTC()
	if endpoint != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		err := ExportOTLP(ctx, http.DefaultClient, endpoint, t)
		cancel()
		if err != nil {
			t.ExportError = err.Error()
		}
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(t, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(directory, "trace.json"), data, 0600)
}
func ExportOTLP(ctx context.Context, client *http.Client, endpoint string, trace *Trace) error {
	spans := make([]map[string]any, 0, len(trace.Spans))
	for _, span := range trace.Spans {
		attributes := []any{}
		integer := func(key string, value int64) {
			attributes = append(attributes, map[string]any{"key": key, "value": map[string]string{"intValue": strconv.FormatInt(value, 10)}})
		}
		text := func(key, value string) {
			if value != "" {
				attributes = append(attributes, map[string]any{"key": key, "value": map[string]string{"stringValue": value}})
			}
		}
		integer("hcb.step", int64(span.Step))
		integer("hcb.attempt", int64(span.Attempt))
		text("hcb.outcome", span.Outcome)
		if span.Task != "" {
			text("hcb.task", ID(span.Task, 32))
		}
		if span.Usage != nil {
			integer("gen_ai.usage.input_tokens", span.Usage.InputTokens)
			integer("gen_ai.usage.output_tokens", span.Usage.OutputTokens)
			integer("hcb.usage.unknown_requests", int64(span.Usage.UnknownRequests))
		}
		// Diagnostics may contain URLs or provider-generated text. Export only
		// numeric status metadata; raw errors, prompts and tool arguments stay out.
		if d := span.ProviderDiagnostic; d != nil {
			integer("hcb.provider.http_status", int64(d.Status))
		}
		end := span.End
		if end.IsZero() {
			end = span.Start
		}
		spans = append(spans, map[string]any{"traceId": trace.ID, "spanId": span.ID, "parentSpanId": span.Parent, "name": span.Name, "kind": 1, "startTimeUnixNano": strconv.FormatInt(span.Start.UnixNano(), 10), "endTimeUnixNano": strconv.FormatInt(end.UnixNano(), 10), "attributes": attributes})
	}
	payload := map[string]any{"resourceSpans": []any{map[string]any{"resource": map[string]any{"attributes": []any{map[string]any{"key": "service.name", "value": map[string]string{"stringValue": "hot-cross-buns"}}}}, "scopeSpans": []any{map[string]any{"scope": map[string]string{"name": "hot-cross-buns.work", "version": "1"}, "spans": spans}}}}}
	return Post(ctx, client, endpoint, "", payload, nil)
}
func Post(ctx context.Context, client *http.Client, endpoint, key string, value, result any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(data) > 8*1024*1024 {
		return errors.New("export payload exceeds limit")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return errors.New("invalid export endpoint")
	}
	request.Header.Set("Content-Type", "application/json")
	if key != "" {
		request.Header.Set("x-api-key", key)
	}
	bounded := *client
	bounded.Timeout = 10 * time.Second
	bounded.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := bounded.Do(request)
	if err != nil {
		return errors.New("export transport failed")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("export HTTP status %d", response.StatusCode)
	}
	if result != nil {
		return json.NewDecoder(io.LimitReader(response.Body, 1024*1024)).Decode(result)
	}
	_, err = io.Copy(io.Discard, io.LimitReader(response.Body, 1024*1024))
	return err
}

// Observe keeps lifecycle timing independent of the private inputs and outputs.
func Observe[T, R any](trace *Trace, name string, fn func(context.Context, T) (R, error)) func(context.Context, T) (R, error) {
	if fn == nil {
		return nil
	}
	return func(ctx context.Context, input T) (R, error) {
		finish := trace.Phase(name)
		result, err := fn(ctx, input)
		finish(err)
		return result, err
	}
}
