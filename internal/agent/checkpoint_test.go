package agent

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

func TestCheckpointPauseResumeRetainsResultsWithoutReplayingEffects(t *testing.T) {
	dir := t.TempDir()
	pause := make(chan struct{})
	tool := &recordingTool{result: ToolResult{Content: "retained evidence"}}
	config := CheckpointConfig{Directory: dir, ID: "run", Scope: "workspace+permissions+account-pins:v1"}
	model := &scriptedModel{turns: []Turn{{ToolCalls: []ToolCall{{ID: "read-1", Name: "read_file", Arguments: json.RawMessage(`{}`)}}}}}
	result, err := (Runner{Model: model, Tools: []Tool{tool}}).Run(context.Background(), RunOptions{Task: "inspect", Checkpoint: &config, Pause: pause, AfterTool: func(context.Context, ToolCall, ToolResult, error) error { close(pause); return nil }})
	if !errors.Is(err, ErrPaused) || result.Steps != 1 || result.Completion.Status != "paused" {
		t.Fatal(result, err)
	}
	tool.arguments = nil
	config.Resume = true
	checks := 0
	config.Revalidate = func(_ context.Context, s RunCheckpoint) error {
		checks++
		if s.NextStep != 2 {
			t.Fatal(s)
		}
		return nil
	}
	model = &scriptedModel{turns: []Turn{{Text: "finished"}}}
	result, err = (Runner{Model: model, Tools: []Tool{tool}}).Run(context.Background(), RunOptions{Task: "inspect", Checkpoint: &config})
	if err != nil || result.Steps != 2 || checks != 1 || len(tool.arguments) > 0 {
		t.Fatal(result, err)
	}
	if model.requests[0].Messages[2].ToolCallID != "read-1" {
		t.Fatal(model.requests)
	}
	if info, err := os.Stat(CheckpointPath(dir, "run")); err != nil || info.Mode().Perm() != 0600 {
		t.Fatal(info, err)
	}
	if _, err = (Runner{Model: model, Tools: []Tool{tool}}).Run(context.Background(), RunOptions{Task: "inspect", Checkpoint: &config}); !errors.Is(err, ErrCheckpoint) {
		t.Fatal("resumed completed checkpoint", err)
	}
}
func TestCheckpointRejectsChangedScopeCorruptionMissingRevalidationAndPendingEffects(t *testing.T) {
	config := CheckpointConfig{Directory: t.TempDir(), ID: "run", Scope: "v1"}
	pause := make(chan struct{})
	close(pause)
	_, err := (Runner{Model: &scriptedModel{}}).Run(context.Background(), RunOptions{Task: "work", Checkpoint: &config, Pause: pause})
	if !errors.Is(err, ErrPaused) {
		t.Fatal(err)
	}
	config.Resume = true
	for _, modify := range []func(*CheckpointConfig){func(c *CheckpointConfig) {}, func(c *CheckpointConfig) {
		c.Scope = "widened"
		c.Revalidate = func(context.Context, RunCheckpoint) error { return nil }
	}} {
		c := config
		modify(&c)
		if _, err := (Runner{Model: &scriptedModel{}}).Run(context.Background(), RunOptions{Task: "work", Checkpoint: &c}); !errors.Is(err, ErrCheckpoint) {
			t.Fatal(err)
		}
	}
	path := CheckpointPath(config.Directory, config.ID)
	if err := os.WriteFile(path, []byte(`{"checksum":"bad","payload":{}}`), 0600); err != nil {
		t.Fatal(err)
	}
	config.Revalidate = func(context.Context, RunCheckpoint) error { return nil }
	if _, err := (Runner{Model: &scriptedModel{}}).Run(context.Background(), RunOptions{Task: "work", Checkpoint: &config}); !errors.Is(err, ErrCheckpoint) {
		t.Fatal(err)
	}
	config.ID = "uncertain"
	config.Resume = false
	tool := checkpointCrashTool{}
	model := &scriptedModel{turns: []Turn{{ToolCalls: []ToolCall{{ID: "effect", Name: "write", Arguments: json.RawMessage(`{}`)}}}}}
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("missing simulated crash")
			}
		}()
		_, _ = (Runner{Model: model, Tools: []Tool{tool}}).Run(context.Background(), RunOptions{Task: "work", Checkpoint: &config})
	}()
	config.Resume = true
	if _, err := (Runner{Model: model, Tools: []Tool{tool}}).Run(context.Background(), RunOptions{Task: "work", Checkpoint: &config}); !errors.Is(err, ErrCheckpoint) {
		t.Fatal("uncertain effect replayed", err)
	}
}

type checkpointCrashTool struct{}

func (checkpointCrashTool) Definition() ToolDefinition {
	return ToolDefinition{Name: "write", Parameters: json.RawMessage(`{}`)}
}
func (checkpointCrashTool) Execute(context.Context, json.RawMessage) (ToolResult, error) {
	panic("simulated process exit after effect")
}
func TestCheckpointLeaseAndMediaPrivacy(t *testing.T) {
	config := CheckpointConfig{Directory: t.TempDir(), ID: "run", Scope: "v1"}
	first, err := openCheckpoint(config, "binding")
	if err != nil {
		t.Fatal(err)
	}
	defer first.close()
	if _, err := openCheckpoint(config, "binding"); !errors.Is(err, ErrCheckpoint) {
		t.Fatal(err)
	}
	if err := first.save(context.Background(), RunCheckpoint{State: "ready", NextStep: 1, Messages: []Message{{Role: RoleUser, Images: []Image{{Data: []byte("private screenshot")}}}}}); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(CheckpointPath(config.Directory, config.ID))
	if strings.Contains(string(raw), "cHJpdmF0ZSBzY3JlZW5zaG90") {
		t.Fatal("screenshot persisted")
	}
	if _, err := first.load(context.Background(), 4); !errors.Is(err, ErrCheckpoint) {
		t.Fatal(err)
	}
}

func TestCheckpointRestoresBudgetAndRejectsChangedLimits(t *testing.T) {
	config := CheckpointConfig{Directory: t.TempDir(), ID: "run", Scope: "scope-v1"}
	pause := make(chan struct{})
	tool := &recordingTool{result: ToolResult{Content: "evidence"}, onExecute: func(int) { close(pause) }}
	budget := &Budget{Limits: Limits{ModelRequests: 2, Tokens: 1000}}
	model := &scriptedModel{turns: []Turn{{Usage: Usage{Reported: true, InputTokens: 10, OutputTokens: 3}, ToolCalls: []ToolCall{{ID: "a", Name: "read_file", Arguments: json.RawMessage(`{}`)}}}}}
	_, err := (Runner{Model: WithBudget(model, budget), Tools: []Tool{tool}}).Run(context.Background(), RunOptions{Task: "work", Checkpoint: &config, Pause: pause})
	if !errors.Is(err, ErrPaused) {
		t.Fatal(err)
	}
	config.Resume = true
	config.Revalidate = func(context.Context, RunCheckpoint) error { return nil }
	widened := &Budget{Limits: Limits{ModelRequests: 3, Tokens: 1000}}
	if _, err := (Runner{Model: WithBudget(&scriptedModel{}, widened), Tools: []Tool{tool}}).Run(context.Background(), RunOptions{Task: "work", Checkpoint: &config}); !errors.Is(err, ErrCheckpoint) {
		t.Fatal(err)
	}
	restored := &Budget{Limits: budget.Limits}
	final := &scriptedModel{turns: []Turn{{Text: "done", Usage: Usage{Reported: true, InputTokens: 4, OutputTokens: 2}}}}
	_, err = (Runner{Model: WithBudget(final, restored), Tools: []Tool{tool}}).Run(context.Background(), RunOptions{Task: "work", Checkpoint: &config})
	if err != nil || restored.Usage().ModelRequests != 2 || restored.Usage().InputTokens != 14 {
		t.Fatal(err, restored.Usage())
	}
}
