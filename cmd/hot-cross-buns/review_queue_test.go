package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/jobs"
	"github.com/gongahkia/hot-cross-buns/internal/suggestion"
)

func TestReviewQueueInspectsWithoutApplyingAndAcceptsExactScheduleOnce(t *testing.T) {
	dir := t.TempDir()
	store, err := suggestion.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	record, err := store.Create(suggestion.Record{Kind: "goal", Title: "Evening reminder", GoalOutcome: "Review the day", GoalSteps: []string{"Review the day"}, Cron: "0 20 * * *", Timezone: "Asia/Singapore", Task: "Remind me to review the day", WorkID: "work-fixture"})
	if err != nil {
		t.Fatal(err)
	}
	listed := applyReviewQueue(dir, suggestion.QueueAction{Action: "list", RequestID: "list"})
	if listed.Error != "" || len(listed.Entries) != 1 {
		t.Fatalf("list: %#v", listed)
	}
	inspected := applyReviewQueue(dir, suggestion.QueueAction{Action: "inspect", ID: record.ID})
	if inspected.Error != "" || inspected.Review == nil || inspected.Review.Revision != record.Revision() {
		t.Fatalf("inspect: %#v", inspected)
	}
	current, _ := store.Load(record.ID)
	if current.Status != "pending" {
		t.Fatal("inspection resolved the proposal")
	}
	for _, revision := range []string{"", "0000000000000000000000000000000000000000000000000000000000000000"} {
		result := applyReviewQueue(dir, suggestion.QueueAction{Action: "accept", ID: record.ID, Revision: revision})
		if result.Error == "" {
			t.Fatal("unreviewed acceptance succeeded")
		}
	}
	action := suggestion.QueueAction{Action: "accept", ID: record.ID, Revision: inspected.Review.Revision}
	accepted := applyReviewQueue(dir, action)
	if accepted.Error != "" || len(accepted.Entries) != 0 {
		t.Fatalf("accept: %#v", accepted)
	}
	checks, _ := jobs.Open(dir)
	job, err := checks.Load("job-" + record.ID)
	if err != nil || job.Timezone != "Asia/Singapore" || job.Schedule != "0 20 * * *" {
		t.Fatalf("schedule: %#v %v", job, err)
	}
	if repeated := applyReviewQueue(dir, action); repeated.Error == "" {
		t.Fatal("resolved proposal accepted twice")
	}
}

func TestReviewQueueRejectsChangedProposalForBothDecisions(t *testing.T) {
	for _, decision := range []string{"accept", "reject"} {
		t.Run(decision, func(t *testing.T) {
			dir := t.TempDir()
			store, _ := suggestion.Open(dir)
			record, err := store.Create(suggestion.Record{Kind: "note", Title: "Review me", Body: "Original content", WorkID: "work-fixture"})
			if err != nil {
				t.Fatal(err)
			}
			revision := record.Revision()
			record.Body = "Changed content"
			data, _ := json.Marshal(record)
			if err := os.WriteFile(filepath.Join(dir, "hot-cross-buns", "suggestions", record.ID+".json"), data, 0600); err != nil {
				t.Fatal(err)
			}
			result := applyReviewQueue(dir, suggestion.QueueAction{Action: decision, ID: record.ID, Revision: revision})
			if result.Error == "" {
				t.Fatal("stale review changed a proposal")
			}
			current, _ := store.Load(record.ID)
			if current.Status != "pending" {
				t.Fatal("stale review resolved proposal")
			}
			result = applyReviewQueue(dir, suggestion.QueueAction{Action: "reject", ID: record.ID, Revision: current.Revision()})
			if result.Error != "" || len(result.Entries) != 0 {
				t.Fatalf("reject: %#v", result)
			}
		})
	}
}
