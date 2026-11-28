package connector

import (
	"context"
	"encoding/json"
	"github.com/gongahkia/hot-cross-buns/internal/action"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMCPStatusDiscoversSchemasWithoutCallingMappedTools(t *testing.T) {
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
			result = map[string]any{"tools": []any{map[string]any{"name": "lookup", "inputSchema": map[string]any{"type": "object", "required": []string{"id"}, "properties": map[string]any{"id": map[string]string{"type": "string"}}}}}}
		case "tools/call":
			calls++
			t.Error("access check invoked a tool requiring arguments")
		}
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": call.ID, "result": result})
	}))
	defer server.Close()
	d := Descriptor{Version: 1, ID: "remote", Name: "Remote", Kind: KindRemoteMCP, Resource: server.URL, Authentication: AuthNone, ReadTool: "lookup"}
	registry, e := NewRegistry([]Descriptor{d})
	if e != nil {
		t.Fatal(e)
	}
	runtime := Runtime{Registry: registry}
	result, e := runtime.Invoke(context.Background(), action.Inspect, d.ID, "status", []byte(`{}`))
	if e != nil || calls != 0 || len(result.Data) == 0 {
		t.Fatal(e, calls, string(result.Data))
	}
	d.ReadTool = "missing"
	runtime.Registry, _ = NewRegistry([]Descriptor{d})
	if _, e = runtime.Invoke(context.Background(), action.Inspect, d.ID, "status", []byte(`{}`)); e == nil {
		t.Fatal("missing mapping verified")
	}
}
