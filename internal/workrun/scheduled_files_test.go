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
	"github.com/gongahkia/hot-cross-buns/internal/fileaccess"
)

func TestScheduledTaskReadsOnlyItsReviewedLiveFolder(t *testing.T) {
	state, folder := t.TempDir(), t.TempDir()
	store, _ := fileaccess.Open(state)
	policy, _ := store.Get()
	root, identity, _ := fileaccess.Folder(folder)
	digest := strings.Repeat("a", 64)
	if _, err := store.AddScheduled(policy.Revision, root, identity, "job-fixture", digest); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(folder, "note")
	os.WriteFile(path, []byte("approved live notes"), 0600)
	raw, _ := json.Marshal(map[string]string{"operation": "read", "path": path})
	model := &scriptedModel{turns: []agent.Turn{{ToolCalls: []agent.ToolCall{{ID: "read", Name: "filesystem", Arguments: raw}}}, {Text: "Inspected the approved notes."}}}
	_, err := (Executor{Model: model, StateDir: state}).Execute(context.Background(), Request{SourcePath: t.TempDir(), Objective: "Read scheduled notes", ScheduledJobID: "job-fixture", ScheduledJobPolicy: digest, CheckScheduledFiles: func() error { return nil }, Mode: action.Inspect, Contract: artifact.InspectionContract(), DisableDelegation: true, MaxSteps: 4})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(model.requests[1].Messages[len(model.requests[1].Messages)-1].Content, "approved live notes") {
		t.Fatal("scheduled grant did not reach the ordinary filesystem tool")
	}
}
