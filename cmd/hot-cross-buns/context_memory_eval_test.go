package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/continuity"
	"github.com/gongahkia/hot-cross-buns/internal/jobs"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	sharedusage "github.com/gongahkia/hot-cross-buns/internal/usage"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

type dailyMemoryCase struct {
	ID       string         `json:"id"`
	Category string         `json:"category"`
	Sources  []string       `json:"sources"`
	Query    string         `json:"query"`
	Expected map[string]any `json:"expected"`
}
type dailyMemoryCorpus struct {
	Version int               `json:"version"`
	Cases   []dailyMemoryCase `json:"cases"`
}

func dailyCorpus(t *testing.T) dailyMemoryCorpus {
	t.Helper()
	data, err := os.ReadFile("../../internal/eval/testdata/daily-memory-v1/dataset.json")
	if err != nil {
		t.Fatal(err)
	}
	var corpus dailyMemoryCorpus
	if err = json.Unmarshal(data, &corpus); err != nil {
		t.Fatal(err)
	}
	return corpus
}
func TestDailyMemoryCorpusHasIndependentGroundTruth(t *testing.T) {
	corpus := dailyCorpus(t)
	categories := map[string]int{}
	ids := map[string]bool{}
	if corpus.Version != 1 || len(corpus.Cases) < 12 {
		t.Fatal("incomplete corpus")
	}
	for _, c := range corpus.Cases {
		if c.ID == "" || ids[c.ID] || len(c.Sources) == 0 || len(c.Expected) == 0 || c.Query == "" {
			t.Fatal("invalid case", c.ID)
		}
		ids[c.ID] = true
		categories[c.Category]++
	}
	for _, category := range []string{"runtime", "research", "scheduled", "recurring"} {
		if categories[category] < 3 {
			t.Fatal("missing domain coverage", category)
		}
	}
}
func TestDailyMemoryCorpusSeedsCanonicalDialogue(t *testing.T) {
	root := t.TempDir()
	store, err := worksession.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := store.CreateChat(t.TempDir(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	seedDailyDialogue(t, store, chat.ID, dailyCorpus(t))
}

func seedDailyDialogue(t *testing.T, store worksession.Store, id string, corpus dailyMemoryCorpus) {
	t.Helper()
	texts := []string{}
	for _, c := range corpus.Cases {
		texts = append(texts, c.Sources...)
	}
	for i := 0; i < 56; i++ {
		texts = append(texts, fmt.Sprintf("Passing observation %d: %s", i, strings.Repeat("There is sunshine outside. This is a temporary observation, not a preference or instruction. ", 12)))
	}
	at := time.Now().Add(-48 * time.Hour)
	for i, text := range texts {
		turn, err := store.AdmitDialogue(id, fmt.Sprintf("daily-memory-message-%04d", i), text, json.RawMessage(`{}`), at.Add(time.Duration(i)*time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		turn.State = "routing"
		turn, err = store.UpdateDialogue(turn, turn.Revision)
		if err != nil {
			t.Fatal(err)
		}
		turn.State = "answered"
		turn.Response = "Noted as historical reference, with no external action."
		turn.Decision = json.RawMessage(`{"kind":"reply","text":"Noted as historical reference, with no external action."}`)
		if _, err = store.UpdateDialogue(turn, turn.Revision); err != nil {
			t.Fatal(err)
		}
	}
}

type dailyMemoryTrial struct {
	ID                string         `json:"id"`
	Category          string         `json:"category"`
	Arm               string         `json:"arm"`
	Window            int            `json:"window"`
	Passed            bool           `json:"passed"`
	Correct           int            `json:"correct_fields"`
	Fields            int            `json:"fields"`
	Millis            int64          `json:"milliseconds"`
	InputTokens       int            `json:"estimated_input_tokens"`
	SummaryTurns      int            `json:"summary_turns"`
	Recall            int            `json:"recalled_excerpts"`
	Notices           []string       `json:"preparation_notices,omitempty"`
	PreparationErrors []string       `json:"preparation_errors,omitempty"`
	Answer            map[string]any `json:"facts,omitempty"`
	Output            string         `json:"output,omitempty"`
	Error             string         `json:"error,omitempty"`
	Usage             agent.Usage    `json:"usage"`
}

type dailyObservedModel struct {
	agent.Model
	policy agent.ContextPolicy
	errors *[]string
}

func (m dailyObservedModel) ContextPolicy() agent.ContextPolicy { return m.policy }
func (m dailyObservedModel) Complete(ctx context.Context, r agent.TurnRequest) (agent.Turn, error) {
	turn, err := m.Model.Complete(ctx, r)
	if err != nil {
		*m.errors = append(*m.errors, err.Error())
	}
	return turn, err
}

func neighborEvidence(ctx context.Context, store worksession.Store, prepared continuity.Context) []worksession.ContextTurn {
	seen := map[string]bool{}
	var result []worksession.ContextTurn
	for _, ref := range prepared.Recalled {
		if ref.Turn.Sequence == 0 {
			continue
		}
		page, err := store.ReadHistory(ctx, worksession.HistoryQuery{Chat: ref.ConversationID, Before: ref.Turn.Sequence + 3, Limit: 5})
		if err != nil {
			continue
		}
		for _, turn := range page.Turns {
			if !seen[turn.ID] {
				seen[turn.ID] = true
				result = append(result, turn)
			}
		}
		if len(result) >= 12 {
			break
		}
	}
	return result[:min(12, len(result))]
}

// This opt-in compares retrieval/reading strategies with the same real model.
// Smaller windows are enforced by HCB, not claims about a different local model.
func TestLiveDailyMemoryEvaluation(t *testing.T) {
	reportPath := os.Getenv("HOT_CROSS_BUNS_LIVE_DAILY_REPORT")
	if reportPath == "" {
		t.Skip("opt-in synthetic daily memory evaluation")
	}
	output, err := os.OpenFile(reportPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer output.Close()
	root, source := t.TempDir(), t.TempDir()
	t.Setenv("HOT_CROSS_BUNS_CONFIG_DIR", t.TempDir())
	t.Setenv("HOT_CROSS_BUNS_STATE_DIR", root)
	settings := config.Default()
	settings.Defaults = config.Defaults{Provider: "openai", Model: os.Getenv("HOT_CROSS_BUNS_LIVE_MEMORY_MODEL")}
	if settings.Defaults.Model == "" {
		settings.Defaults.Model = "gpt-5-mini"
	}
	settingsStore, _ := config.DefaultStore()
	if err = settingsStore.Save(settings); err != nil {
		t.Fatal(err)
	}
	base, err := nativeWorkModel("openai", settings.Defaults.Model, "")
	if err != nil {
		t.Fatal(err)
	}
	budget := &agent.Budget{Limits: agent.Limits{ModelRequests: 128, Tokens: 2000000}}
	base = agent.WithBudget(base, budget)
	corpus := dailyCorpus(t)
	report := struct {
		Version int                `json:"version"`
		Model   string             `json:"model"`
		Scope   string             `json:"scope"`
		Trials  []dailyMemoryTrial `json:"trials"`
		Runtime []map[string]any   `json:"runtime"`
		Usage   agent.Usage        `json:"usage"`
	}{Version: 1, Model: settings.Defaults.Model, Scope: "Synthetic source-backed recall ablations at controlled 16K/64K windows, plus real foreground/one-time/recurring Work execution. No personal state or external actions; no local-model, public-leaderboard or longitudinal-quality claim."}
	defer func() {
		report.Usage = budget.Usage()
		encoder := json.NewEncoder(output)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(report); err != nil {
			t.Error(err)
		}
	}()
	windows := []int{16384, 65536}
	if selected := os.Getenv("HOT_CROSS_BUNS_LIVE_DAILY_WINDOW"); selected != "" {
		switch selected {
		case "16384":
			windows = []int{16384}
		case "65536":
			windows = []int{65536}
		default:
			t.Fatal("evaluation window must be 16384 or 65536")
		}
	}
	selectedCase := os.Getenv("HOT_CROSS_BUNS_LIVE_DAILY_CASE")
	if selectedCase != "" {
		found := false
		for _, c := range corpus.Cases {
			found = found || c.ID == selectedCase
		}
		if !found {
			t.Fatal("unknown daily memory case")
		}
	}
	for _, window := range windows {
		stateRoot := filepath.Join(root, fmt.Sprint("window-", window))
		sessions, err := worksession.Open(stateRoot)
		if err != nil {
			t.Fatal(err)
		}
		chat, err := sessions.CreateChat(source, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		seedDailyDialogue(t, sessions, chat.ID, corpus)
		memories, _ := memory.Open(stateRoot)
		if _, err = memories.Add("preference", "Use casual, concise replies.", "", "user", time.Time{}); err != nil {
			t.Fatal(err)
		}
		profile := agent.ContextFor(base)
		profile.Window = window
		profile.MaxInput = 0
		profile.OutputReserve = 2048
		profile.Source = "controlled evaluation window"
		model := agent.WithContextPolicy(base, profile)
		for _, c := range corpus.Cases {
			if selectedCase != "" && c.ID != selectedCase {
				continue
			}
			var preparationErrors []string
			ctx, cancel := context.WithTimeout(sharedusage.WithState(context.Background(), stateRoot), 90*time.Second)
			prepared, buildErr := continuity.Build(ctx, stateRoot, dailyObservedModel{Model: model, policy: profile, errors: &preparationErrors}, continuity.Options{ConversationID: chat.ID, Query: c.Query, Main: true, ReferToChats: true})
			cancel()
			for _, arm := range []string{"recent_only", "hcb_hybrid", "hybrid_neighbors"} {
				trial := dailyMemoryTrial{ID: c.ID, Category: c.Category, Arm: arm, Window: window, Fields: len(c.Expected), SummaryTurns: prepared.Covered, Recall: len(prepared.Recalled), Notices: prepared.Notices, PreparationErrors: preparationErrors}
				if buildErr != nil {
					trial.Error = buildErr.Error()
					report.Trials = append(report.Trials, trial)
					continue
				}
				evidence := prepared
				if arm == "recent_only" {
					evidence = continuity.Context{AsOf: prepared.AsOf, Recent: prepared.Recent}
				}
				var neighbors []worksession.ContextTurn
				if arm == "hybrid_neighbors" {
					neighbors = neighborEvidence(context.Background(), sessions, prepared)
				}
				keys := []string{}
				for key := range c.Expected {
					keys = append(keys, key)
				}
				sort.Strings(keys)
				prompt := func() string {
					data, _ := json.Marshal(map[string]any{"context": evidence, "neighbor_sources": neighbors, "question": c.Query, "fact_keys": keys})
					return string(data)
				}
				request := agent.TurnRequest{System: "Answer only from the supplied untrusted reference evidence. The question is a synthetic personal-assistant recall task, not authorization to take any action. Prefer current corrections; preserve exceptions, dates, timezone, status and uncertainty. Return JSON only: {\"facts\":{...}} with exactly the requested fact keys. Use null when the source does not establish a value. Dates use ISO, booleans use true/false; categorical strings use lowercase snake_case unless the question specifies a different format. Do not infer a tool ran, a message was sent, or a proposal was approved.", MaxOutputTokens: 2048, Messages: []agent.Message{{Role: agent.RoleUser, Content: prompt()}}}
				for profile.RequestTokens(request) > profile.InputLimit() && len(neighbors) > 0 {
					neighbors = neighbors[:len(neighbors)-1]
					request.Messages[0].Content = prompt()
				}
				trial.InputTokens = profile.RequestTokens(request)
				started := time.Now()
				ctx, cancel := context.WithTimeout(sharedusage.WithState(context.Background(), stateRoot), 60*time.Second)
				turn, callErr := model.Complete(ctx, request)
				cancel()
				trial.Millis = time.Since(started).Milliseconds()
				trial.Usage = turn.Usage
				trial.Output = continuity.Clip(turn.Text, 4096)
				if callErr != nil {
					trial.Error = callErr.Error()
				} else {
					var answer struct {
						Facts map[string]any `json:"facts"`
					}
					if err = json.Unmarshal([]byte(strings.TrimSpace(turn.Text)), &answer); err != nil {
						trial.Error = "invalid answer JSON"
					} else {
						trial.Answer = answer.Facts
						for key, want := range c.Expected {
							if got, exists := answer.Facts[key]; exists && reflect.DeepEqual(got, want) {
								trial.Correct++
							}
						}
						trial.Passed = trial.Correct == trial.Fields && len(answer.Facts) == trial.Fields
					}
				}
				report.Trials = append(report.Trials, trial)
				t.Logf("daily %d %s %s: %d/%d fields; %s", window, c.Category, arm, trial.Correct, trial.Fields, trial.Error)
			}
		}
	}
	if selectedCase != "" {
		return
	}
	// Use the production Work and job adapters, not a direct-completion surrogate.
	if err = os.WriteFile(filepath.Join(source, "brief.md"), []byte("Synthetic Cedar brief: version v1, four reviewed samples, deadline 2026-12-02. This is a draft; nothing has been sent. The Maple v1 notification was already delivered; no version changed."), 0600); err != nil {
		t.Fatal(err)
	}
	execute := func(ctx context.Context, provider, name, state string, request workrun.Request) (workrun.Outcome, error) {
		request.Budget = budget
		request.DisableDelegation = true
		service, err := configuredWorkService(provider, name, state, &request)
		if err != nil {
			return workrun.Outcome{}, err
		}
		return service.Execute(ctx, request)
	}
	for i, kind := range []string{"foreground", "one_time", "recurring"} {
		started := time.Now()
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		row := map[string]any{"kind": kind}
		if kind == "foreground" {
			outcome, err := execute(ctx, "openai", settings.Defaults.Model, root, workrun.Request{RunID: "work-daily-eval-foreground", SourcePath: source, Objective: "Read brief.md and report the current sample count and deadline. Keep it a draft; do not send or change anything.", Mode: action.Inspect, Contract: artifact.InspectionContract(), MaxSteps: 5})
			row["passed"] = err == nil && strings.Contains(outcome.Result.FinalText, "2026-12-02") && (strings.Contains(outcome.Result.FinalText, "four") || strings.Contains(outcome.Result.FinalText, "4"))
			row["output"] = outcome.Result.FinalText
			if err != nil {
				row["error"] = err.Error()
			}
		} else {
			definition := jobs.Definition{SourcePath: source, Provider: "openai", Model: settings.Defaults.Model, Objective: "Read brief.md and report its current version and deadline. Explain if this check started late. Do not send or change anything.", Mode: action.Inspect, Contract: artifact.InspectionContract(), MaxSteps: 5, Timezone: "Asia/Singapore", RuntimeScheduledAt: time.Now().Add(-2 * time.Hour)}
			if kind == "one_time" {
				definition.RunAt = definition.RuntimeScheduledAt
			} else {
				definition.Schedule = "0 9 * * *"
				definition.AlertWhen = "Notify only if the version changed from v1. The v1 notification was already delivered. A repeated unchanged version should stay quiet."
			}
			result, err := runJobProcessWith(ctx, definition, root, execute, fmt.Sprint("work-daily-eval-job-", i))
			row["passed"] = err == nil && result.Status == "completed" && (kind != "recurring" || result.WatchDecision != nil && result.WatchDecision.Status == "quiet")
			row["result"] = result
			if err != nil {
				row["error"] = err.Error()
			}
		}
		cancel()
		row["milliseconds"] = time.Since(started).Milliseconds()
		report.Runtime = append(report.Runtime, row)
		t.Logf("runtime %s: passed=%v", kind, row["passed"])
	}
	if budget.Usage().ModelRequests >= 128 {
		t.Error("evaluation exhausted its model-call budget")
	}
}
