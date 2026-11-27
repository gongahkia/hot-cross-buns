package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type concurrentRead struct {
	entered chan string
	release chan struct{}
	effects *atomic.Int32
}

func (t concurrentRead) Definition() ToolDefinition {
	return ToolDefinition{Name: "read", Parameters: json.RawMessage(`{}`)}
}
func (t concurrentRead) Execute(ctx context.Context, raw json.RawMessage) (ToolResult, error) {
	t.effects.Add(1)
	t.entered <- string(raw)
	select {
	case <-t.release:
		return ToolResult{Content: string(raw)}, nil
	case <-ctx.Done():
		return ToolResult{}, ctx.Err()
	}
}
func TestIndependentReadsOverlapButPublishOrderedAndSteerBeforeNextEffect(t *testing.T) {
	entered := make(chan string, 2)
	release := make(chan struct{})
	effects := &atomic.Int32{}
	tool := concurrentRead{entered, release, effects}
	write := &recordingTool{}
	model := &scriptedModel{turns: []Turn{{ToolCalls: []ToolCall{{ID: "a", Name: "read", Arguments: json.RawMessage(`{"n":1}`)}, {ID: "b", Name: "read", Arguments: json.RawMessage(`{"n":2}`)}, {ID: "c", Name: "read_file", Arguments: json.RawMessage(`{}`)}}}, {Text: "steered"}}}
	steering := make(chan string, 1)
	before := []string{}
	after := []string{}
	finished := make(chan error, 1)
	go func() {
		_, err := (Runner{Model: model, Tools: []Tool{tool, write}}).Run(context.Background(), RunOptions{Task: "inspect", Steering: steering, IndependentRead: func(c ToolCall) bool { return c.Name == "read" }, BeforeTool: func(_ context.Context, c ToolCall) error { before = append(before, c.ID); return nil }, AfterTool: func(_ context.Context, c ToolCall, _ ToolResult, _ error) error {
			after = append(after, c.ID)
			if c.ID == "a" {
				steering <- "stop before writing"
			}
			return nil
		}})
		finished <- err
	}()
	for range 2 {
		select {
		case <-entered:
		case <-time.After(3 * time.Second):
			close(release)
			t.Fatal("reads did not overlap")
		}
	}
	close(release)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	if strings.Join(before, ",") != "a,b" || strings.Join(after, ",") != "a,b" || len(write.arguments) > 0 || effects.Load() != 2 {
		t.Fatal(before, after, write.arguments, effects.Load())
	}
	messages := model.requests[1].Messages
	if messages[2].ToolCallID != "a" || messages[3].ToolCallID != "b" || messages[4].ToolCallID != "c" {
		t.Fatal(messages)
	}
}
func TestParallelCancellationAndDeniedReadNeverExecutes(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	effects := &atomic.Int32{}
	entered := make(chan string, 2)
	tool := concurrentRead{entered, make(chan struct{}), effects}
	finished := make(chan []toolExecution, 1)
	go func() {
		finished <- parallelReads(ctx, map[string]Tool{"read": tool}, []ToolCall{{ID: "a", Name: "read", Arguments: json.RawMessage(`{}`)}, {ID: "b", Name: "read", Arguments: json.RawMessage(`{}`)}}, func(_ context.Context, c ToolCall) error {
			if c.ID == "b" {
				return errors.New("denied")
			}
			return nil
		})
	}()
	<-entered
	cancel()
	results := <-finished
	if effects.Load() != 1 || results[1].executed || !errors.Is(results[0].err, context.Canceled) {
		t.Fatal(results, effects.Load())
	}
}
