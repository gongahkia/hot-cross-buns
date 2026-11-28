package workrun

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/fileaccess"
	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
)

func TestRoutineReusesNormalForegroundReviewWithoutGrantingAdditionalTools(t *testing.T) {
	state := t.TempDir()
	store, _ := knowledge.Open(state)
	_, err := store.AddSkillWithRoutine("brief", "Review a topic", "Read {{topic}} and report verified findings.", &knowledge.Routine{Parameters: []knowledge.RoutineParameter{{Name: "topic", Description: "Topic"}}, Sources: []string{"Approved notes"}, Effects: []string{"read"}, MaxRequests: 4, MaxTokens: 8000})
	if err != nil {
		t.Fatal(err)
	}
	model := &scriptedModel{turns: []agent.Turn{{ToolCalls: []agent.ToolCall{{ID: "routine", Name: "skill_prepare", Arguments: json.RawMessage(`{"name":"brief","parameters":{"topic":"Lantern"}}`)}}}, {Text: "The reviewed procedure is available within this task’s scope."}}}
	op := (Service{Executor: Executor{StateDir: state, Model: model}}).Start(context.Background(), Request{SourcePath: t.TempDir(), Objective: "Use the saved brief routine for Lantern", ForegroundApp: true, Mode: action.Inspect, Contract: artifact.InspectionContract(), MaxSteps: 5, DisableDelegation: true})
	defer op.Cancel()
	select {
	case review := <-op.Interactions:
		if review.Kind != "app_change" {
			t.Fatal(review.Kind)
		}
		preview, _ := json.Marshal(review.Preview)
		if !strings.Contains(string(preview), "Read Lantern") {
			t.Fatal(string(preview))
		}
		if err := op.Respond(review.ID, true); err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no routine review")
	}
	select {
	case done := <-op.Done:
		if done.Err != nil {
			t.Fatal(done.Err)
		}
		if done.Outcome.Manifest.Execution == nil || done.Outcome.Manifest.Execution.Limits.ModelRequests != 5 {
			t.Fatal("reviewed routine budget was not retained", done.Outcome.Manifest.Execution)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("reviewed task did not resume")
	}
	if len(model.requests) != 2 || !strings.Contains(model.requests[1].Messages[len(model.requests[1].Messages)-1].Content, "Read Lantern") {
		t.Fatal("approved procedure was not returned to the original task")
	}
	for _, tool := range model.requests[1].Tools {
		if tool.Name == "desktop_action" || tool.Name == "execute_action" {
			t.Fatal("routine granted an unrelated capability", tool.Name)
		}
	}
}

func TestReadOnlyRoutineCannotUseExistingFullFilesystemPermissionToWrite(t *testing.T) {
	state, folder := t.TempDir(), t.TempDir()
	store, _ := knowledge.Open(state)
	_, err := store.AddSkillWithRoutine("inspect", "Read approved notes", "Inspect notes and report findings.", &knowledge.Routine{Effects: []string{"read"}, MaxRequests: 8, MaxTokens: 8000})
	if err != nil {
		t.Fatal(err)
	}
	permissions, _ := fileaccess.Open(state)
	policy, _ := permissions.Get()
	if _, err = permissions.SetFull(policy.Revision, true); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(folder, "must-not-exist")
	write, _ := json.Marshal(map[string]string{"operation": "write", "path": path, "content": "unreviewed change", "expected_sha256": ""})
	model := &scriptedModel{turns: []agent.Turn{
		{ToolCalls: []agent.ToolCall{{ID: "routine", Name: "skill_prepare", Arguments: json.RawMessage(`{"name":"inspect","parameters":{}}`)}}},
		{ToolCalls: []agent.ToolCall{{ID: "write", Name: "filesystem", Arguments: write}}},
		{ToolCalls: []agent.ToolCall{{ID: "status", Name: "artifact_status", Arguments: json.RawMessage(`{}`)}}},
		{Text: "The proposed file change was outside the read-only routine and was not performed."},
		{Text: "The routine remains read-only; no authorized write is available."},
	}}
	_, err = (Executor{StateDir: state, Model: model}).Execute(context.Background(), Request{SourcePath: t.TempDir(), Objective: "Use the inspect routine", ForegroundApp: true, Mode: action.Draft, Contract: artifact.OptionalDraftContract(), MaxSteps: 6, DisableDelegation: true, ApproveAppChange: func(context.Context, any) (bool, error) { return true, nil }})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("routine widened filesystem effects", err)
	}
	if !strings.Contains(model.requests[2].Messages[len(model.requests[2].Messages)-1].Content, "outside the reviewed routine effects") {
		t.Fatal("routine scope was not the boundary rejecting the mutation")
	}
}
