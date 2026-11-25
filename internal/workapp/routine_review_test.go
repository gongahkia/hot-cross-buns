package workapp

import (
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func TestRoutineReviewShowsActualProcedureParametersAndLimits(t *testing.T) {
	value := approvalMessage(workrun.Interaction{Kind: "app_change", ID: 1, Preview: map[string]any{"setting": "routine", "name": "brief", "description": "A brief", "procedure": "Read Lantern.\nVerify dates.", "parameters": map[string]string{"topic": "Lantern"}, "sources": []string{"Approved notes"}, "effects": []string{"read"}, "max_additional_model_requests": 4, "max_additional_reported_tokens": 8000}})
	result := value.result
	if result.Title != "Use saved routine" || result.Preview != nil || len(result.Sections) != 1 || result.Sections[0].Lines[0] != "Read Lantern." {
		t.Fatal(result)
	}
}

func TestMemoryConsolidationReviewShowsActualSourcesAndProposedSummary(t *testing.T) {
	value := approvalMessage(workrun.Interaction{Kind: "app_change", ID: 2, Preview: map[string]any{"setting": "memory", "action": "consolidate", "proposed_title": "Trip note", "proposed_summary": "The trip remains planned.", "sources": []string{"[mem-one] I plan to visit Singapore."}, "effect": "Save derived reference data after review."}})
	r := value.result
	if r.Title != "Review memory consolidation" || r.Preview != nil || len(r.Sections) != 2 || r.Sections[1].Lines[0] != "[mem-one] I plan to visit Singapore." {
		t.Fatal(r)
	}
}
