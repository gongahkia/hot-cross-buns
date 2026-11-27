package agent

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestDiscoveryExposesOnlyHostInventoryAndCannotInvokeGuessedTools(t *testing.T) {
	tool := &recordingTool{result: ToolResult{Content: "evidence"}}
	model := &scriptedModel{turns: []Turn{
		{ToolCalls: []ToolCall{{ID: "guess", Name: "read_file", Arguments: json.RawMessage(`{}`)}}},
		{ToolCalls: []ToolCall{{ID: "find", Name: "discover_tools", Arguments: json.RawMessage(`{"query":"read_file"}`)}}},
		{ToolCalls: []ToolCall{{ID: "read", Name: "read_file", Arguments: json.RawMessage(`{}`)}}},
		{Text: "done"},
	}}
	_, err := (Runner{Model: model, Tools: []Tool{tool}}).Run(context.Background(), RunOptions{Task: "inspect", InitialTools: []string{}})
	if err != nil {
		t.Fatal(err)
	}
	if len(model.requests[0].Tools) != 1 || model.requests[0].Tools[0].Name != "discover_tools" {
		t.Fatal(model.requests[0].Tools)
	}
	if !strings.Contains(model.requests[1].Messages[2].Content, "not available") {
		t.Fatal(model.requests[1])
	}
	if len(model.requests[2].Tools) != 2 || len(tool.arguments) == 0 {
		t.Fatal(model.requests[2])
	}
	catalog, _ := newToolCatalog([]ToolDefinition{{Name: "allowed", Description: "safe read"}}, nil)
	got, err := catalog.Execute(context.Background(), json.RawMessage(`{"query":"shell secrets"}`))
	if err != nil || strings.Contains(got.Content, "shell") {
		t.Fatal(got, err)
	}
	if _, err := newToolCatalog(nil, []string{"forbidden"}); err == nil {
		t.Fatal("host selection broadened")
	}
}
