package workrun

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/cliagent"
	"github.com/gongahkia/hot-cross-buns/internal/orchestrator"
	"github.com/gongahkia/hot-cross-buns/internal/workspace"
	"os"
	"path/filepath"
)

func (e Executor) externalCLISpecialist(request Request, work workspace.Work, cfg cliagent.Config) orchestrator.Specialist {
	edit := cfg.AllowEdits && request.Mode != action.Inspect
	description := fmt.Sprintf("Run the configured %s CLI in an isolated source copy; separate provider billing, bounded runtime, no live steering. Returns findings", cfg.Kind)
	persistent := cfg.Kind == "codex" || cfg.Kind == "pi" || cfg.Kind == "claude"
	if persistent {
		description = fmt.Sprintf("Work with %s in a retained isolated conversation. Use start_agent with continue to send follow-ups to the same native session, or steer_agent during active work. Separate provider billing, bounded runtime. Returns findings", cfg.Kind)
	}
	if cfg.Kind == "claude" {
		description = "Work with Claude in a retained isolated conversation. Use start_agent with continue for follow-ups and answer_agent for structured questions. Active-turn steering is unavailable. Separate provider billing, bounded runtime. Returns findings"
	}
	if edit {
		description += " and a reviewable patch; original files remain unchanged."
	} else {
		description += "; read-only for this run."
	}
	specialist := orchestrator.HostedSpecialist(cfg.Role(), description, func(ctx context.Context, i orchestrator.Invocation) (orchestrator.Result, error) {
		// pin the selected credential for this invocation, including native redaction.
		invocationConfig := cfg
		key := os.Getenv(cfg.APIKeyEnv)
		if key == "" && request.StateDir != "" {
			provider := ""
			switch cfg.APIKeyEnv {
			case "OPENAI_API_KEY":
				if cfg.Kind == "codex" || cfg.Kind == "opencode" || cfg.Kind == "copilot" || cfg.Kind == "pi" && (cfg.Provider == "" || cfg.Provider == "openai") {
					provider = "openai"
				}
			case "ANTHROPIC_API_KEY":
				if cfg.Kind == "claude" {
					provider = "anthropic"
				}
			case "GEMINI_API_KEY":
				if cfg.Kind == "gemini" {
					provider = "gemini"
				}
			}
			if provider != "" {
				store, err := auth.New(request.StateDir)
				if err != nil {
					return orchestrator.Result{}, err
				}
				credential, found, err := store.Read(provider)
				if err != nil {
					return orchestrator.Result{}, fmt.Errorf("cannot read the configured CLI credential")
				}
				if found && credential.IsAPIKey() {
					key = credential.Key
				}
			}
		}
		invocationConfig.Credential = func() (string, error) { return key, nil }
		baseline, err := request.integration.baseline(i.Baseline)
		if err != nil {
			return orchestrator.Result{}, err
		}
		assignment := cliagent.Request{Config: invocationConfig, Source: work.Source.Path(), Scratch: work.Scratch.Path(), ID: i.ID, Task: i.Task, Edit: edit, Scopes: request.Code.Scopes, Baseline: baseline, OnEvent: i.OnEvent}
		var value cliagent.Result
		if persistent {
			owner := request.ConversationID
			if owner == "" {
				owner = "run:" + request.RunID
			}
			capture := request.SnapshotID
			if capture == "" {
				capture = work.Source.Path()
			}
			store, pathErr := filepath.EvalSymlinks(request.StateDir)
			if pathErr != nil {
				return orchestrator.Result{}, pathErr
			}
			value, err = cliagent.RunSession(ctx, cliagent.SessionRequest{Request: assignment, Store: filepath.Join(store, "hot-cross-buns", "cli-sessions"), Owner: owner, Capture: capture, SessionID: i.SessionID, Steering: i.Steering, Controls: i.Controls, OnState: i.OnState})
		} else {
			value, err = cliagent.Run(ctx, assignment)
		}
		result := orchestrator.Result{SessionID: value.SessionID, Summary: value.Summary, BaselineSHA256: value.BaselineSHA256, Usage: value.Usage, Steps: value.Turns}
		if err != nil {
			return result, err
		}
		if len(value.Patch) > 0 {
			path := filepath.ToSlash(filepath.Join("code", request.RunID+"-"+i.ID+"-"+cfg.Kind+".patch"))
			if err := artifact.WriteBinary(work.Output, request.Contract, path, value.Patch); err != nil {
				return result, err
			}
			hash := sha256.Sum256(value.Patch)
			result.ArtifactPath = path
			result.ArtifactSHA256 = hex.EncodeToString(hash[:])
			request.integration.mu.Lock()
			request.integration.patches[path] = result.ArtifactSHA256
			request.integration.mu.Unlock()
			result.Summary += "\nPatch artifact for review: " + path
		}
		return result, nil
	})
	specialist.Configuration = orchestrator.RoleConfiguration{Version: 1, Provider: cfg.Kind + "/" + cfg.Model, MaxSteps: 16}
	specialist.Sessions, specialist.Steering = persistent, persistent && cfg.Kind != "claude"
	return specialist
}
