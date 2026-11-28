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
)

func TestInlineFilesystemReviewResumesOriginalTaskAndPersistsOnlyChosenScope(t *testing.T) {
	for _, choice := range []string{"once", "always", "full", "deny"} {
		t.Run(choice, func(t *testing.T) {
			state, source, folder := t.TempDir(), t.TempDir(), t.TempDir()
			path := filepath.Join(folder, "note")
			os.WriteFile(path, []byte("live fixture"), 0600)
			raw, _ := json.Marshal(map[string]string{"operation": "read", "path": path})
			model := &scriptedModel{turns: []agent.Turn{{ToolCalls: []agent.ToolCall{{ID: "live", Name: "filesystem", Arguments: raw}}}, {Text: "Inspected the live fixture."}}}
			if choice == "deny" {
				model.turns = append(model.turns, agent.Turn{Text: "File access was denied; no authorized recovery remains."})
			}
			operation := (Service{Executor: Executor{Model: model, StateDir: state}}).Start(context.Background(), Request{SourcePath: source, Objective: "Read this live file", Mode: action.Inspect, Contract: artifact.InspectionContract(), ForegroundApp: true, DisableDelegation: true, MaxSteps: 4})
			defer operation.Cancel()
			select {
			case review := <-operation.Interactions:
				if review.Kind != "file_access" {
					t.Fatal(review.Kind)
				}
				if operation.RespondPermission(review.ID, "untrusted") == nil {
					t.Fatal("unknown choice accepted")
				}
				if choice == "deny" {
					if err := operation.Respond(review.ID, false); err != nil {
						t.Fatal(err)
					}
				} else {
					if err := operation.RespondPermission(review.ID, choice); err != nil {
						t.Fatal(err)
					}
				}
				if operation.RespondPermission(review.ID, "full") == nil {
					t.Fatal("approval reused")
				}
			case <-time.After(5 * time.Second):
				t.Fatal("no inline permission request")
			}
			select {
			case done := <-operation.Done:
				if done.Err != nil {
					t.Fatal(done.Err)
				}
			case <-time.After(10 * time.Second):
				t.Fatal("original task did not resume")
			}
			content := model.requests[1].Messages[len(model.requests[1].Messages)-1].Content
			if choice != "deny" && !strings.Contains(content, "live fixture") {
				t.Fatal("original tool did not receive live file", content)
			}
			if choice == "deny" && strings.Contains(content, "live fixture") {
				t.Fatal("denied file content leaked")
			}
			store, _ := fileaccess.Open(state)
			policy, _ := store.Get()
			if policy.Full != (choice == "full") || len(policy.Grants) != map[string]int{"always": 1}[choice] {
				t.Fatal(policy)
			}
		})
	}
}
func TestBackgroundWorkHasNoLiveFilesystemTool(t *testing.T) {
	model := &scriptedModel{turns: []agent.Turn{{Text: "Read-only task."}}}
	_, err := (Executor{Model: model, StateDir: t.TempDir()}).Execute(context.Background(), Request{SourcePath: t.TempDir(), Objective: "Inspect", Mode: action.Inspect, Contract: artifact.InspectionContract(), DisableDelegation: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range model.requests[0].Tools {
		if tool.Name == "filesystem" {
			t.Fatal("background task inherited live files")
		}
	}
}
