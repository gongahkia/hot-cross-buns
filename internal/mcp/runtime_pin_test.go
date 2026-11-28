package mcp

import (
	"context"
	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"os"
	"path/filepath"
	"testing"
)

func TestExplicitInterpreterPinInvalidatesTrustAndRejectsChangedRuntime(t *testing.T) {
	repo, external := t.TempDir(), t.TempDir()
	if e := os.MkdirAll(filepath.Join(repo, ".venv/bin"), 0700); e != nil {
		t.Fatal(e)
	}
	runtime := filepath.Join(external, "python")
	os.WriteFile(runtime, []byte("#!/bin/sh\nexit 0\n"), 0700)
	if e := os.Symlink(runtime, filepath.Join(repo, ".venv/bin/python")); e != nil {
		t.Skip(e)
	}
	s := ServerConfig{Name: "python", Transport: "stdio", Command: []string{".venv/bin/python", "-m", "example"}}
	if e := ValidateConfiguration(repo, []ServerConfig{s}); e == nil {
		t.Fatal("unreviewed external interpreter accepted")
	}
	pin, e := PinRuntime(repo, s)
	if e != nil || pin.RuntimePath != runtime || pin.RuntimeSHA256 == "" {
		t.Fatal(pin, e)
	}
	first, e := SaveConfiguration(repo, "", []ServerConfig{pin})
	if e != nil {
		t.Fatal(e)
	}
	os.WriteFile(runtime, []byte("#!/bin/sh\nexit 2\n"), 0700)
	second, e := InspectConfiguration(repo)
	if e != nil || first.Hash == second.Hash {
		t.Fatal("runtime change did not invalidate bundle", e)
	}
	set, e := Load(context.Background(), repo, first.Hash)
	if e != nil || set.Trusted() {
		t.Fatal("changed runtime retained trust", e)
	}
	if _, e = DiscoverConfigured(context.Background(), repo, second.Hash, pin.Name, auth.Store{}); e == nil {
		t.Fatal("old runtime pin allowed startup")
	}
}
