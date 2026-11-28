package main

import (
	"context"
	"encoding/json"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestChatWorkingFolderChangesPreserveSnapshotAndSupportMCP(t *testing.T) {
	c := appControllerForTest(t)
	root := t.TempDir()
	project := filepath.Join(root, "project")
	os.Mkdir(project, 0700)
	if e := exec.Command("git", "-C", project, "init", "-q").Run(); e != nil {
		t.Fatal(e)
	}
	c.request.ConversationID = "chat"
	c.request.SourcePath = root
	if e := c.settings.Update(func(s *config.Settings) error { s.FileNavigation.Root = root; return nil }); e != nil {
		t.Fatal(e)
	}
	b, _ := json.Marshal(map[string]string{"action": "focus", "path": project})
	p, e := c.Prepare(context.Background(), workrun.AppChange{ConversationID: "chat", Setting: "folder", Value: b})
	if e != nil || !p.Review || !p.AfterRun {
		t.Fatal(p, e)
	}
	before, _ := c.settings.Load()
	if before.FileNavigation.Folders["chat"] != "" {
		t.Fatal("prepare changed folder")
	}
	if _, e = p.Apply(context.Background()); e != nil {
		t.Fatal(e)
	}
	if c.request.SourcePath != root {
		t.Fatal("navigation retargeted captured task")
	}
	if got, e := c.mcpRepository(); e != nil || got != project {
		t.Fatal("MCP did not use saved working project", got, e)
	}
	if _, e = p.Apply(context.Background()); e == nil {
		t.Fatal("stale folder review accepted")
	}
}
