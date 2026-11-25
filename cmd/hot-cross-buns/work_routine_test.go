package main

import (
	"context"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"github.com/gongahkia/hot-cross-buns/internal/suggestion"
)

func TestAcceptedRoutineUsesExistingSkillStoreAndExactMetadata(t *testing.T) {
	state := t.TempDir()
	queue, _ := suggestion.Open(state)
	record, err := queue.Create(suggestion.Record{Kind: "skill", WorkID: "run-capture", SkillID: "brief", Description: "Prepare a brief", Body: "Read {{topic}} and verify dates.", Routine: &knowledge.Routine{Parameters: []knowledge.RoutineParameter{{Name: "topic", Description: "Topic"}}, Sources: []string{"Approved notes"}, Effects: []string{"read"}, MaxRequests: 4, MaxTokens: 8000, CapturedFrom: "run-capture"}})
	if err != nil {
		t.Fatal(err)
	}
	id, err := applySuggestion(state, record)
	if err != nil {
		t.Fatal(err)
	}
	store, _ := knowledge.Open(state)
	saved, err := store.LoadSkill(id)
	if err != nil || saved.Routine == nil || saved.Routine.CapturedFrom != "run-capture" {
		t.Fatal(saved, err)
	}
	if _, err = applySuggestion(state, record); err != nil {
		t.Fatal("exact accepted routine was not idempotent", err)
	}
	record.Routine.MaxRequests = 3
	if _, err = applySuggestion(state, record); err == nil {
		t.Fatal("a different routine silently replaced the accepted definition")
	}
}

func TestRoutineLibraryDisplaysActualProcedureAndPinsAvailabilityChanges(t *testing.T) {
	ctx := context.Background()
	state := t.TempDir()
	store, _ := knowledge.Open(state)
	skill, err := store.AddSkillWithRoutine("brief", "A reusable reading brief", "Read {{topic}}.\nVerify each date.", &knowledge.Routine{Parameters: []knowledge.RoutineParameter{{Name: "topic", Description: "Topic"}}, Effects: []string{"read"}, MaxRequests: 4, MaxTokens: 8000})
	if err != nil {
		t.Fatal(err)
	}
	list, err := routineControl(ctx, state, "status", nil)
	if err != nil {
		t.Fatal(err)
	}
	inspect := browserAction(t, list, "inspect")
	detail, err := routineControl(ctx, state, "inspect", inspect.Args)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Panel.Title != skill.ID || detail.Panel.Blocks[0].Lines[0] != "Read {{topic}}." {
		t.Fatal("library returned command hints instead of procedure text", detail)
	}
	disable := browserAction(t, detail, "disable")
	if !disable.Review {
		t.Fatal("availability change skipped review")
	}
	if _, err = store.UpdateSkill(skill.ID, "Changed", "Read {{topic}} and verify sources."); err != nil {
		t.Fatal(err)
	}
	if _, err = routineControl(ctx, state, "disable", disable.Args); err == nil {
		t.Fatal("stale library review disabled a different revision")
	}
	if _, err = routineControl(ctx, state, "inspect", inspect.Args); err == nil {
		t.Fatal("old selection displayed another revision")
	}
}
