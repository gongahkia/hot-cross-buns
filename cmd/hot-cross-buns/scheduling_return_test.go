package main

import (
	"context"
	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/inbox"
	"github.com/gongahkia/hot-cross-buns/internal/jobs"
	"github.com/gongahkia/hot-cross-buns/internal/suggestion"
	"strings"
	"testing"
	"time"
)

func TestStandaloneOneTimePromptReturnsLateWithoutReplay(t *testing.T) {
	state := t.TempDir()
	t.Setenv("HOT_CROSS_BUNS_STATE_DIR", state)
	t.Setenv("HOT_CROSS_BUNS_CONFIG_DIR", t.TempDir())
	queue, _ := suggestion.Open(state)
	at := time.Now().Add(-2 * time.Hour).UTC().Truncate(time.Minute)
	record, err := queue.Create(suggestion.Record{Kind: "schedule", Title: "One-time reminder", Task: "Remind me to check the garden.", RunAt: at, Timezone: "UTC", SourcePath: t.TempDir(), WorkID: "work-test"})
	if err != nil {
		t.Fatal(err)
	}
	accepted := applyReviewQueue(state, suggestion.QueueAction{Action: "accept", ID: record.ID, Revision: record.Revision()})
	if accepted.Error != "" {
		t.Fatal(accepted.Error)
	}
	store, _ := jobs.Open(state)
	calls := 0
	execute := func(_ context.Context, d jobs.Definition, _ string, _ ...string) (jobResult, error) {
		calls++
		request := jobWorkRequest(d)
		if request.Objective != record.Task || !strings.Contains(request.System, "Late by") || d.RuntimeScheduledAt.IsZero() {
			t.Fatal("scheduled prompt lost its timing context")
		}
		return jobResult{Status: "completed", Summary: "Check the garden."}, nil
	}
	runDueJobsContextWith(context.Background(), store, state, false, time.Now(), execute)
	reopened, _ := jobs.Open(state)
	runDueJobsContextWith(context.Background(), reopened, state, false, time.Now().Add(time.Minute), execute)
	if calls != 1 {
		t.Fatalf("model prompt executions = %d", calls)
	}
	updates, _ := inbox.Open(state)
	entries, err := updates.List(false, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || !strings.Contains(entries[0].Summary, "Delayed by") {
		t.Fatal("late notification missing", entries)
	}
}

func TestModelClockUsesCurrentTimezoneOnEveryRequest(t *testing.T) {
	t.Setenv("HOT_CROSS_BUNS_CONFIG_DIR", t.TempDir())
	store, err := config.DefaultStore()
	if err != nil {
		t.Fatal(err)
	}
	settings := config.Default()
	settings.JobDefaults.Timezone = "Asia/Singapore"
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	first := modelClock(agent.TurnRequest{System: "Original instructions"})
	if !strings.Contains(first.System, "user_timezone=Asia/Singapore") || !strings.Contains(first.System, "Original instructions") {
		t.Fatal(first.System)
	}
	settings.JobDefaults.Timezone = "America/New_York"
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	second := modelClock(agent.TurnRequest{})
	if !strings.Contains(second.System, "user_timezone=America/New_York") || !strings.Contains(second.System, time.Now().In(mustZone(t, "America/New_York")).Format("2006-01-02")) {
		t.Fatal(second.System)
	}
}
func mustZone(t *testing.T, name string) *time.Location {
	t.Helper()
	zone, err := time.LoadLocation(name)
	if err != nil {
		t.Fatal(err)
	}
	return zone
}
