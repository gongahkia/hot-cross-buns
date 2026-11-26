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
	"github.com/gongahkia/hot-cross-buns/internal/jobs"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

type citationWatchModel struct {
	t     *testing.T
	step  int
	forge bool
}

func (m *citationWatchModel) Complete(_ context.Context, r agent.TurnRequest) (agent.Turn, error) {
	m.step++
	if m.step == 1 {
		if !strings.Contains(r.System, "evidence_references") {
			m.t.Fatal("scheduled decision lacks citation contract")
		}
		return agent.Turn{ToolCalls: []agent.ToolCall{{ID: "read-current-file", Name: "read_file", Arguments: json.RawMessage(`{"path":"source/brief.md"}`)}}}, nil
	}
	var read struct {
		Result struct {
			Content string `json:"content"`
		} `json:"result"`
		References []string          `json:"evidence_references"`
		Evidence   artifact.Evidence `json:"evidence"`
	}
	if err := json.Unmarshal([]byte(r.Messages[len(r.Messages)-1].Content), &read); err != nil || len(read.References) != 1 || read.Evidence.ID != read.References[0] || read.Evidence.SnapshotPath == "" || read.Result.Content == "" {
		m.t.Fatal("file read has no retained citation", read, err)
	}
	references := read.References
	if m.forge {
		references = []string{"evidence-invented-by-model"}
	}
	changed := strings.Contains(read.Result.Content, "v2")
	value, _ := json.Marshal(map[string]any{"attention": changed, "summary": "Current file inspected", "rationale": "Compared the current retained file; lateness is clock metadata.", "next_step": "Review changed version", "evidence": references, "change_ids": []string{}})
	return agent.Turn{Text: string(value)}, nil
}
func TestRecurringDecisionCopiesRetainedReadReferencesAndRejectsTampering(t *testing.T) {
	for _, kind := range []string{"quiet", "changed", "invented", "tampered"} {
		t.Run(kind, func(t *testing.T) {
			root, source := t.TempDir(), t.TempDir()
			t.Setenv("HOT_CROSS_BUNS_CONFIG_DIR", t.TempDir())
			t.Setenv("HOT_CROSS_BUNS_STATE_DIR", root)
			contents := "version v1\n"
			if kind == "changed" {
				contents = "version v2\n"
			}
			if err := os.WriteFile(filepath.Join(source, "brief.md"), []byte(contents), 0600); err != nil {
				t.Fatal(err)
			}
			definition := jobs.Definition{SourcePath: source, Objective: "Read brief.md and compare its version with v1.", Mode: action.Inspect, Contract: artifact.InspectionContract(), AlertWhen: "Notify only if the version changed from v1.", Schedule: "0 9 * * *", Timezone: "Asia/Singapore", RuntimeScheduledAt: time.Now().Add(-time.Hour), MaxSteps: 4}
			execute := func(ctx context.Context, _, _, _ string, r workrun.Request) (workrun.Outcome, error) {
				r.DisableDelegation = true
				r.DisableBrowser = true
				outcome, err := (workrun.Service{Executor: workrun.Executor{StateDir: root, Model: &citationWatchModel{t: t, forge: kind == "invented"}}}).Execute(ctx, r)
				if err == nil && kind == "tampered" {
					entry := outcome.Manifest.Evidence[0]
					if err := os.WriteFile(filepath.Join(outcome.Work.Path, entry.SnapshotPath), []byte("tampered"), 0600); err != nil {
						t.Fatal(err)
					}
				}
				return outcome, err
			}
			result, err := runJobProcessWith(context.Background(), definition, root, execute)
			if err != nil {
				t.Fatal(err)
			}
			want := "review"
			if kind == "quiet" {
				want = "quiet"
			}
			if kind == "changed" {
				want = "attention"
			}
			if result.WatchDecision == nil || result.WatchDecision.Status != want {
				t.Fatal("watch decision", result.WatchDecision, want)
			}
			if want != "review" && (len(result.WatchDecision.Evidence) != 1 || !strings.HasPrefix(result.WatchDecision.Evidence[0], "local-")) {
				t.Fatal("verified decision lost its copyable citation", result.WatchDecision)
			}
		})
	}
}
