package workrun

import (
	"context"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/orchestrator"
)

func TestMixedModelDependencyPipelineRetainsDisagreementAndProducesArtifact(t *testing.T) {
	source := dynamicSource(t, "Source A says Friday; source B says Monday. Neither has a later verified timestamp.")
	reader := &scriptedModel{turns: []agent.Turn{dynamicCall("read_file", map[string]any{"path": "source/facts.md"}), {Text: "SOURCE_A: deadline Friday; timestamp unverified."}}}
	verifier := &scriptedModel{turns: []agent.Turn{{Text: "SOURCE_B: deadline Monday; timestamp unverified."}}}
	reviewer := &scriptedModel{turns: []agent.Turn{{Text: "Conflict remains unresolved: Friday versus Monday. Ask the source owner before choosing."}}}
	start := func(role, task string) agent.ToolCall {
		return dynamicCall("start_agent", map[string]any{"agent": role, "task": task, "continue": ""}).ToolCalls[0]
	}
	manager := &scriptedModel{turns: []agent.Turn{
		{ToolCalls: []agent.ToolCall{start("source_researcher", "Read source A in facts.md"), start("claim_verifier", "Verify source B and its timestamp")}},
		dynamicCall("start_agent", map[string]any{"agent": "artifact_reviewer", "task": "Reconcile the evidence without inventing a resolution", "continue": "", "dependencies": []string{"subagent-001", "subagent-002"}}),
		dynamicCall("await_agent", map[string]any{"id": "subagent-003", "timeout_seconds": 5}),
		dynamicCall("write_artifact", map[string]any{"path": "report.md", "content": "# Deadline review\nSources disagree: Friday versus Monday. Ask the source owner before choosing."}),
		{Text: "The staged report preserves the unresolved disagreement."},
	}}
	outcome, err := (Executor{Model: manager, StateDir: t.TempDir(), RoleModels: map[string]agent.Model{"source_researcher": reader, "claim_verifier": verifier, "artifact_reviewer": reviewer}, RoleConfiguration: map[string]orchestrator.RoleConfiguration{"source_researcher": {Version: 1, Provider: "fixture/reader"}, "claim_verifier": {Version: 1, Provider: "fixture/verifier"}, "artifact_reviewer": {Version: 1, Provider: "fixture/reviewer"}}}).Execute(context.Background(), Request{SourcePath: source, Objective: "Compare the sources with independent models, reconcile their evidence and prepare report.md", Mode: action.Draft, Contract: artifact.DefaultContract("report.md"), MaxSteps: 6, DisableBrowser: true, Limits: agent.Limits{ModelRequests: 12}})
	if err != nil {
		t.Fatal(err)
	}
	if len(outcome.Manifest.Subagents) != 3 || len(outcome.Manifest.Artifacts) != 1 {
		t.Fatalf("pipeline evidence incomplete: %#v", outcome.Manifest.Subagents)
	}
	if len(reader.requests) != 2 || len(verifier.requests) != 1 || len(reviewer.requests) != 1 {
		t.Fatal("role models were not independently invoked")
	}
	selected := reviewer.requests[0].Messages[0].Content
	if !strings.Contains(selected, "SOURCE_A") || !strings.Contains(selected, "SOURCE_B") || !strings.Contains(selected, "untrusted reference data") {
		t.Fatalf("dependency evidence absent or trusted as instructions: %s", selected)
	}
	for _, subagent := range outcome.Manifest.Subagents {
		if subagent.Status != "completed" {
			t.Fatalf("unfinished role: %#v", subagent)
		}
	}
}
