package mcp

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestConfigurationChangesRequireCurrentBundleAndStayInert(t *testing.T) {
	root := t.TempDir()
	server := ServerConfig{Name: "remote", Transport: "streamable_http", URL: "https://example.com/mcp"}
	cfg, e := SaveConfiguration(root, "", []ServerConfig{server})
	if e != nil || cfg.Hash == "" {
		t.Fatal(cfg, e)
	}
	if _, e = SaveConfiguration(root, "", []ServerConfig{server}); e == nil {
		t.Fatal("stale configuration overwritten")
	}
	set, e := Load(context.Background(), root, "")
	if e != nil || set.Trusted() {
		t.Fatal("setup trusted or connected server", e)
	}
	for _, url := range []string{"http://192.168.1.5/mcp", "https://user:pass@example.com/mcp", "https://example.com/mcp?key=secret"} {
		bad := server
		bad.URL = url
		if e = ValidateConfiguration(root, []ServerConfig{bad}); e == nil {
			t.Fatal("unsafe setup accepted", url)
		}
	}
	executable := filepath.Join(root, "server")
	if e = os.WriteFile(executable, []byte("#!/bin/sh\nexit 1\n"), 0700); e != nil {
		t.Fatal(e)
	}
	cfg, e = SaveConfiguration(root, cfg.Hash, []ServerConfig{{Name: "local", Transport: "stdio", Command: []string{"server"}}})
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(executable, []byte("#!/bin/sh\nexit 2\n"), 0700); e != nil {
		t.Fatal(e)
	}
	if _, e = SaveConfiguration(root, cfg.Hash, nil); e == nil {
		t.Fatal("executable changed during review")
	}
}
