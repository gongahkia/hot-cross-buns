package workrun

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/auth"
	"github.com/gongahkia/hot-cross-buns/internal/cliagent"
	"github.com/gongahkia/hot-cross-buns/internal/orchestrator"
	"github.com/gongahkia/hot-cross-buns/internal/sandbox"
	"github.com/gongahkia/hot-cross-buns/internal/workspace"
	"os"
	"path/filepath"
	"time"
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
	if cfg.Kind == "codex" {
		description += " Can run local diagnostic commands inside the host sandbox and granted filesystem scope."
	} else {
		description += " File tools only; shell/command execution is disabled. Do not assign local command diagnostics to this adapter."
	}
	if edit {
		description += " and a reviewable patch; original files remain unchanged."
	} else {
		description += "; read-only for this run."
	}
	if request.files != nil {
		description += " Host-approved live filesystem paths are separate from the private checkout; use their granted read/write scope. Acquire folder access with filesystem request_access before launching this worker."
	}
	specialist := orchestrator.HostedSpecialist(cfg.Role(), description, func(ctx context.Context, i orchestrator.Invocation) (orchestrator.Result, error) {
		// pin the selected credential for this invocation, including native redaction.
		invocationConfig := cfg
		if request.files != nil {
			envelope, err := request.files.Envelope()
			if err != nil {
				return orchestrator.Result{}, err
			}
			if len(envelope.Read) > 0 {
				invocationConfig.LiveFiles = &sandbox.LiveFilesystem{Read: envelope.Read, Write: envelope.Write, Protected: envelope.Protected, Full: envelope.Full, Fingerprint: envelope.Digest}
				witnesses := map[string]os.FileInfo{}
				for _, path := range envelope.Read {
					info, err := os.Stat(path)
					if err != nil {
						return orchestrator.Result{}, err
					}
					witnesses[path] = info
				}
				workerCtx, cancel := context.WithCancel(ctx)
				defer cancel()
				ctx = workerCtx
				go func() {
					ticker := time.NewTicker(150 * time.Millisecond)
					defer ticker.Stop()
					for {
						select {
						case <-workerCtx.Done():
							return
						case <-ticker.C:
							changed := request.files.CheckPolicy() != nil
							for path, before := range witnesses {
								after, err := os.Stat(path)
								if err != nil || !os.SameFile(before, after) {
									changed = true
									break
								}
							}
							if changed {
								cancel()
								return
							}
						}
					}
				}()
			}
		}

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
		if !cfg.UsesCodexLogin() {
			invocationConfig.Credential = func() (string, error) { return key, nil }
		}
		baseline, err := request.integration.baseline(i.Baseline)
		if err != nil {
			return orchestrator.Result{}, err
		}
		taskText := i.Task
		if invocationConfig.LiveFiles != nil {
			scope, _ := json.Marshal(struct {
				Read  []string
				Write []string
			}{invocationConfig.LiveFiles.Read, invocationConfig.LiveFiles.Write})
			taskText += "\nHost-approved LIVE filesystem paths: " + string(scope) + ". Read/modify these absolute paths directly as assigned. Changes in Write roots affect real files; report actual changes. Private checkout changes remain isolated. Do not access other paths or HCB control records."
		}
		assignment := cliagent.Request{Config: invocationConfig, Source: work.Source.Path(), Scratch: work.Scratch.Path(), ID: i.ID, Task: taskText, Edit: edit, Scopes: request.Code.Scopes, Baseline: baseline, OnEvent: i.OnEvent}
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
