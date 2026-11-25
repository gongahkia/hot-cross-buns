package main

import (
	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"github.com/gongahkia/hot-cross-buns/internal/workrun"
	"strings"
	"testing"
	"time"
)

func TestKnowledgeSelectionPinExclusionAndSharedTrace(t *testing.T) {
	state := t.TempDir()
	s, _ := memory.Open(state)
	r, _ := s.Add("preference", "Use concise prose.", "", "User", time.Time{})
	s.UpdatePolicy(r.ID, r.UpdatedAt.Format(time.RFC3339Nano), memory.RecallPolicy{Pinned: true})
	notes, _ := knowledge.Open(state)
	note, _ := notes.AddNote("A report", "Keep exact figures.", "")
	notes.UpdateRecallPolicy(note.ID, note.Revision(), knowledge.RecallPolicy{Pinned: true})
	request := workrun.Request{Objective: "Prepare a report"}
	if err := applyKnowledgeSelection(state, &request); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(request.MemoryContext, "concise") || !strings.Contains(request.NoteContext, "exact figures") {
		t.Fatal(request)
	}
	if len(request.RecallTrace) != 2 || !request.RecallTrace[0].Selected {
		t.Fatal(request.RecallTrace)
	}
	request.ExcludedKnowledgeIDs = []string{r.ID, note.ID}
	request.ContextItems = nil
	if err := applyKnowledgeSelection(state, &request); err != nil {
		t.Fatal(err)
	}
	if request.MemoryContext != "" || request.NoteContext != "" {
		t.Fatal("pin bypassed task exclusion")
	}
}
