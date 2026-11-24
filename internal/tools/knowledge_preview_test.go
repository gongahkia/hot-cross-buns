package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
)

func TestKnowledgeSearchIncludesCurrentBoundedNoteContent(t *testing.T) {
	root := t.TempDir()
	notes, _ := knowledge.Open(root)
	memories, _ := memory.Open(root)
	note, err := notes.AddNote("Workshop project", "Target date: 2026-11-20. Budget unapproved.", "")
	if err != nil {
		t.Fatal(err)
	}
	updated := "Target date: 2026-11-24. Budget unapproved."
	if _, err = notes.UpdateNote(note.ID, note.Title, updated); err != nil {
		t.Fatal(err)
	}
	long, err := notes.AddNote("Workshop details", strings.Repeat("界", 300), "")
	if err != nil {
		t.Fatal(err)
	}
	private, err := notes.AddNote("Workshop private", "Do not disclose this content", "goal-0123456789abcdef01234567")
	if err != nil {
		t.Fatal(err)
	}
	tools := PersonalKnowledge{Notes: notes, Memories: memories, ExcludedIDs: []string{private.ID}}.Tools()
	response, err := tools[0].Execute(context.Background(), []byte(`{"query":"Workshop"}`))
	if err != nil {
		t.Fatal(err)
	}
	var output struct {
		Result []struct {
			ID           string `json:"id"`
			Preview      string `json:"content_preview"`
			RequiresRead bool   `json:"requires_read"`
		}
	}
	if err = json.Unmarshal([]byte(response.Content), &output); err != nil {
		t.Fatal(err)
	}
	found, truncated := false, false
	for _, item := range output.Result {
		switch item.ID {
		case note.ID:
			found = true
			if item.Preview != updated || item.RequiresRead {
				t.Fatalf("wrong current preview: %+v", item)
			}
		case long.ID:
			truncated = true
			if !item.RequiresRead || len(item.Preview) > 515 || !utf8.ValidString(item.Preview) {
				t.Fatalf("unbounded or falsely complete preview: %+v", item)
			}
		case private.ID:
			t.Fatal("private note leaked")
		}
	}
	if !found || !truncated || strings.Contains(response.Content, "2026-11-20") {
		t.Fatal("missing current bounded content", response.Content)
	}
	full, err := tools[1].Execute(context.Background(), []byte(`{"id":"`+long.ID+`"}`))
	if err != nil || !strings.Contains(full.Content, strings.Repeat("界", 300)) {
		t.Fatal("full note unavailable", err)
	}
}
