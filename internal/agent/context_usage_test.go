package agent

import (
	"context"
	"strings"
	"testing"
)

func TestContextObserverMeasuresAdmittedFullRequestAndActualOutputReserve(t *testing.T) {
	p := ContextPolicy{Provider: "fixture", Model: "small", Window: 8192, OutputReserve: 1024}
	probe := &contextProbe{}
	model := WithContextPolicy(probe, p)
	var values []ContextUsage
	ctx := WithContextReporter(context.Background(), func(v ContextUsage) { values = append(values, v) })
	request := TurnRequest{System: "private system instructions", MaxOutputTokens: 512, Tools: []ToolDefinition{{Name: "read_file", Description: "Read a file"}}, Messages: []Message{{Role: RoleUser, Content: "private user text"}}}
	if _, err := model.Complete(ctx, request); err != nil {
		t.Fatal(err)
	}
	if len(values) != 1 || values[0].InputTokens != p.RequestTokens(probe.requests[0]) || values[0].InputLimit != 8192-512-512 || values[0].OutputReserve != 512 || values[0].Policy.Model != "small" {
		t.Fatal(values)
	}
	request.Messages[0].Content = strings.Repeat("x", 9000)
	if _, err := model.Complete(ctx, request); err == nil || len(values) != 1 {
		t.Fatal("rejected input was presented as an admitted request", len(values), err)
	}
}
