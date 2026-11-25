package jobs

import (
	"github.com/gongahkia/hot-cross-buns/internal/action"
	"github.com/gongahkia/hot-cross-buns/internal/artifact"
	"strings"
	"testing"
	"time"
)

func TestScheduleWordsMatchRulesWithoutExposingCron(t *testing.T) {
	for _, tc := range []struct{ rule, words string }{{"0 20 * * *", "8:00 PM, every day"}, {"30 9 * * 1-5", "9:30 AM, every weekday"}, {"*/15 * * * *", "Every 15 minutes"}, {"0 8 1 * *", "on day 1 of the month"}, {"0 8 1 * 1", "on dates 1 or Monday"}, {"0 8 1-31 * 1", "every day"}} {
		got := (Definition{Schedule: tc.rule, Timezone: "Asia/Singapore"}).Timing()
		if !strings.Contains(got, tc.words) || strings.Contains(got, tc.rule) {
			t.Fatalf("%s: %s", tc.rule, got)
		}
	}
}
func TestDowntimeCoalescesToLatestSlotAndOneTimeNeverRepeats(t *testing.T) {
	created := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	now := time.Date(2026, 11, 25, 10, 30, 0, 0, time.UTC)
	d := Definition{Enabled: true, Schedule: "0 9 * * *", Timezone: "UTC", Missed: "run_once", CreatedAt: created}
	due, ready, err := Due(d, now)
	want := time.Date(2026, 11, 25, 9, 0, 0, 0, time.UTC)
	if err != nil || !ready || !due.Equal(want) {
		t.Fatalf("catch-up %v %t %v", due, ready, err)
	}
	d.LastScheduledAt = due
	if _, ready, err := Due(d, now.Add(time.Minute)); err != nil || ready {
		t.Fatal("downtime backlog replayed", err)
	}
	d.RunAt = created.Add(time.Hour)
	d.Schedule = ""
	d.LastScheduledAt = time.Time{}
	due, ready, err = Due(d, now)
	if err != nil || !ready || !due.Equal(d.RunAt) {
		t.Fatal("one-time missed reminder unavailable", due, ready, err)
	}
	d.LastScheduledAt = due
	if _, ready, _ := Due(d, now.Add(time.Hour)); ready {
		t.Fatal("one-time reminder repeated")
	}
	d.LastScheduledAt = time.Time{}
	d.Missed = "skip"
	if _, ready, _ := Due(d, now); ready {
		t.Fatal("explicit skip policy ignored")
	}
}
func TestOneTimeClaimSurvivesStoreReopenAndRejectsAnotherSlot(t *testing.T) {
	dir := t.TempDir()
	store, _ := Open(dir)
	at := time.Now().UTC().Add(-time.Hour).Truncate(time.Minute)
	d, err := store.Save(Definition{Name: "Once", Enabled: true, RunAt: at, Timezone: "UTC", SourcePath: t.TempDir(), Objective: "Remind me", Mode: action.Inspect, Contract: artifact.InspectionContract()})
	if err != nil {
		t.Fatal(err)
	}
	if d.Missed != "run_once" {
		t.Fatal("new tasks do not default to catch-up")
	}
	if _, _, claimed, err := store.ClaimBegin(d.ID, at.Add(time.Minute)); err != nil || claimed {
		t.Fatal("wrong one-time slot accepted", err)
	}
	if _, _, claimed, err := store.ClaimBegin(d.ID, at); err != nil || !claimed {
		t.Fatal("one-time claim failed", err)
	}
	reopened, _ := Open(dir)
	saved, _ := reopened.Load(d.ID)
	if _, ready, err := Due(saved, time.Now()); err != nil || ready {
		t.Fatal("one-time replay after restart", err)
	}
}
