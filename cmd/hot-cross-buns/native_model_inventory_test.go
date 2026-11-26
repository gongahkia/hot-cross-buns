package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/cliagent"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/modelcatalog"
)

func TestModelInventoryIsReadOnlyAndProjectsOnlyPublicAssignments(t *testing.T) {
	b := nativeProviderFixture(t)
	t.Setenv("OPENAI_API_KEY", nativeFixtureSecret)
	settings, err := b.settings.Load()
	if err != nil {
		t.Fatal(err)
	}
	settings.WorkRoles = []config.WorkRole{{Version: 1, Name: "source_researcher", Provider: "openai", Model: nativeFixtureSecret, MaxSteps: 6}}
	settings.ExternalAgents = []cliagent.Config{{Kind: "codex", Executable: "/usr/bin/true", AuthMode: "codex_login", CodexHome: "/private/cli/login", Model: "local-worker", TimeoutSeconds: 180}}
	if err := b.settings.Save(settings); err != nil {
		t.Fatal(err)
	}
	before, _ := b.settings.Load()
	b.review = &nativeProviderReview{}
	r := b.Apply(modelcatalog.NativeProviderAction{RequestID: "inventory-read", Action: "inventory"})
	if r.Error != "" || r.Inventory == nil || len(r.Inventory.Agents) != 8 {
		t.Fatal("inventory unavailable", r.Error)
	}
	if b.review == nil {
		t.Fatal("read cancelled an existing provider review")
	}
	row := r.Inventory.Agents[0]
	if row.Inherits || row.Model != "[redacted]" || row.MaxSteps != 6 {
		t.Fatal("role assignment was not safely projected", row)
	}
	seen := false
	for _, provider := range r.Inventory.Providers {
		if provider.ID == "gemini" {
			seen = len(provider.Models) > 0
		}
	}
	if !seen {
		t.Fatal("inventory hid the unconfigured Gemini provider")
	}
	cli := r.Inventory.Agents[7]
	if cli.Auth != "Local Codex ChatGPT login" || cli.Continuation != "Native session" || !cli.Steering || !cli.Questions {
		t.Fatal("CLI capabilities lost", cli)
	}
	raw, _ := json.Marshal(r)
	for _, private := range []string{nativeFixtureSecret, "/usr/bin/true", "/private/cli/login", "codex_home", "api_key_env", "runtime_roots"} {
		if strings.Contains(string(raw), private) {
			t.Fatal("private configuration leaked", private)
		}
	}
	after, _ := b.settings.Load()
	a, _ := json.Marshal(before)
	c, _ := json.Marshal(after)
	if string(a) != string(c) {
		t.Fatal("inventory changed settings")
	}
}
