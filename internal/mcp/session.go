package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/workspace"
)

// Session owns one connected server for a foreground run. Call Close after the
// run, so stateful tools can be polled without restarting their stdio process.
type Session struct {
	client client
	tools  []RemoteTool
}

func OpenConfigured(ctx context.Context, repository, hash, name string, credentials auth.Store) (*Session, error) {
	root, e := workspace.Open(repository)
	if e != nil {
		return nil, e
	}
	doc, current, e := loadManifest(root)
	if e != nil {
		return nil, e
	}
	if hash == "" || hash != current {
		return nil, errors.New("MCP bundle is not the exact trusted configuration")
	}
	for _, s := range doc.Servers {
		if s.Name == name {
			client, e := connect(ctx, root, s, credentials)
			if e != nil {
				return nil, e
			}
			tools, e := listTools(ctx, client)
			if e != nil {
				client.Close()
				return nil, e
			}
			return &Session{client: client, tools: tools}, nil
		}
	}
	return nil, errors.New("MCP server is not configured")
}
func (s *Session) Tools() []RemoteTool { return append([]RemoteTool(nil), s.tools...) }
func (s *Session) Close() error        { return s.client.Close() }

// Call assumes the host already reviewed the exact call. It never retries.
func (s *Session) Call(ctx context.Context, name string, args json.RawMessage) (json.RawMessage, error) {
	if !objectJSON(args) {
		return nil, errors.New("MCP arguments must be a JSON object")
	}
	found := false
	for _, tool := range s.tools {
		found = found || tool.Name == name
	}
	if !found {
		return nil, errors.New("tool is not exposed by this MCP session")
	}
	raw, e := s.client.Call(ctx, "tools/call", map[string]any{"name": name, "arguments": args})
	if e != nil {
		return nil, e
	}
	if e = validateToolResult(raw); e != nil {
		return nil, e
	}
	var envelope struct {
		IsError bool `json:"isError"`
	}
	json.Unmarshal(raw, &envelope)
	if envelope.IsError {
		return nil, fmt.Errorf("MCP tool %q reported an error; inspect its setup before retrying", name)
	}
	return raw, nil
}
