package lifecycle

import (
	"context"
	"testing"
)

func TestCheckpointsAreDeviceLocalHistoryAndRemovedWithHistory(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "checkpoints/run.json", "private checkpoint")
	if backupContent("hot-cross-buns/checkpoints/run.json") || backupContent("hot-cross-buns/checkpoints/run.lock") {
		t.Fatal("device-bound checkpoint exported")
	}
	store, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := store.PreviewDelete(context.Background(), "history")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, file := range plan.Items {
		if file.Path == "checkpoints/run.json" {
			found = true
		}
	}
	if !found {
		t.Fatal("history cleanup omitted checkpoint", plan)
	}
}
