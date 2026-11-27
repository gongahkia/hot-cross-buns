package workrun

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/tools"
)

func TestWorkHarnessDeferredDiscoveryAndPrivateCheckpoint(t *testing.T) {
	state := t.TempDir()
	model := &scriptedModel{turns: []agent.Turn{dynamicCall("discover_tools", map[string]any{"query": "inspect_table"}), {Text: "Ready to inspect a selected table."}}}
	out, err := (Service{Executor: Executor{DeferredTools: true, Model: model, StateDir: state}}).Execute(context.Background(), Request{RunID: "harness-discovery", SourcePath: t.TempDir(), Objective: "Find a tool to inspect tables", Mode: action.Inspect, Contract: artifact.InspectionContract(), ForegroundApp: true})
	if err != nil {
		t.Fatal(err)
	}
	contains := func(request agent.TurnRequest, name string) bool {
		for _, d := range request.Tools {
			if d.Name == name {
				return true
			}
		}
		return false
	}
	if len(model.requests) != 2 || contains(model.requests[0], "inspect_table") || !contains(model.requests[0], "discover_tools") || !contains(model.requests[1], "inspect_table") {
		t.Fatal("tool discovery did not update model surface", model.requests)
	}
	raw, err := os.ReadFile(agent.CheckpointPath(filepath.Join(state, "hot-cross-buns", "checkpoints"), out.Work.ID))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"state":"completed"`) || !strings.Contains(string(raw), `"budget"`) {
		t.Fatal(string(raw))
	}
}
func TestOnlyVettedFrozenSourceReadsCanRunTogether(t *testing.T) {
	read := frozenIndependentRead([]agent.Tool{tools.ReadFile{}, tools.ListFiles{}, tools.SearchFiles{}})
	for _, c := range []struct {
		name, path string
		want       bool
	}{{"read_file", "source/a.md", true}, {"search_files", "source", true}, {"list_files", "output", false}, {"read_file", "source/../output/private", false}, {"read_file", "/tmp/file", false}, {"filesystem", "source/file", false}, {"read_file", "source\\file", false}} {
		args, _ := json.Marshal(map[string]any{"path": c.path})
		if read(agent.ToolCall{Name: c.name, Arguments: args}) != c.want {
			t.Fatal(c)
		}
	}
}
