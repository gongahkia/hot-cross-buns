package knowledge

import (
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"testing"
	"time"
)

func TestDerivedSummaryAndRoutineInvalidateTransitivelyAfterCorrectionOrForget(t *testing.T) {
	for _, forget := range []bool{false, true} {
		state := t.TempDir()
		mem, _ := memory.Open(state)
		notes, _ := Open(state)
		fact, _ := mem.Add("preference", "I prefer concise reports.", "", "Added by user", time.Time{})
		deps, _, err := notes.CaptureDependencies([]string{fact.ID}, "", nil)
		if err != nil {
			t.Fatal(err)
		}
		summary, err := notes.AddDerivedNote("Report guidance", "Use concise reports.", "", deps)
		if err != nil {
			t.Fatal(err)
		}
		next, _, err := notes.CaptureDependencies([]string{summary.ID}, "", nil)
		if err != nil {
			t.Fatal(err)
		}
		routine, err := notes.AddSkillWithDependencies("report-guide", "Report format", "Prepare concise reports.", nil, next)
		if err != nil {
			t.Fatal(err)
		}
		if forget {
			err = mem.Forget(fact.ID)
		} else {
			_, err = mem.Correct(fact.ID, "I prefer detailed reports.", fact.Source)
		}
		if err != nil {
			t.Fatal(err)
		}
		derived, err := notes.LoadNote(summary.ID)
		if err != nil || derived.SourceIssue == "" {
			t.Fatal(derived, err)
		}
		skill, err := notes.LoadSkill(routine.ID)
		if err != nil || skill.SourceIssue == "" {
			t.Fatal(skill, err)
		}
		hits, err := notes.SearchNotes("report guidance", "", 8)
		if err != nil || len(hits) != 0 {
			t.Fatal("invalid summary recalled", hits, err)
		}
		skills, err := notes.ListSkills(true)
		if err != nil || len(skills) != 0 {
			t.Fatal("invalid routine enabled", skills, err)
		}
		if _, _, err := notes.CaptureDependencies([]string{summary.ID}, "", nil); err == nil {
			t.Fatal("invalid summary re-derived")
		}
	}
}
