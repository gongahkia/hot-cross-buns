package main

import (
	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/modelcatalog"
)

func (b *nativeProviderBackend) modelInventory() (*modelcatalog.NativeModelInventory, error) {
	settings, err := b.settings.Load()
	if err != nil {
		return nil, err
	}
	credentials, err := auth.New(b.stateDir)
	if err != nil {
		return nil, err
	}
	redact, err := providerRedactor(credentials)
	if err != nil {
		return nil, err
	}
	result := &modelcatalog.NativeModelInventory{Agents: []modelcatalog.NativeAgentModel{}}
	result.Providers, err = b.rows()
	if err != nil {
		return nil, err
	}
	for _, name := range []string{"source_researcher", "artifact_reviewer", "connected_researcher", "spreadsheet_analyst", "claim_verifier", "goal_reviewer", "code"} {
		row := modelcatalog.NativeAgentModel{Name: name, Kind: "native", Inherits: true, Continuation: "Retained result", Steering: name != "code"}
		for _, role := range settings.WorkRoles {
			if role.Name == name {
				row.Provider, row.Model, row.MaxSteps = redact(role.Provider), redact(role.Model), role.MaxSteps
				row.Inherits = role.Provider == ""
			}
		}
		result.Agents = append(result.Agents, row)
	}
	for _, cfg := range settings.ExternalAgents {
		row := modelcatalog.NativeAgentModel{Name: cfg.Kind, Kind: "cli", Provider: redact(cfg.Provider), Model: redact(cfg.Model), Auth: "Separate API credential", Continuation: "Retained result", AllowEdits: cfg.AllowEdits, TimeoutSeconds: cfg.TimeoutSeconds}
		if cfg.UsesCodexLogin() {
			row.Auth = "Local Codex ChatGPT login"
		}
		if cfg.Kind == "codex" || cfg.Kind == "pi" || cfg.Kind == "claude" {
			row.Continuation = "Native session"
		}
		row.Steering = cfg.Kind == "codex" || cfg.Kind == "pi"
		row.Questions = cfg.Kind == "codex" || cfg.Kind == "claude"
		result.Agents = append(result.Agents, row)
	}
	return result, nil
}
