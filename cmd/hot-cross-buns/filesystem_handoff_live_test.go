package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/fileaccess"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func TestLiveFilesystemCodexHandoff(t *testing.T) {
	reportPath := os.Getenv("HCB_LIVE_FILES_HANDOFF_REPORT")
	if reportPath == "" {
		t.Skip("opt-in live OpenAI manager to local Codex filesystem handoff")
	}
	if _, err := os.Stat(reportPath); !os.IsNotExist(err) {
		t.Fatal("report path must be new")
	}
	if os.Getenv("OPENAI_API_KEY") == "" {
		t.Fatal("manager credential unavailable")
	}
	state := t.TempDir()
	t.Setenv("HOT_CROSS_BUNS_STATE_DIR", state)
	folder, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	marker := "live-config-" + filepath.Base(folder)
	os.WriteFile(filepath.Join(folder, "init.lua"), []byte("-- verification marker: "+marker+"\nvim.g.mapleader = ' '\n"), 0600)
	reviews := 0
	managerRead := false
	request := workrun.Request{StateDir: state, SourcePath: t.TempDir(), Objective: "Use the configured local Codex CLI to inspect my Neovim config at " + folder + ". It is outside the selected source snapshot. Obtain read-only live folder access inline, then delegate to cli_codex. Have Codex report the verification marker from init.lua and the mapleader setting. Do not read the file yourself, change files, switch /source, ask me to resend, or substitute a native researcher. Await the worker and report its findings.", Mode: action.Inspect, Contract: artifact.InspectionContract(), ForegroundApp: true, DisableBrowser: true, MaxSteps: 12, Limits: agent.Limits{ModelRequests: 18, Tokens: 120000, WallSeconds: 150}, ApproveFilesystem: func(_ context.Context, r fileaccess.Review) (string, error) {
		reviews++
		if r.Folder != folder || r.Access != "read" {
			return "deny", nil
		}
		return "once", nil
	}, OnEvent: func(event agent.Event) {
		if event.Kind == agent.EventToolFinished && event.ToolCall != nil && event.ToolCall.Name == "filesystem" {
			var args struct {
				Operation string `json:"operation"`
			}
			json.Unmarshal(event.ToolCall.Arguments, &args)
			managerRead = managerRead || args.Operation == "read"
		}
	}}
	service, err := configuredWorkService("openai", "gpt-5-mini", state, &request)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 160*time.Second)
	defer cancel()
	outcome, runErr := service.Execute(ctx, request)
	worker := false
	completed := false
	for _, s := range outcome.Manifest.Subagents {
		if s.Agent == "cli_codex" {
			worker = true
			completed = completed || s.Status == "completed"
		}
	}
	checks := map[string]bool{"manager_succeeded": runErr == nil, "inline_permission_once": reviews == 1, "codex_delegated": worker, "codex_completed": completed, "live_marker_returned": strings.Contains(outcome.Result.FinalText, marker), "manager_did_not_read_file": !managerRead}
	report := struct {
		Checks   map[string]bool `json:"checks"`
		Response string          `json:"response"`
		Error    string          `json:"error,omitempty"`
	}{Checks: checks, Response: outcome.Result.FinalText}
	if runErr != nil {
		report.Error = runErr.Error()
	}
	data, _ := json.MarshalIndent(report, "", "  ")
	if err := os.WriteFile(reportPath, data, 0600); err != nil {
		t.Fatal(err)
	}
	for name, passed := range checks {
		if !passed {
			t.Errorf("%s failed: %v", name, runErr)
		}
	}
}
