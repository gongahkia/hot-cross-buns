package main

import (
	"context"
	"encoding/json"
	"github.com/gongahkia/hot-cross-buns/internal/mcp"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestChatMCPConnectUsesOneReviewWithoutSwitchAndOnlyDiscoversTools(t *testing.T) {
	c := appControllerForTest(t)
	repo := t.TempDir()
	if e := exec.Command("git", "-C", repo, "init", "-q").Run(); e != nil {
		t.Fatal(e)
	}
	c.request.SourcePath = t.TempDir()
	calls, toolCalls := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		var call struct {
			ID     int    `json:"id"`
			Method string `json:"method"`
		}
		json.NewDecoder(r.Body).Decode(&call)
		var result any
		switch call.Method {
		case "server/discover":
			json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": call.ID, "error": map[string]any{"code": -32601}})
			return
		case "initialize":
			result = map[string]any{"protocolVersion": "2025-11-25", "capabilities": map[string]any{"tools": map[string]any{}}}
		case "notifications/initialized":
			w.WriteHeader(202)
			return
		case "tools/list":
			result = map[string]any{"tools": []any{map[string]any{"name": "server_status", "inputSchema": map[string]any{"type": "object"}}}}
		case "tools/call":
			toolCalls++
			t.Error("setup invoked a business tool")
		}
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": call.ID, "result": result})
	}))
	defer server.Close()
	value, _ := json.Marshal(map[string]any{"action": "connect", "repository": repo, "expected_digest": "", "server": map[string]any{"name": "example", "transport": "streamable_http", "url": server.URL}})
	p, e := c.Prepare(context.Background(), workrun.AppChange{Setting: "mcp_setup", Value: value})
	if e != nil || !p.Review || p.AfterRun || p.AfterReply || calls != 0 {
		t.Fatal(p, e, calls)
	}
	if _, e = os.Stat(filepath.Join(repo, ".hot-cross-buns/mcp.json")); !os.IsNotExist(e) {
		t.Fatal("prepare wrote config")
	}
	result, e := p.Apply(context.Background())
	if e != nil || result.(map[string]any)["verified"] != true || calls == 0 || toolCalls != 0 {
		t.Fatal(result, e, calls, toolCalls)
	}
	cfg, e := mcp.InspectConfiguration(repo)
	if e != nil {
		t.Fatal(e)
	}
	settings, _ := c.settings.Load()
	if mcpTrustFor(settings.MCPTrusts, repo) != cfg.Hash {
		t.Fatal("reviewed bundle was not trusted")
	}
	if _, e = p.Apply(context.Background()); e == nil {
		t.Fatal("stale setup replayed")
	}
}
func TestChatMCPConnectRejectsExecutableChangesDuringReview(t *testing.T) {
	c := appControllerForTest(t)
	repo := t.TempDir()
	exec.Command("git", "-C", repo, "init", "-q").Run()
	path := filepath.Join(repo, "server")
	os.WriteFile(path, []byte("#!/bin/sh\nexit 0\n"), 0700)
	value, _ := json.Marshal(map[string]any{"action": "connect", "repository": repo, "expected_digest": "", "server": map[string]any{"name": "local", "transport": "stdio", "command": []string{"server"}}})
	p, e := c.Prepare(context.Background(), workrun.AppChange{Setting: "mcp_setup", Value: value})
	if e != nil {
		t.Fatal(e)
	}
	os.WriteFile(path, []byte("#!/bin/sh\nexit 2\n"), 0700)
	if _, e = p.Apply(context.Background()); e == nil {
		t.Fatal("changed executable accepted")
	}
	if _, e = os.Stat(filepath.Join(repo, ".hot-cross-buns/mcp.json")); !os.IsNotExist(e) {
		t.Fatal("changed executable was registered")
	}
}
func TestChatMCPConnectReportsConcreteVerificationFailure(t *testing.T) {
	c := appControllerForTest(t)
	repo := t.TempDir()
	exec.Command("git", "-C", repo, "init", "-q").Run()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer server.Close()
	value, _ := json.Marshal(map[string]any{"action": "connect", "repository": repo, "expected_digest": "", "server": map[string]any{"name": "unavailable", "transport": "streamable_http", "url": server.URL}})
	p, e := c.Prepare(context.Background(), workrun.AppChange{Setting: "mcp_setup", Value: value})
	if e != nil {
		t.Fatal(e)
	}
	result, e := p.Apply(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	state := result.(map[string]any)
	if state["verified"] != false || state["status"] != "configured" || state["issue"] == "" {
		t.Fatal("startup failure claimed connection", state)
	}
}
