package workrun

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/cliagent"
	"github.com/gongahkia/hot-cross-buns/internal/fileaccess"
	"github.com/gongahkia/hot-cross-buns/internal/orchestrator"
	"github.com/gongahkia/hot-cross-buns/internal/sandbox"
	"github.com/gongahkia/hot-cross-buns/internal/workspace"
)

func TestDelegatedCLIUsesLiveGrantAndStopsAfterRevocation(t *testing.T) {
	if _, err := sandbox.StrictAvailability(); err != nil {
		t.Skip(err)
	}
	t.Setenv("FIXTURE_API_KEY", "synthetic-worker-key")
	canonical := func(path string) string {
		p, err := filepath.EvalSymlinks(path)
		if err != nil {
			t.Fatal(err)
		}
		return p
	}
	state, source, folder, executables := canonical(t.TempDir()), canonical(t.TempDir()), canonical(t.TempDir()), canonical(t.TempDir())
	store, _ := fileaccess.Open(state)
	files, _ := fileaccess.NewTask(store, false, func(context.Context, fileaccess.Review) (string, error) { return "always", nil })
	if _, err := files.Access(context.Background(), folder, "write", "request_access", "fixture worker"); err != nil {
		t.Fatal(err)
	}
	worker := filepath.Join(executables, "worker")
	script := "#!/bin/sh\nset -eu\ncat >/dev/null\nprintf granted > '" + filepath.Join(folder, "started") + "'\nsleep 10\nprintf unexpected > '" + filepath.Join(folder, "after-cancel") + "'\nprintf '%s\\n' '{\"type\":\"text\",\"part\":{\"text\":\"done\"}}' '{\"type\":\"step_finish\",\"part\":{\"reason\":\"stop\"}}'\n"
	if err := os.WriteFile(worker, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	work, err := workspace.CreateWork(source, state, "live-delegate", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	request := Request{StateDir: state, Mode: action.Draft, files: files}
	specialist := (Executor{}).externalCLISpecialist(request, work, cliagent.Config{Kind: "opencode", Executable: worker, ReadOnlyRoots: []string{executables}, APIKeyEnv: "FIXTURE_API_KEY", TimeoutSeconds: 30})
	done := make(chan error, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_, err := specialist.Run(ctx, orchestrator.Invocation{ID: "live-delegate", Task: "Use the approved live folder"})
		done <- err
	}()
	until := time.Now().Add(5 * time.Second)
	for time.Now().Before(until) {
		if _, err := os.Stat(filepath.Join(folder, "started")); err == nil {
			break
		}
		select {
		case err := <-done:
			t.Fatal("worker stopped before live access", err)
		case <-time.After(25 * time.Millisecond):
		}
	}
	if _, err := os.Stat(filepath.Join(folder, "started")); err != nil {
		t.Fatal("worker did not use live grant", err)
	}
	policy, _ := store.Get()
	if _, err := store.RevokeAll(policy.Revision); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("revoked worker reported success")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("revoked worker did not stop")
	}
	if _, err := os.Stat(filepath.Join(folder, "after-cancel")); !os.IsNotExist(err) {
		t.Fatal("worker continued after cancellation", err)
	}
}
