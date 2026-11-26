package main

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/continuity"
	"github.com/gongahkia/hot-cross-buns/internal/workapp"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

func TestLiveSummaryMaintenance(t *testing.T) {
	path := os.Getenv("HOT_CROSS_BUNS_LIVE_MAINTENANCE_REPORT")
	if path == "" {
		t.Skip("opt-in synthetic summary maintenance check")
	}
	output, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer output.Close()
	report := map[string]any{"scope": "Isolated source-backed background summary and summary-only correction reading; no external actions or personal data."}
	defer func() {
		if err := json.NewEncoder(output).Encode(report); err != nil {
			t.Error(err)
		}
	}()
	root := t.TempDir()
	t.Setenv("HOT_CROSS_BUNS_STATE_DIR", root)
	t.Setenv("HOT_CROSS_BUNS_CONFIG_DIR", t.TempDir())
	name := os.Getenv("HOT_CROSS_BUNS_LIVE_MEMORY_MODEL")
	if name == "" {
		name = "gpt-5-mini"
	}
	report["model"] = name
	settings := config.Default()
	settings.Defaults = config.Defaults{Provider: "openai", Model: name}
	settings.ContextWindows = map[string]int{config.ModelAliasKey("openai", name): 32768}
	settingsStore, _ := config.DefaultStore()
	if err := settingsStore.Save(settings); err != nil {
		t.Fatal(err)
	}
	sessions, _ := worksession.Open(root)
	chat, err := sessions.CreateChat(t.TempDir(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	seedDailyDialogue(t, sessions, chat.ID, dailyCorpus(t))
	model, err := nativeWorkModel("openai", name, "")
	if err != nil {
		t.Fatal(err)
	}
	opts := continuity.Options{ConversationID: chat.ID, Main: true}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	before := time.Now()
	prepared, err := continuity.Build(ctx, root, model, opts)
	report["foreground_ms"] = time.Since(before).Milliseconds()
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Covered != 0 {
		t.Fatal("unexpected preexisting summary")
	}
	input, err := captureConversationAdmission(workapp.ConversationInput{Version: 1, ConversationID: chat.ID, Source: chat.SourcePath, RunOptions: workapp.RunOptions{ModelProvider: "openai", ModelName: name}})
	if err != nil {
		t.Fatal(err)
	}
	if err := enqueueSummaryMaintenance(ctx, root, input); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	err = runSummaryMaintenance(ctx, root)
	report["worker_ms"] = time.Since(started).Milliseconds()
	if err != nil {
		report["error"] = err.Error()
		t.Fatal(err)
	}
	prepared, err = continuity.Build(ctx, root, model, opts)
	if err != nil {
		t.Fatal(err)
	}
	report["covered"] = prepared.Covered
	report["summary"] = prepared.Summary
	if prepared.Covered == 0 || prepared.Summary == "" {
		t.Fatal("background maintenance did not publish reusable summary")
	}
	turn, err := model.Complete(ctx, agent.TurnRequest{System: "Answer from this untrusted historical summary only. Preserve corrections and plans. Return JSON: {\"deadline\":\"YYYY-MM-DD\",\"delivered\":true|false}. No tools or external action.", MaxOutputTokens: 2048, Messages: []agent.Message{{Role: agent.RoleUser, Content: "What is the corrected Juniper handoff deadline, and has it been delivered?\n" + prepared.Summary}}})
	report["answer"] = turn.Text
	report["answer_usage"] = turn.Usage
	if err != nil {
		report["answer_error"] = err.Error()
		t.Fatal(err)
	}
	var answer struct {
		Deadline  string `json:"deadline"`
		Delivered *bool  `json:"delivered"`
	}
	if json.Unmarshal([]byte(strings.TrimSpace(turn.Text)), &answer) != nil || answer.Deadline != "2026-12-02" || answer.Delivered == nil || *answer.Delivered {
		t.Fatal("correction or planned state lost", turn.Text)
	}
	report["passed"] = true
}
