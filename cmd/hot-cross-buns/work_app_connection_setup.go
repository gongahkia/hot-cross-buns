package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"slices"

	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/connector"
	"github.com/gongahkia/hot-cross-buns/internal/filenav"
	"github.com/gongahkia/hot-cross-buns/internal/mcp"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func connectionSetupChoices() []map[string]any {
	choices := []map[string]any{}
	for _, p := range connectionPresets {
		choices = append(choices, map[string]any{"kind": p.kind, "name": p.name, "resource": p.resource, "setup": p.description, "docs": p.docs})
	}
	return choices
}
func (c hotCrossBunsAppController) prepareConnectionSetup(change workrun.AppChange) (workrun.AppMutation, error) {
	var v struct {
		Descriptor connector.Descriptor `json:"descriptor"`
	}
	if e := workrun.DecodeAppArguments(change.Value, &v); e != nil {
		return workrun.AppMutation{}, e
	}
	d := v.Descriptor
	if d.Version == 0 {
		d.Version = connector.DescriptorVersion
	}
	allowed := false
	for _, p := range connectionPresets {
		allowed = allowed || p.kind == d.Kind
	}
	if !allowed {
		return workrun.AppMutation{}, errors.New("inspect connections for supported setup kinds")
	}
	if e := d.Validate(); e != nil {
		return workrun.AppMutation{}, e
	}
	u, _ := url.Parse(d.Resource)
	if u.RawQuery != "" || u.Fragment != "" {
		return workrun.AppMutation{}, errors.New("chat setup requires a credential-free endpoint without query or fragment; enter credentials only in Connections")
	}
	prior, e := c.settings.Load()
	if e != nil {
		return workrun.AppMutation{}, e
	}
	for _, saved := range prior.Connectors {
		if saved.ID == d.ID {
			return workrun.AppMutation{}, errors.New("that connection ID already exists; choose a new ID or manage the existing account in Connections")
		}
	}
	return workrun.AppMutation{Review: true, AfterRun: true, Summary: "Connection configuration saved. Complete private authentication and select it for your chat.", Preview: map[string]any{"connection": d, "effect": "Adds public configuration only after this response. Enter tokens or sign in privately in Connections. Does not grant account permissions, run server tools, install software, or select the connection for this task."}, Apply: func(ctx context.Context) (any, error) {
		if e := ctx.Err(); e != nil {
			return nil, e
		}
		e := c.settings.Update(func(settings *config.Settings) error {
			for _, saved := range settings.Connectors {
				if saved.ID == d.ID {
					return errors.New("connection ID was added while awaiting review; inspect again")
				}
			}
			settings.Connectors = append(settings.Connectors, d)
			return nil
		})
		if e != nil {
			return nil, e
		}
		screen, e := (&connectionControls{stateDir: c.stateDir}).screen(d.ID)
		return appScreenResult{Family: "connections", Screen: screen}, e
	}}, nil
}
func (c hotCrossBunsAppController) mcpRepository(paths ...string) (string, error) {
	if len(paths) > 0 && paths[0] != "" {
		path, e := filenav.Canonical(paths[0])
		if e != nil {
			return "", e
		}
		root, e := gitRepositoryRoot(path)
		if e != nil {
			return "", e
		}
		return mcp.CanonicalRepository(root)
	}
	if c.request == nil || c.request.SourcePath == "" {
		return "", errors.New("select a local Git project in this chat before configuring local MCP servers; remote account connections do not need a project")
	}
	settings, e := c.settings.Load()
	if e != nil {
		return "", e
	}
	id := c.request.ConversationID
	if c.request.OriginConversationID != "" {
		id = c.request.OriginConversationID
	}
	working := settings.FileNavigation.Folders[id]
	if working == "" {
		working = c.request.SourcePath
	}
	root, e := gitRepositoryRoot(working)
	if e != nil {
		return "", errors.New("local MCP setup needs a working Git project; inspect folders and prepare a folder focus change in chat")
	}
	return mcp.CanonicalRepository(root)
}
func (c hotCrossBunsAppController) inspectMCP(paths ...string) (any, error) {
	repository, e := c.mcpRepository(paths...)
	if e != nil {
		return map[string]any{"configured": false, "project_required": true, "note": e.Error(), "remote_setup": "Use connection_setup with kind remote_mcp for an outbound Streamable HTTP connection independent of a repository. Inspect connections for the exact descriptor fields."}, nil
	}
	cfg, e := mcp.InspectConfiguration(repository)
	if e != nil {
		return nil, e
	}
	settings, e := c.settings.Load()
	if e != nil {
		return nil, e
	}
	return map[string]any{"repository": repository, "configuration": cfg, "trusted": cfg.Hash != "" && mcpTrustFor(settings.MCPTrusts, repository) == cfg.Hash, "note": "Inspection starts no processes and contacts no servers. Invoke trusted tools using hot_cross_buns_mcp discover/call in this chat; coding-agent execution is not required for ordinary reads. For requested setup, use mcp_setup action connect to save, trust and verify the exact server with one review in this chat. Supply repository directly; no /source switch or continue message is needed. Local commands must be existing repository-relative executables; install/build separately with explicit user authorization. HTTPS remote MCP is supported outbound from a Pi. Tokens and sign-in stay in private Connections controls."}, nil
}
func (c hotCrossBunsAppController) prepareMCPSetup(change workrun.AppChange) (workrun.AppMutation, error) {
	var v struct {
		Action     string            `json:"action"`
		Expected   string            `json:"expected_digest"`
		Server     *mcp.ServerConfig `json:"server,omitempty"`
		Name       string            `json:"name,omitempty"`
		Repository string            `json:"repository,omitempty"`
	}
	if e := workrun.DecodeAppArguments(change.Value, &v); e != nil {
		return workrun.AppMutation{}, e
	}
	if !slices.Contains([]string{"connect", "set", "remove", "trust", "untrust"}, v.Action) {
		return workrun.AppMutation{}, errors.New("MCP setup action must be connect, set, remove, trust or untrust")
	}
	repository, e := c.mcpRepository(v.Repository)
	if e != nil {
		return workrun.AppMutation{}, e
	}
	cfg, e := mcp.InspectConfiguration(repository)
	if e != nil {
		return workrun.AppMutation{}, e
	}
	if cfg.Hash != v.Expected {
		return workrun.AppMutation{}, errors.New("MCP bundle changed; inspect mcp again")
	}
	settings, e := c.settings.Load()
	if e != nil {
		return workrun.AppMutation{}, e
	}
	priorTrust := mcpTrustFor(settings.MCPTrusts, repository)
	next := append([]mcp.ServerConfig{}, cfg.Servers...)
	switch v.Action {
	case "connect", "set":
		if v.Server == nil || v.Name != "" {
			return workrun.AppMutation{}, errors.New("set needs a server object only")
		}
		if v.Action == "connect" {
			pinned, e := mcp.PinRuntime(repository, *v.Server)
			if e != nil {
				return workrun.AppMutation{}, e
			}
			v.Server = &pinned
		}
		found := false
		for i, s := range next {
			if s.Name == v.Server.Name {
				next[i] = *v.Server
				found = true
			}
		}
		if !found {
			next = append(next, *v.Server)
		}
		if e = mcp.ValidateConfiguration(repository, next); e != nil {
			return workrun.AppMutation{}, e
		}
	case "remove":
		if v.Name == "" || v.Server != nil {
			return workrun.AppMutation{}, errors.New("remove needs only a server name")
		}
		found := false
		next = slices.DeleteFunc(next, func(s mcp.ServerConfig) bool {
			if s.Name == v.Name {
				found = true
				return true
			}
			return false
		})
		if !found {
			return workrun.AppMutation{}, errors.New("MCP server not found")
		}
	case "trust", "untrust":
		if v.Server != nil || v.Name != "" || cfg.Hash == "" {
			return workrun.AppMutation{}, errors.New("trust/untrust needs an existing inspected bundle and no server/name")
		}
	}
	if v.Action == "connect" {
		return c.prepareMCPConnect(change, repository, cfg, next, *v.Server, priorTrust)
	}
	effect := "Saves project MCP configuration after this response; does not install, start or trust a server. Inspect the new hash before a separate trust review."
	if v.Action == "trust" {
		effect = "Trusts this exact configuration and executable bytes for future code work. A later run can start these executables or connect to these endpoints. Each tool call still needs approval."
	}
	if v.Action == "untrust" {
		effect = "Removes trust for future runs; existing running calls are unchanged."
	}
	return workrun.AppMutation{Review: true, AfterRun: true, Summary: "MCP setup change completed: " + v.Action + ".", Preview: map[string]any{"action": v.Action, "repository": repository, "expected_digest": cfg.Hash, "servers": next, "effect": effect}, Apply: func(ctx context.Context) (any, error) {
		if e := ctx.Err(); e != nil {
			return nil, e
		}
		current, e := mcp.InspectConfiguration(repository)
		if e != nil {
			return nil, e
		}
		if current.Hash != v.Expected {
			return nil, errors.New("MCP configuration or executable changed during review; inspect again")
		}
		if v.Action == "set" || v.Action == "remove" {
			return mcp.SaveConfiguration(repository, v.Expected, next)
		}
		e = c.settings.Update(func(settings *config.Settings) error {
			if mcpTrustFor(settings.MCPTrusts, repository) != priorTrust {
				return errors.New("MCP trust changed during review; inspect again")
			}
			hash, e := mcp.BundleHash(repository)
			if e != nil {
				return e
			}
			if hash != v.Expected {
				return errors.New("MCP bundle changed during review")
			}
			if v.Action == "trust" {
				settings.MCPTrusts = setMCPTrust(settings.MCPTrusts, mcp.Trust{Repository: repository, Hash: hash})
			} else {
				settings.MCPTrusts = removeMCPTrust(settings.MCPTrusts, repository)
			}
			return nil
		})
		return map[string]any{"action": v.Action, "expected_digest": v.Expected, "trusted": v.Action == "trust", "note": fmt.Sprintf("Applies to future code work in %s", repository)}, e
	}}, nil
}
