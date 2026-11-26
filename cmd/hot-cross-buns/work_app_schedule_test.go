package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/jobs"
	"github.com/gongahkia/hot-cross-buns/internal/scheduleaccess"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

func scheduleToolChange(c hotCrossBunsAppController, value map[string]any) workrun.AppChange {
	raw, _ := json.Marshal(value)
	return workrun.AppChange{Setting: "schedule", ConversationID: c.request.ConversationID, Value: raw}
}
func createScheduleValue() map[string]any {
	return map[string]any{"action": "create", "title": "Garden reminder", "prompt": "Remind me to check the garden.", "run_at": time.Now().Add(time.Hour).UTC().Truncate(time.Minute).Format(time.RFC3339), "timezone": "Asia/Singapore"}
}
func requireSchedule(t *testing.T, c hotCrossBunsAppController, value map[string]any, choice string) jobs.Definition {
	t.Helper()
	m, err := c.Prepare(context.Background(), scheduleToolChange(c, value))
	if err != nil {
		t.Fatal(err)
	}
	if m.ApplySchedule == nil || m.ScheduleReview == nil {
		t.Fatal("missing permission-aware mutation")
	}
	if _, err := m.ApplySchedule(context.Background(), choice); err != nil {
		t.Fatal(err)
	}
	store, _ := jobs.Open(c.stateDir)
	records, _ := store.List()
	if len(records) != 1 {
		t.Fatal("unexpected task count", len(records))
	}
	return records[0]
}
func TestChatScheduleCreateIsImmediateAfterExactPermissionAndIdempotent(t *testing.T) {
	c := followupControllerForTest(t)
	c.request.RunID = "one-host-run"
	value := createScheduleValue()
	m, err := c.Prepare(context.Background(), scheduleToolChange(c, value))
	if err != nil {
		t.Fatal(err)
	}
	if !m.Review || m.AfterRun || m.AfterReply {
		t.Fatal("creation bypassed review or claimed deferred save")
	}
	store, _ := jobs.Open(c.stateDir)
	before, _ := store.List()
	if len(before) != 0 {
		t.Fatal("prepare saved a task")
	}
	for range 2 {
		if _, err := m.ApplySchedule(context.Background(), "once"); err != nil {
			t.Fatal(err)
		}
	}
	d := requireSchedule(t, c, value, "once")
	if d.OriginConversationID != c.request.ConversationID || d.SourcePath != c.request.SourcePath || d.RunAt.IsZero() || d.Schedule != "" {
		t.Fatal("host identity or one-time timing lost", d)
	}
	p, _ := scheduleaccess.Open(c.stateDir)
	policy, _ := p.Get()
	if policy.Always {
		t.Fatal("one mutation became persistent permission")
	}
	inspection, err := c.Inspect(context.Background(), workrun.AppQuery{Topic: "schedules", ConversationID: c.request.ConversationID, ID: d.ID})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(inspection)
	if !strings.Contains(string(data), "Once on") || strings.Contains(string(data), `"cron"`) {
		t.Fatal("schedule inspection lost readable timing", string(data))
	}
}
func TestChatScheduleAlwaysLifecyclePreservesAuthorityAndRejectsStaleEdits(t *testing.T) {
	c := followupControllerForTest(t)
	c.request.RunID = "recurring-host-run"
	value := map[string]any{"action": "create", "title": "Daily garden", "prompt": "Check the garden.", "cron": "0 8 * * *", "timezone": "Asia/Singapore"}
	d := requireSchedule(t, c, value, "always")
	store, _ := jobs.Open(c.stateDir)
	d.Limits = agent.Limits{ModelRequests: 7, Tokens: 32000, WallSeconds: 60}
	d.MaxSteps = 9
	d.Provider = "retained-provider"
	d.Model = "retained-model"
	d.OAuthAccountPins = map[string]string{"mail-one": strings.Repeat("a", 64)}
	d.ConnectorIDs = []string{"mail-one"}
	d, err := store.Save(d)
	if err != nil {
		t.Fatal(err)
	}
	digest, _ := d.PolicyDigest()
	edit := scheduleToolChange(c, map[string]any{"action": "edit", "id": d.ID, "expected_digest": digest, "prompt": "Check changed garden needs.", "cron": "0 9 * * 1-5"})
	m, err := c.Prepare(context.Background(), edit)
	if err != nil {
		t.Fatal(err)
	}
	if m.Review {
		t.Fatal("persistent grant ignored")
	}
	d.LastScheduledAt = time.Now().Add(-time.Hour)
	if _, err := store.Save(d); err != nil {
		t.Fatal(err)
	}
	if _, err := m.ApplySchedule(context.Background(), ""); err != nil {
		t.Fatal(err)
	}
	saved, _ := store.Load(d.ID)
	if saved.Limits != d.Limits || saved.MaxSteps != d.MaxSteps || saved.Provider != d.Provider || saved.Model != d.Model || saved.OAuthAccountPins["mail-one"] != d.OAuthAccountPins["mail-one"] || saved.SourcePath != d.SourcePath || !saved.LastScheduledAt.Equal(d.LastScheduledAt) {
		t.Fatal("edit replaced authority or poll bookkeeping", saved)
	}
	if _, err := m.ApplySchedule(context.Background(), ""); err == nil {
		t.Fatal("stale edit replayed")
	}
	// The profile permission also permits managing a saved task from another
	// foreground chat, without changing the task's source or original chat.
	sessions, _ := worksession.Open(c.stateDir)
	other, err := sessions.CreateChat(t.TempDir(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	c.request.SourcePath = other.SourcePath
	c.request.ConversationID = other.ID
	for _, verb := range []string{"pause", "resume"} {
		current, _ := store.Load(d.ID)
		digest, _ := current.PolicyDigest()
		mutation, err := c.Prepare(context.Background(), scheduleToolChange(c, map[string]any{"action": verb, "id": d.ID, "expected_digest": digest}))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := mutation.ApplySchedule(context.Background(), ""); err != nil {
			t.Fatal(err)
		}
		after, _ := store.Load(d.ID)
		if after.Enabled != (verb == "resume") || after.OriginConversationID != d.OriginConversationID || after.SourcePath != d.SourcePath {
			t.Fatal("lifecycle changed task ownership", after)
		}
	}
	current, _ := store.Load(d.ID)
	digest, _ = current.PolicyDigest()
	cancel, err := c.Prepare(context.Background(), scheduleToolChange(c, map[string]any{"action": "cancel", "id": d.ID, "expected_digest": digest}))
	if err != nil {
		t.Fatal(err)
	}
	current.Objective = "A concurrent correction"
	if _, err := store.Save(current); err != nil {
		t.Fatal(err)
	}
	if _, err := cancel.ApplySchedule(context.Background(), ""); err == nil {
		t.Fatal("stale cancellation removed another revision")
	}
	current, _ = store.Load(d.ID)
	attempt, err := store.Begin(current, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	attempt.Status = "completed"
	attempt.FinishedAt = time.Now()
	if err := store.Record(attempt); err != nil {
		t.Fatal(err)
	}
	digest, _ = current.PolicyDigest()
	cancel, err = c.Prepare(context.Background(), scheduleToolChange(c, map[string]any{"action": "cancel", "id": d.ID, "expected_digest": digest}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cancel.ApplySchedule(context.Background(), ""); err != nil {
		t.Fatal(err)
	}
	items, _ := store.List()
	if len(items) != 0 {
		t.Fatal("canceled definition still runs")
	}
	history, _ := store.History(d.ID, 0)
	if len(history) != 1 {
		t.Fatal("cancellation erased history")
	}
}
func TestChatScheduleRevocationAndInvalidArgumentsDoNotChangeTasks(t *testing.T) {
	c := followupControllerForTest(t)
	m, err := c.Prepare(context.Background(), scheduleToolChange(c, createScheduleValue()))
	if err != nil {
		t.Fatal(err)
	}
	permissions, _ := scheduleaccess.Open(c.stateDir)
	policy, _ := permissions.Get()
	if _, err := permissions.Set(policy.Revision, false); err != nil {
		t.Fatal(err)
	}
	if _, err := m.ApplySchedule(context.Background(), "always"); err == nil {
		t.Fatal("revoked pending review applied")
	}
	for _, extra := range []map[string]any{{"source_path": "/"}, {"permission": "always"}, {"enable_code": true}, {"connector_ids": []string{"new-account"}}, {"limits": map[string]any{"tokens": 1000000}}, {"cron": "0 9 * * *"}, {"run_at": time.Now().Add(-time.Hour).Format(time.RFC3339)}} {
		value := createScheduleValue()
		for k, v := range extra {
			value[k] = v
		}
		if _, err := c.Prepare(context.Background(), scheduleToolChange(c, value)); err == nil {
			t.Fatal("invalid/widened creation admitted", extra)
		}
	}
	store, _ := jobs.Open(c.stateDir)
	items, _ := store.List()
	if len(items) != 0 {
		t.Fatal("invalid request created tasks")
	}
}
