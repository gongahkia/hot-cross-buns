package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/jobs"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func TestLiveRecurringEvidence(t *testing.T) {
	path := os.Getenv("HOT_CROSS_BUNS_LIVE_RECURRING_EVIDENCE_REPORT")
	if path == "" {
		t.Skip("opt-in synthetic recurring evidence check")
	}
	output, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer output.Close()
	root, source := t.TempDir(), t.TempDir()
	t.Setenv("HOT_CROSS_BUNS_STATE_DIR", root)
	t.Setenv("HOT_CROSS_BUNS_CONFIG_DIR", t.TempDir())
	name := os.Getenv("HOT_CROSS_BUNS_LIVE_MEMORY_MODEL")
	if name == "" {
		name = "gpt-5-mini"
	}
	settings := config.Default()
	settings.Defaults = config.Defaults{Provider: "openai", Model: name}
	store, _ := config.DefaultStore()
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	budget := &agent.Budget{Limits: agent.Limits{ModelRequests: 16, Tokens: 750000}}
	report := struct {
		Model, Scope string
		Checks       []map[string]any
		Usage        agent.Usage
	}{Model: name, Scope: "Three isolated production job-adapter checks: unchanged, repeated unchanged, then changed local source. No real scheduler or external account/action."}
	defer func() {
		report.Usage = budget.Usage()
		encoder := json.NewEncoder(output)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(report); err != nil {
			t.Error(err)
		}
	}()
	for i, version := range []string{"v1", "v1", "v2"} {
		if err := os.WriteFile(filepath.Join(source, "brief.md"), []byte("Synthetic Cedar brief: version "+version+", four reviewed samples, deadline 2026-12-02. This is a draft; nothing has been sent. The Maple v1 notification was already delivered."), 0600); err != nil {
			t.Fatal(err)
		}
		definition := jobs.Definition{SourcePath: source, Provider: "openai", Model: name, Objective: "Read brief.md and report its current version and deadline. Explain if this check started late. Do not send or change anything.", AlertWhen: "Notify only if the version changed from v1. The v1 notification was already delivered. A repeated unchanged version should stay quiet.", Mode: action.Inspect, Contract: artifact.InspectionContract(), MaxSteps: 5, Schedule: "0 9 * * *", Timezone: "Asia/Singapore", RuntimeScheduledAt: time.Now().Add(-2 * time.Hour)}
		execute := func(ctx context.Context, provider, model, state string, request workrun.Request) (workrun.Outcome, error) {
			request.Budget = budget
			request.DisableDelegation = true
			request.DisableBrowser = true
			request.DisableChatHistory = true
			service, err := configuredWorkService(provider, model, state, &request)
			if err != nil {
				return workrun.Outcome{}, err
			}
			return service.Execute(ctx, request)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		started := time.Now()
		result, err := runJobProcessWith(ctx, definition, root, execute)
		cancel()
		want := "quiet"
		if version == "v2" {
			want = "attention"
		}
		passed := err == nil && result.Status == "completed" && result.WatchDecision != nil && result.WatchDecision.Status == want && len(result.WatchDecision.Evidence) > 0
		row := map[string]any{"iteration": i + 1, "version": version, "expected": want, "passed": passed, "milliseconds": time.Since(started).Milliseconds(), "result": result}
		if err != nil {
			row["error"] = err.Error()
		}
		report.Checks = append(report.Checks, row)
		if !passed {
			t.Errorf("recurring %s decision: %+v, %v", version, result.WatchDecision, err)
		}
	}
}
