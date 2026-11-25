package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/eval"
	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"github.com/gongahkia/hot-cross-buns/internal/personalization"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

// Opt-in synthetic end-to-end journey through production service preparation,
// real provider turns/tools, persistent stores, reviews and the browser catalog.
// No personal profile or external-action authorization is used.
func TestLiveMemoryJourney(t *testing.T) {
	reportPath := os.Getenv("HOT_CROSS_BUNS_LIVE_MEMORY_REPORT")
	if reportPath == "" {
		t.Skip("opt-in synthetic live memory journey")
	}
	output, err := os.OpenFile(reportPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer output.Close()
	state, source := t.TempDir(), t.TempDir()
	t.Setenv("HOT_CROSS_BUNS_CONFIG_DIR", t.TempDir())
	t.Setenv("HOT_CROSS_BUNS_STATE_DIR", state)
	settings := config.Default()
	settings.Defaults = config.Defaults{Provider: "openai", Model: os.Getenv("HOT_CROSS_BUNS_LIVE_MEMORY_MODEL")}
	if settings.Defaults.Model == "" {
		settings.Defaults.Model = "gpt-5-mini"
	}
	no := false
	settings.Desktop.ReferToChats = &no
	store, err := config.DefaultStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	budget := &agent.Budget{Limits: agent.Limits{ModelRequests: 48, Tokens: 350000}}
	type step struct {
		Name   string                  `json:"name"`
		Passed bool                    `json:"passed"`
		Output string                  `json:"output,omitempty"`
		Error  string                  `json:"error,omitempty"`
		Saved  int                     `json:"saved"`
		Trace  []knowledge.RecallTrace `json:"trace,omitempty"`
	}
	report := struct {
		Model   string             `json:"model"`
		Scope   string             `json:"scope"`
		Steps   []step             `json:"steps"`
		Usage   agent.Usage        `json:"usage"`
		Quality eval.MemoryQuality `json:"quality"`
	}{Model: settings.Defaults.Model, Scope: "Synthetic production Work-service journey; no browser hardware, personal data, connected accounts or local-model parity claim."}
	var metrics []eval.MemoryQualityTrial
	defer func() {
		report.Usage = budget.Usage()
		report.Quality = eval.ScoreMemoryQuality(metrics)
		report.Quality.Tokens = report.Usage.InputTokens + report.Usage.OutputTokens
		encoder := json.NewEncoder(output)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(report); err != nil {
			t.Error(err)
		}
	}()
	memories, _ := memory.Open(state)
	notes, _ := knowledge.Open(state)
	run := func(name, prompt string, wantCount int, required, forbidden string) bool {
		t.Helper()
		request := workrun.Request{RunID: fmt.Sprintf("work-memory-journey-%d", len(report.Steps)), SourcePath: source, Objective: prompt, ForegroundApp: true, Mode: action.Inspect, Contract: artifact.InspectionContract(), MaxSteps: 8, Budget: budget, DisableDelegation: true, DisableChatHistory: true, ApproveAppChange: func(_ context.Context, preview any) (bool, error) {
			p, ok := preview.(map[string]any)
			return ok && p["setting"] == "memory" && p["action"] == "consolidate", nil
		}}
		service, err := configuredWorkService("openai", settings.Defaults.Model, state, &request)
		var result workrun.Outcome
		started := time.Now()
		if err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
			result, err = service.Execute(ctx, request)
			cancel()
		}
		rows, _ := memories.List("", true)
		item := step{Name: name, Output: result.Result.FinalText, Saved: len(rows), Trace: request.RecallTrace}
		if err != nil {
			item.Error = err.Error()
		}
		item.Passed = err == nil && len(rows) == wantCount && (required == "" || strings.Contains(strings.ToLower(item.Output), required)) && (forbidden == "" || !strings.Contains(strings.ToLower(item.Output), forbidden))
		report.Steps = append(report.Steps, item)
		metrics = append(metrics, eval.MemoryQualityTrial{ID: name, Important: name == "capture" || name == "correction", Captured: (name == "capture" || name == "correction") && len(rows) > 0, RecallExpected: required != "" && required != "unknown", Applied: required != "" && required != "unknown" && strings.Contains(strings.ToLower(item.Output), required), Forbidden: forbidden != "", Resurfaced: forbidden != "" && strings.Contains(strings.ToLower(item.Output), forbidden), Milliseconds: time.Since(started).Milliseconds()})
		t.Logf("%s: passed=%t saved=%d", name, item.Passed, item.Saved)
		if !item.Passed {
			t.Errorf("%s failed; inspect synthetic report %s", name, reportPath)
		}
		return err == nil
	}
	if !run("capture", "Please remember: I prefer concise answers.", 1, "", "") {
		return
	}
	if !run("recall in fresh task", "What response length do I prefer? Reply with concise or unknown, no other words.", 1, "concise", "") {
		return
	}
	if !run("correction", "I prefer detailed answers. Remember this update to my response length preference.", 1, "", "") {
		return
	}
	if !run("corrected recall", "What response length do I prefer? Reply detailed or unknown, no other words.", 1, "detailed", "concise") {
		return
	}
	if !run("forget", "Forget my response length preference.", 0, "", "") {
		return
	}
	if !run("withdrawn recall", "What response length do I prefer? Reply unknown if you have no current saved preference, no other words.", 0, "unknown", "concise") {
		return
	}
	if !run("significance proposal", "I plan to visit Singapore. Propose this planned travel fact using memory_propose for my review; do not invent dates or save it as active memory.", 0, "", "") {
		return
	}
	proposals, err := memories.Candidates()
	if err != nil || len(proposals) != 1 {
		t.Error("missing inactive significance proposal", err)
		return
	}
	accepted := personalization.ApplyCatalog(state, personalization.CatalogAction{Action: "accept", ID: proposals[0].ID, Revision: proposals[0].UpdatedAt.Format(time.RFC3339Nano)})
	if accepted.Error != "" {
		t.Error(accepted.Error)
		return
	}
	rows, _ := memories.List("", true)
	if len(rows) != 1 || rows[0].Context == nil || rows[0].Context.State != "planned" {
		t.Error("planned state lost during review")
		return
	}
	report.Steps = append(report.Steps, step{Name: "catalog review activates exact planned context", Passed: true, Saved: 1})
	if !run("reviewed consolidation", "Use knowledge_consolidate to propose a compact saved note from saved source "+rows[0].ID+". Preserve that the Singapore visit is planned; do not claim it happened.", 1, "", "") {
		return
	}
	derived, _ := notes.ListAllNotes()
	if len(derived) != 1 {
		t.Error("consolidation did not save a single derived note")
		return
	}
	if err := memories.Forget(rows[0].ID); err != nil {
		t.Error(err)
		return
	}
	invalid, err := notes.LoadNote(derived[0].ID)
	ok := err == nil && invalid.SourceIssue != ""
	report.Steps = append(report.Steps, step{Name: "forget invalidates derived summary", Passed: ok})
	if !ok {
		t.Error("derived summary remained active after forgetting")
	}
}
