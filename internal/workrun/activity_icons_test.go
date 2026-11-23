package workrun

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/workactivity"
)

type iconFixtureTool struct{ calls int }

func (*iconFixtureTool) Definition() agent.ToolDefinition {
	return agent.ToolDefinition{Name: "read_file", Parameters: json.RawMessage(`{"type":"object","properties":{"path":{"type":"string"}},"required":["path"],"additionalProperties":false}`)}
}
func (t *iconFixtureTool) Execute(_ context.Context, raw json.RawMessage) (agent.ToolResult, error) {
	var value struct{ Path string }
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return agent.ToolResult{}, err
	}
	t.calls++
	return agent.ToolResult{Content: value.Path}, nil
}

func TestActivityIconIsOptionalPresentationWithoutWeakeningToolValidation(t *testing.T) {
	base := &iconFixtureTool{}
	tool := withActivityIcon(base)
	var definition struct {
		Properties map[string]any `json:"properties"`
		Required   []string       `json:"required"`
		Additional bool           `json:"additionalProperties"`
	}
	if err := json.Unmarshal(tool.Definition().Parameters, &definition); err != nil || definition.Properties["display_icon"] == nil || len(definition.Required) != 1 || definition.Required[0] != "path" || definition.Additional {
		t.Fatalf("tool schema changed validation: %#v %v", definition, err)
	}
	for _, raw := range []string{`{"path":"note.md"}`, `{"path":"note.md","display_icon":"book-open"}`} {
		result, err := tool.Execute(context.Background(), json.RawMessage(raw))
		if err != nil || result.Content != "note.md" {
			t.Fatalf("valid call: %#v %v", result, err)
		}
		effects, err := planToolEffects(tool, agent.ToolCall{Name: "read_file", Arguments: json.RawMessage(raw)})
		if err != nil || len(effects) != 1 || effects[0] != "read" {
			t.Fatalf("icon changed effects: %v %v", effects, err)
		}
	}
	for _, raw := range []string{`{"path":"note.md","display_icon":"<svg onload=bad>"}`, `{"path":"note.md","display_icon":null}`, `{"path":"note.md","display_icon":"brain","permission":"admin"}`} {
		if _, err := tool.Execute(context.Background(), json.RawMessage(raw)); err == nil {
			t.Fatalf("invalid call accepted: %s", raw)
		}
	}
	if base.calls != 2 {
		t.Fatalf("invalid call reached the tool: %d", base.calls)
	}
}

func TestForegroundModelSelectsIconThroughObservedToolActivity(t *testing.T) {
	model := &scriptedModel{turns: []agent.Turn{
		{ToolCalls: []agent.ToolCall{{ID: "read", Name: "list_files", Arguments: json.RawMessage(`{"path":"source","display_icon":"folder-search"}`)}}},
		{Text: "The folder is empty."},
	}}
	trace := workactivity.New(time.Now())
	_, err := (Executor{Model: model, StateDir: t.TempDir()}).Execute(context.Background(), Request{
		SourcePath: t.TempDir(), Objective: "Inspect this folder", RunID: "work-icon",
		Mode: action.Inspect, Contract: artifact.InspectionContract(), MaxSteps: 3, ForegroundApp: true, OnEvent: trace.Record,
	})
	if err != nil {
		t.Fatal(err)
	}
	var observed *workactivity.Entry
	for i := range trace.Entries {
		if trace.Entries[i].Tool == "list_files" {
			observed = &trace.Entries[i]
		}
	}
	if observed == nil || observed.Icon != "folder-search" || observed.State != "completed" {
		t.Fatalf("model icon did not reach completed public tool activity: %#v", trace.Entries)
	}
}

type brandedIconFixtureTool struct{ *iconFixtureTool }

func (brandedIconFixtureTool) DisplayBrand(raw json.RawMessage) string {
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields["display_icon"] != nil {
		return ""
	}
	return "slack"
}
func TestActivityAndSearchWrappersPreserveAdapterBrandWithoutExecuting(t *testing.T) {
	original := &iconFixtureTool{}
	tool := withActivityIcon(scopedWebSearch{tool: brandedIconFixtureTool{original}})
	if got := agent.ToolBrand(tool, json.RawMessage(`{"path":"note.md","display_icon":"brain"}`)); got != "slack" {
		t.Fatalf("wrapped brand=%q", got)
	}
	if got := agent.ToolBrand(tool, json.RawMessage(`{"display_icon":"bad"}`)); got != "" {
		t.Fatalf("invalid metadata accepted: %q", got)
	}
	if original.calls != 0 {
		t.Fatal("presentation executed tool")
	}
}
