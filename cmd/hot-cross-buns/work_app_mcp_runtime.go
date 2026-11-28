package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/mcp"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

type foregroundMCPSession struct {
	owner    hotCrossBunsAppController
	session  *mcp.Session
	identity workrun.MCPIdentity
}

func (c hotCrossBunsAppController) OpenMCP(ctx context.Context, repository, server string) (workrun.MCPConnection, workrun.MCPIdentity, error) {
	root, e := c.mcpRepository(repository)
	if e != nil {
		return nil, workrun.MCPIdentity{}, e
	}
	settings, e := c.settings.Load()
	if e != nil {
		return nil, workrun.MCPIdentity{}, e
	}
	hash, e := mcp.BundleHash(root)
	if e != nil {
		return nil, workrun.MCPIdentity{}, e
	}
	if hash == "" || hash != mcpTrustFor(settings.MCPTrusts, root) {
		return nil, workrun.MCPIdentity{}, fmt.Errorf("%w: project is not trusted at its current exact bundle; inspect MCP setup", workrun.ErrMCPTrust)
	}
	credentials, e := auth.New(c.stateDir)
	if e != nil {
		return nil, workrun.MCPIdentity{}, e
	}
	session, e := mcp.OpenConfigured(ctx, root, hash, server, credentials)
	if e != nil {
		return nil, workrun.MCPIdentity{}, e
	}
	id := workrun.MCPIdentity{Repository: root, Hash: hash, Server: server}
	return &foregroundMCPSession{c, session, id}, id, nil
}
func (s *foregroundMCPSession) Tools() []mcp.RemoteTool { return s.session.Tools() }
func (s *foregroundMCPSession) Close() error            { return s.session.Close() }
func (s *foregroundMCPSession) Call(ctx context.Context, name string, args json.RawMessage) (json.RawMessage, error) {
	settings, e := s.owner.settings.Load()
	if e != nil {
		return nil, e
	}
	hash, e := mcp.BundleHash(s.identity.Repository)
	if e != nil {
		return nil, e
	}
	if hash != s.identity.Hash || mcpTrustFor(settings.MCPTrusts, s.identity.Repository) != hash {
		return nil, fmt.Errorf("%w: trust or executable changed while awaiting approval; discover it again", workrun.ErrMCPTrust)
	}
	return s.session.Call(ctx, name, args)
}
