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
)

func TestForegroundWorkReconsidersFailureBeforeGivingUp(t *testing.T) {
	for _, delegate := range []bool{false, true} {
		t.Run(map[bool]string{false: "tool", true: "specialist"}[delegate], func(t *testing.T) {
			source := t.TempDir()
			if err := os.WriteFile(filepath.Join(source, "note.md"), []byte("Verified source evidence."), 0600); err != nil {
				t.Fatal(err)
			}
			failed := agent.ToolCall{ID: "failed", Name: "read_file", Arguments: json.RawMessage(`{"path":"source/missing.md"}`)}
			if delegate {
				failed.Name = "delegate_agents"
				failed.Arguments = json.RawMessage(`{"tasks":[{"agent":"source_researcher","task":"Inspect the note."}]}`)
			}
			manager := &scriptedModel{turns: []agent.Turn{
				{ToolCalls: []agent.ToolCall{failed}},
				{Text: "It failed; ask me to retry."},
				{ToolCalls: []agent.ToolCall{{ID: "recover", Name: "read_file", Arguments: json.RawMessage(`{"path":"source/note.md"}`)}}},
				{Text: "Read and verified the source."},
			}}
			child := &scriptedModel{}
			out, err := (Executor{Model: manager, RoleModels: map[string]agent.Model{"source_researcher": child}, StateDir: t.TempDir()}).Execute(context.Background(), Request{
				SourcePath: source, Objective: "Inspect the note", Mode: action.Inspect, Contract: artifact.InspectionContract(),
				ForegroundApp: true, MaxSteps: 5, DisableBrowser: true,
			})
			if err != nil {
				t.Fatal(err)
			}
			if out.Result.FinalText != "Read and verified the source." || len(manager.requests) != 4 {
				t.Fatal("premature failure was accepted", out.Result)
			}
			found := false
			for _, message := range manager.requests[2].Messages {
				found = found || strings.Contains(message.Content, "useful authorized recovery step")
			}
			if !found || !containsEvent(out.Events, agent.EventCompletionBlocked) {
				t.Fatal("manager did not receive recovery guidance")
			}
			if delegate && len(child.requests) != 1 {
				t.Fatal("failed specialist was replayed automatically")
			}
		})
	}
}

func TestFailureRecoveryRemainsBoundedAndPreservesVerification(t *testing.T) {
	var recovery failureRecovery
	if err := recovery.check(); err != nil {
		t.Fatal("successful work required recovery", err)
	}
	recovery.record()
	manager := &scriptedModel{turns: []agent.Turn{{Text: "Credentials are missing."}, {Text: "Credentials are missing; no permitted recovery remains."}}}
	out, err := (agent.Runner{Model: manager}).Run(context.Background(), agent.RunOptions{
		Task: "Use the explicitly requested provider", MaxSteps: 3, CompletionCheck: recovery.completion(nil),
	})
	if err != nil || out.Steps != 2 {
		t.Fatal("genuine blocker could not finish after recovery assessment", out, err)
	}
	recovery.record()
	if err := recovery.check(); err != nil {
		t.Fatal("recovery pass repeated", err)
	}
	verification := recovery.completion(func([]agent.Message) error { return context.Canceled })
	if err := verification(nil); err != context.Canceled {
		t.Fatal("recovery weakened completion verification", err)
	}
	var limited failureRecovery
	limited.record()
	_, err = (agent.Runner{Model: &scriptedModel{turns: []agent.Turn{{Text: "Blocked."}}}}).Run(context.Background(), agent.RunOptions{
		Task: "Bounded work", MaxSteps: 1, CompletionCheck: limited.completion(nil),
	})
	if err == nil || !strings.Contains(err.Error(), "step limit") {
		t.Fatal("recovery expanded the step budget", err)
	}
}
