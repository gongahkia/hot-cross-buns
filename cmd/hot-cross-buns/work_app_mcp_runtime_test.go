package main

import (
	"context"
	"encoding/json"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/mcp"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"testing"
)

func TestForegroundMCPSessionRejectsTrustRevocationBeforeDispatch(t *testing.T) {
	c := appControllerForTest(t)
	repo := t.TempDir()
	exec.Command("git", "-C", repo, "init", "-q").Run()
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var call struct {
			ID     int    `json:"id"`
			Method string `json:"method"`
		}
		json.NewDecoder(r.Body).Decode(&call)
		w.Header().Set("Content-Type", "application/json")
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
			result = map[string]any{"tools": []any{map[string]any{"name": "list_bookings", "annotations": map[string]any{"readOnlyHint": true}, "inputSchema": map[string]any{"type": "object"}}}}
		case "tools/call":
			calls++
			result = map[string]any{"content": []any{map[string]string{"type": "text", "text": "live fixture"}}}
		}
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": call.ID, "result": result})
	}))
	defer server.Close()
	cfg, e := mcp.SaveConfiguration(repo, "", []mcp.ServerConfig{{Name: "sagasu", Transport: "streamable_http", URL: server.URL}})
	if e != nil {
		t.Fatal(e)
	}
	if _, _, e = c.OpenMCP(context.Background(), repo, "sagasu"); e == nil {
		t.Fatal("untrusted MCP session opened")
	}
	if e = c.settings.Update(func(s *config.Settings) error {
		s.MCPTrusts = setMCPTrust(s.MCPTrusts, mcp.Trust{Repository: repo, Hash: cfg.Hash})
		return nil
	}); e != nil {
		t.Fatal(e)
	}
	session, _, e := c.OpenMCP(context.Background(), repo, "sagasu")
	if e != nil {
		t.Fatal(e)
	}
	defer session.Close()
	if len(session.Tools()) != 1 || !json.Valid(session.Tools()[0].Annotations) {
		t.Fatal("MCP read annotation lost")
	}
	if _, e = session.Call(context.Background(), "list_bookings", json.RawMessage(`{}`)); e != nil || calls != 1 {
		t.Fatal(e, calls)
	}
	if e = c.settings.Update(func(s *config.Settings) error { s.MCPTrusts = removeMCPTrust(s.MCPTrusts, repo); return nil }); e != nil {
		t.Fatal(e)
	}
	if _, e = session.Call(context.Background(), "list_bookings", json.RawMessage(`{}`)); e == nil || calls != 1 {
		t.Fatal("revoked trust still dispatched", e, calls)
	}
}
