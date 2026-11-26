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
	"github.com/gongahkia/hot-cross-buns/internal/scheduleaccess"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

func TestLiveConversationalScheduleWindow(t *testing.T) {
	report := os.Getenv("HCB_LIVE_SCHEDULE_WINDOW_REPORT")
	if report == "" {
		t.Skip("opt-in bounded live schedule test in a disposable profile")
	}
	if os.Getenv("OPENAI_API_KEY") == "" {
		t.Fatal("manager credential unavailable")
	}
	if _, err := os.Stat(report); !os.IsNotExist(err) {
		t.Fatal("report path must be new")
	}
	state, source, configuration := t.TempDir(), t.TempDir(), t.TempDir()
	t.Setenv("HOT_CROSS_BUNS_STATE_DIR", state)
	t.Setenv("HOT_CROSS_BUNS_CONFIG_DIR", configuration)
	settings, _ := config.New(configuration)
	value := config.Default()
	value.Defaults = config.Defaults{Provider: "openai", Model: "gpt-5-mini"}
	value.JobDefaults.Timezone = "Asia/Singapore"
	if err := settings.Save(value); err != nil {
		t.Fatal(err)
	}
	sessions, _ := worksession.Open(state)
	chat, err := sessions.CreateChat(source, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	reviews := 0
	request := workrun.Request{StateDir: state, SourcePath: source, ConversationID: chat.ID, RunID: "live-schedule-window", Objective: "In this disposable profile, schedule a reminder to check the garden every day at 8 PM Asia/Singapore from November 30, 2030 through December 6, 2030 inclusive, exactly seven reminders. Save it now using the scheduling tools and verify the actual upcoming occurrences. Do not start the supervisor or ask a question; the time, date window and permission are explicit. Do not use a goal followup or put the date restriction only in the prompt.", Mode: action.Inspect, Contract: artifact.InspectionContract(), ForegroundApp: true, DisableBrowser: true, DisableDelegation: true, MaxSteps: 10, Limits: agent.Limits{ModelRequests: 12, Tokens: 100000, WallSeconds: 120}, ApproveScheduleChange: func(_ context.Context, review scheduleaccess.Review) (string, error) { reviews++; return "once", nil }}
	service, err := configuredWorkService("openai", "gpt-5-mini", state, &request)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 130*time.Second)
	defer cancel()
	outcome, runErr := service.Execute(ctx, request)
	store, _ := jobs.Open(state)
	definitions, listErr := store.List()
	checks := map[string]bool{"manager_completed": runErr == nil, "one_review": reviews == 1, "one_schedule": listErr == nil && len(definitions) == 1}
	if len(definitions) == 1 {
		d := definitions[0]
		start, _ := time.Parse(time.RFC3339, "2030-11-30T00:00:00+08:00")
		end, _ := time.Parse(time.RFC3339, "2030-12-07T00:00:00+08:00")
		checks["date_window_saved"] = !d.StartsAt.IsZero() && !d.EndsAt.IsZero() && !d.StartsAt.Before(start) && !d.StartsAt.After(start.Add(20*time.Hour)) && d.EndsAt.Equal(end)
		upcoming, err := d.Upcoming(start.Add(-time.Hour), 10)
		checks["exactly_seven_occurrences"] = err == nil && len(upcoming) == 7
		checks["all_occurrences_at_local_20"] = len(upcoming) == 7
		loc, _ := time.LoadLocation("Asia/Singapore")
		for _, at := range upcoming {
			if at.In(loc).Hour() != 20 || at.Before(start) || !at.Before(end) {
				checks["all_occurrences_at_local_20"] = false
			}
		}
	}
	data, _ := json.MarshalIndent(map[string]any{"checks": checks, "response": outcome.Result.FinalText}, "", "  ")
	if err = os.WriteFile(filepath.Clean(report), data, 0600); err != nil {
		t.Fatal(err)
	}
	for name, passed := range checks {
		if !passed {
			t.Errorf("%s failed; run error=%v", name, runErr)
		}
	}
}
