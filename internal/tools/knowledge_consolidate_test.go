package tools

import (
	"context"
	"encoding/json"
	"github.com/gongahkia/hot-cross-buns/internal/knowledge"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
	"testing"
	"time"
)

func TestConsolidationNeedsReviewAndRejectsSourcesChangedDuringReview(t *testing.T) {
	for _, mode := range []string{"accept", "decline", "changed"} {
		state := t.TempDir()
		mem, _ := memory.Open(state)
		notes, _ := knowledge.Open(state)
		source, _ := mem.Add("preference", "I prefer concise reports.", "", "User", time.Time{})
		called := 0
		tool := ConsolidateKnowledge{Store: notes, Review: func(_ context.Context, preview any) (bool, error) {
			called++
			p := preview.(map[string]any)
			if len(p["sources"].([]string)) != 1 || p["proposed_summary"] != "Use concise reports." {
				t.Fatal(p)
			}
			if mode == "changed" {
				mem.Forget(source.ID)
			}
			return mode != "decline", nil
		}}
		raw, _ := json.Marshal(map[string]any{"sources": []string{source.ID}, "title": "Report style", "body": "Use concise reports."})
		_, err := tool.Execute(context.Background(), raw)
		if (err == nil) != (mode == "accept") || called != 1 {
			t.Fatal(mode, err, called)
		}
		rows, _ := notes.ListAllNotes()
		if (len(rows) == 1) != (mode == "accept") {
			t.Fatal(mode, rows)
		}
	}
}
