package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/goal"
	"github.com/gongahkia/hot-cross-buns/internal/suggestion"
)

func TestPlanDependencyIntentRequiresExplicitChoiceAndSurvivesReview(t *testing.T) {
	root := t.TempDir()
	goals, err := goal.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	queue, err := suggestion.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	record, err := goals.Add("Workshop", "", "")
	if err != nil {
		t.Fatal(err)
	}
	plan, err := goals.InitializePlan(record.ID, "Prepare workshop", []string{"Budget approval", "Workshop outline"})
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now().UTC().Truncate(time.Minute).Add(24 * time.Hour)
	plan, err = goals.ApplyPlanChange(record.ID, goal.PlanChange{Kind: "update_step", ExpectedRevision: plan.Revision, StepID: plan.Steps[0].ID, Status: goal.StepDoing, StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	plans := &LocalPlans{Store: goals, AllowGlobal: true}
	read, _ := json.Marshal(map[string]string{"goal_id": record.ID})
	if _, err := plans.Tools()[0].Execute(context.Background(), read); err != nil {
		t.Fatal(err)
	}
	tool := SuggestChange{Store: queue, Plans: plans, WorkID: "dependency-review"}
	change := map[string]any{"kind": "update_step", "expected_revision": plan.Revision, "step_id": plan.Steps[1].ID, "starts_at": start.Add(30 * time.Minute), "ends_at": start.Add(90 * time.Minute)}
	execute := func() error {
		raw, _ := json.Marshal(map[string]any{"kind": "plan", "goal_id": record.ID, "plan_change": change})
		_, err := tool.Execute(context.Background(), raw)
		return err
	}
	if err := execute(); err == nil || !strings.Contains(err.Error(), "dependency_action") {
		t.Fatalf("omitted dependency intent: %v", err)
	}
	pending, err := queue.List("pending")
	if err != nil || len(pending) != 0 {
		t.Fatalf("malformed proposal persisted: %+v %v", pending, err)
	}
	change["dependency_action"] = "replace"
	if err := execute(); err == nil {
		t.Fatal("replacement without exact IDs accepted")
	}
	change["depends_on"] = []string{plan.Steps[0].ID}
	if err := execute(); err != nil {
		t.Fatal(err)
	}
	pending, err = queue.List("pending")
	if err != nil || len(pending) != 1 {
		t.Fatal(pending, err)
	}
	untouched, _ := goals.LoadPlan(record.ID)
	if len(untouched.Steps[1].DependsOn) != 0 {
		t.Fatal("dependency applied before review")
	}
	accepted, err := goals.ApplyPlanChange(record.ID, pending[0].PlanChange)
	if err != nil {
		t.Fatal(err)
	}
	if accepted.Steps[1].ID != plan.Steps[1].ID || len(accepted.Steps[1].DependsOn) != 1 || accepted.Steps[1].DependsOn[0] != plan.Steps[0].ID {
		t.Fatalf("dependency lost: %+v", accepted)
	}
	agenda, err := goals.Agenda("", time.Now(), time.Now().Add(7*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(agenda.Items) != 2 || len(agenda.Items[1].BlockedBy) == 0 || len(agenda.Items[0].Conflicts) == 0 {
		t.Fatalf("missing dependency/overlap: %+v", agenda)
	}
}

func TestPlanDependencyActionsRejectContradictoryFields(t *testing.T) {
	tool := SuggestChange{}
	for _, fields := range []string{`"dependency_action":"preserve","depends_on":[]`, `"dependency_action":"preserve","clear_dependencies":true`, `"dependency_action":"replace","depends_on":[]`, `"dependency_action":"replace","depends_on":["step-a"],"clear_dependencies":true`, `"dependency_action":"clear","depends_on":["step-a"]`} {
		_, err := tool.Execute(context.Background(), []byte(`{"kind":"plan","plan_change":{"kind":"update_step",`+fields+`}}`))
		if err == nil || !strings.Contains(err.Error(), "dependency_action") {
			t.Fatalf("contradictory action accepted: %s: %v", fields, err)
		}
	}
}
