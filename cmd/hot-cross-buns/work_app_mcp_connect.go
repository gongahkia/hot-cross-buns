package main

import (
	"context"
	"errors"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/mcp"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func (c hotCrossBunsAppController) prepareMCPConnect(change workrun.AppChange, repository string, prior mcp.Configuration, next []mcp.ServerConfig, server mcp.ServerConfig, priorTrust string) (workrun.AppMutation, error) {
	hash, e := mcp.ConfigurationHash(repository, next)
	if e != nil {
		return workrun.AppMutation{}, e
	}
	return workrun.AppMutation{Review: true, Summary: "MCP configuration saved. Check the tool result for connection verification.", Preview: map[string]any{"action": "Connect MCP server", "repository": repository, "server": server, "servers": next, "bundle_sha256": hash, "effect": "Save this exact configuration, trust the pinned executable/runtime, start this server and discover its tools. No MCP tool is invoked. Existing tool permissions and external-action approvals still apply. Installs and private sign-in are separate if needed."}, Apply: func(ctx context.Context) (any, error) {
		if e := ctx.Err(); e != nil {
			return nil, e
		}
		e := c.settings.Update(func(settings *config.Settings) error {
			if mcpTrustFor(settings.MCPTrusts, repository) != priorTrust {
				return errors.New("MCP trust changed during review; inspect again")
			}
			current, e := mcp.ConfigurationHash(repository, next)
			if e != nil {
				return e
			}
			if current != hash {
				return errors.New("MCP executable changed during review; prepare setup again")
			}
			saved, e := mcp.SaveConfiguration(repository, prior.Hash, next)
			if e != nil {
				return e
			}
			if saved.Hash != hash {
				return errors.New("saved MCP bundle differs from the reviewed bundle; trust was not granted")
			}
			settings.MCPTrusts = setMCPTrust(settings.MCPTrusts, mcp.Trust{Repository: repository, Hash: hash})
			return nil
		})
		if e != nil {
			return nil, e
		}
		credentials, e := auth.New(c.stateDir)
		if e != nil {
			return nil, e
		}
		probe, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		tools, e := mcp.DiscoverConfigured(probe, repository, hash, server.Name, credentials)
		if e != nil {
			return map[string]any{"status": "configured", "verified": false, "repository": repository, "server": server.Name, "issue": e.Error(), "next_step": "Configuration and trust are saved. Diagnose this concrete startup/authorization failure; do not claim the connection works or invoke tools."}, nil
		}
		return map[string]any{"status": "connected", "verified": true, "repository": repository, "server": server.Name, "tools": tools, "note": "Tool discovery succeeded; no tool was invoked. Use hot_cross_buns_mcp discover/call directly in foreground chat. Each tool call retains review and task-mode checks."}, nil
	}}, nil
}
