package knowledge

import (
	"strings"
	"sync"
	"testing"
)

func TestRoutinePersistsWithSkillAndExpandsParametersExactlyOnce(t *testing.T) {
	root := t.TempDir()
	store, _ := Open(root)
	r := &Routine{Parameters: []RoutineParameter{{Name: "topic", Description: "Topic to summarize"}}, Sources: []string{"Approved notes"}, Effects: []string{"read", "draft"}, MaxRequests: 8, MaxTokens: 16000, CapturedFrom: "run-fixture"}
	skill, err := store.AddSkillWithRoutine("daily-brief", "Use for a reviewed brief", "Read {{topic}}. Verify dates against sources. Prepare a draft.", r)
	if err != nil {
		t.Fatal(err)
	}
	reopened, _ := Open(root)
	saved, err := reopened.LoadSkill(skill.ID)
	if err != nil || saved.Routine == nil || saved.Revision() != skill.Revision() {
		t.Fatal(saved, err)
	}
	result, err := saved.Routine.Expand(saved.Body, map[string]string{"topic": "literal {{other}}"})
	if err != nil || !strings.Contains(result, "literal {{other}}") {
		t.Fatal("parameters were recursively expanded", result, err)
	}
	for _, values := range []map[string]string{nil, {"other": "value"}, {"topic": ""}, {"topic": "a", "extra": "b"}} {
		if _, err := saved.Routine.Expand(saved.Body, values); err == nil {
			t.Fatal("invalid parameters accepted", values)
		}
	}
	if _, err := reopened.UpdateSkill(skill.ID, "Changed", "Read {{undeclared}}"); err == nil {
		t.Fatal("editing bypassed routine validation")
	}
	plain, err := reopened.AddSkill("ordinary-skill", "Existing text skills", "A normal procedure.")
	if err != nil || plain.Routine != nil {
		t.Fatal("plain skills changed", plain, err)
	}
}

func TestConcurrentSkillReadsSeeConsistentProcedureAndMetadata(t *testing.T) {
	store, _ := Open(t.TempDir())
	if _, err := store.AddSkill("consistent", "even", "even procedure"); err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	group.Add(2)
	go func() {
		defer group.Done()
		for i := range 40 {
			label := "even"
			if i%2 == 1 {
				label = "odd"
			}
			if _, err := store.UpdateSkill("consistent", label, label+" procedure"); err != nil {
				t.Error(err)
				return
			}
		}
	}()
	go func() {
		defer group.Done()
		for range 40 {
			skill, err := store.LoadSkill("consistent")
			if err != nil {
				t.Error(err)
				return
			}
			if skill.Body != skill.Description+" procedure" {
				t.Error("read mixed revisions of a procedure and its metadata")
				return
			}
		}
	}()
	group.Wait()
}
