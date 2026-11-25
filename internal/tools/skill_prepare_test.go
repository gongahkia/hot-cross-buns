package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"github.com/gongahkia/hot-cross-buns/internal/suggestion"
)

func TestRoutineUseNeedsExactFreshReviewAndCannotIncreaseBudget(t *testing.T) {
	store, _ := knowledge.Open(t.TempDir())
	metadata := &knowledge.Routine{Parameters: []knowledge.RoutineParameter{{Name: "topic", Description: "Topic"}}, Sources: []string{"Approved notes"}, Effects: []string{"read"}, MaxRequests: 8, MaxTokens: 8000}
	skill, err := store.AddSkillWithRoutine("brief", "Summarize notes", "Read {{topic}} and verify each claim.", metadata)
	if err != nil {
		t.Fatal(err)
	}
	budget := &agent.Budget{Limits: agent.Limits{ModelRequests: 4, Tokens: 4000}}
	raw := json.RawMessage(`{"name":"brief","parameters":{"topic":"Project Lantern"}}`)
	reader, err := (skillRead{store}).Execute(context.Background(), []byte(`{"name":"brief"}`))
	if err != nil || strings.Contains(reader.Content, "verify each claim") || !strings.Contains(reader.Content, "requires_prepare") {
		t.Fatal("procedure leaked before review", reader, err)
	}
	tool := PrepareSkill{Store: store, Budget: budget, Activate: func([]string) {}}
	if _, err := tool.Execute(context.Background(), raw); err == nil {
		t.Fatal("routine activated without review")
	}
	tool.Review = func(context.Context, any) (bool, error) { return false, nil }
	if _, err := tool.Execute(context.Background(), raw); err == nil {
		t.Fatal("declined routine activated")
	}
	tool.Review = func(_ context.Context, preview any) (bool, error) {
		value := preview.(map[string]any)
		if value["procedure"] != "Read Project Lantern and verify each claim." {
			t.Fatal(value)
		}
		return true, nil
	}
	result, err := tool.Execute(context.Background(), raw)
	if err != nil || !strings.Contains(result.Content, "Read Project Lantern") || budget.Limits.ModelRequests != 4 || budget.Limits.Tokens != 4000 {
		t.Fatal(result, budget.Limits, err)
	}
	tool.Review = func(context.Context, any) (bool, error) {
		_, err := store.UpdateSkill(skill.ID, "Updated", "Read {{topic}} and verify the new scope.")
		return true, err
	}
	if _, err := tool.Execute(context.Background(), raw); err == nil {
		t.Fatal("changed procedure reused a stale approval")
	}
	store.SetSkillEnabled(skill.ID, false)
	if _, err := tool.Execute(context.Background(), raw); err == nil {
		t.Fatal("disabled routine activated")
	}
}

func TestRoutineCaptureUsesExistingReviewedSkillSuggestions(t *testing.T) {
	state := t.TempDir()
	store, _ := suggestion.Open(state)
	tool := SuggestChange{Store: store, WorkID: "run-capture"}
	result, err := tool.Execute(context.Background(), []byte(`{"kind":"skill","skill_id":"brief","description":"Reusable brief","body":"Read {{topic}}; verify source dates; draft findings.","routine":{"parameters":[{"name":"topic","description":"Topic"}],"sources":["Approved notes"],"effects":["read","draft"],"max_requests":8,"max_tokens":16000}}`))
	if err != nil {
		t.Fatal(err)
	}
	var response struct {
		Result struct {
			ID string `json:"id"`
		} `json:"result"`
	}
	json.Unmarshal([]byte(result.Content), &response)
	record, err := store.Load(response.Result.ID)
	if err != nil || record.Status != "pending" || record.Routine == nil || record.Routine.CapturedFrom != "run-capture" {
		t.Fatal(record, err)
	}
	knowledgeStore, _ := knowledge.Open(state)
	if _, err := knowledgeStore.LoadSkill("brief"); err == nil {
		t.Fatal("suggesting a routine activated it before acceptance")
	}
}
