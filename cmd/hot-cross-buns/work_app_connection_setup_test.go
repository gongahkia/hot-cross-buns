package main

import (
	"context"
	"encoding/json"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/connector"
	"github.com/gongahkia/hot-cross-buns/internal/mcp"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestChatConnectionSetupReviewsPublicDetailsAndRejectsDuplicateOrSecrets(t *testing.T) {
	root, _, credentials := nativeConnectionFixture(t, "https://example.com")
	store, _ := config.DefaultStore()
	c := hotCrossBunsAppController{stateDir: root, settings: store, request: &workrun.Request{}}
	value := []byte(`{"descriptor":{"id":"todoist","name":"Tasks","kind":"todoist","resource":"https://api.todoist.com/api/v1","authentication":"bearer"}}`)
	change := workrun.AppChange{Setting: "connection_setup", Value: value}
	p, e := c.Prepare(context.Background(), change)
	if e != nil || !p.Review || !p.AfterRun {
		t.Fatal(p, e)
	}
	before, _ := store.Load()
	if len(before.Connectors) != 1 {
		t.Fatal("prepare changed configuration")
	}
	if _, e = p.Apply(context.Background()); e != nil {
		t.Fatal(e)
	}
	d, _, e := configuredConnector("todoist")
	if e != nil || d.Kind != connector.KindTodoist {
		t.Fatal(d, e)
	}
	if _, found, e := credentials.Read(d.CredentialRef()); e != nil || found {
		t.Fatal("setup saved credentials", e)
	}
	if _, e = p.Apply(context.Background()); e == nil {
		t.Fatal("duplicate setup accepted")
	}
	bad := []byte(`{"descriptor":{"id":"other","name":"Tasks","kind":"todoist","resource":"https://api.todoist.com/api/v1","authentication":"bearer","token":"secret"}}`)
	if _, e = c.Prepare(context.Background(), workrun.AppChange{Setting: "connection_setup", Value: bad}); e == nil {
		t.Fatal("chat secret field accepted")
	}
}
func TestChatMCPSetupSeparatesConfigurationFromTrust(t *testing.T) {
	c := appControllerForTest(t)
	repo := t.TempDir()
	if out, e := exec.Command("git", "-C", repo, "init", "-q").CombinedOutput(); e != nil {
		t.Fatal(string(out), e)
	}
	c.request.SourcePath = repo
	if e := os.WriteFile(filepath.Join(repo, "server"), []byte("#!/bin/sh\nexit 1\n"), 0700); e != nil {
		t.Fatal(e)
	}
	prepare := func(v any) workrun.AppMutation {
		t.Helper()
		b, _ := json.Marshal(v)
		p, e := c.Prepare(context.Background(), workrun.AppChange{Setting: "mcp_setup", Value: b})
		if e != nil || !p.Review || !p.AfterRun {
			t.Fatal(p, e)
		}
		return p
	}
	p := prepare(map[string]any{"action": "set", "expected_digest": "", "server": map[string]any{"name": "local", "transport": "stdio", "command": []string{"server"}}})
	if _, e := os.Stat(filepath.Join(repo, ".hot-cross-buns/mcp.json")); !os.IsNotExist(e) {
		t.Fatal("prepare wrote manifest")
	}
	if _, e := p.Apply(context.Background()); e != nil {
		t.Fatal(e)
	}
	cfg, e := mcp.InspectConfiguration(repo)
	if e != nil {
		t.Fatal(e)
	}
	settings, _ := c.settings.Load()
	if mcpTrustFor(settings.MCPTrusts, repo) != "" {
		t.Fatal("configuration granted trust")
	}
	trust := prepare(map[string]any{"action": "trust", "expected_digest": cfg.Hash})
	if _, e = trust.Apply(context.Background()); e != nil {
		t.Fatal(e)
	}
	settings, _ = c.settings.Load()
	if mcpTrustFor(settings.MCPTrusts, repo) != cfg.Hash {
		t.Fatal("reviewed trust not saved")
	}
	if e = os.WriteFile(filepath.Join(repo, "server"), []byte("changed"), 0700); e != nil {
		t.Fatal(e)
	}
	if _, e = trust.Apply(context.Background()); e == nil {
		t.Fatal("trust ignored changed executable")
	}
}
