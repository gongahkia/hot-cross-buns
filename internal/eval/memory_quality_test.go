package eval

import "testing"

func TestMemoryQualityPenalizesNoiseOmissionsAndResurfacing(t *testing.T) {
	r := ScoreMemoryQuality([]MemoryQualityTrial{
		{ID: "constraint", Important: true, Captured: true, RecallExpected: true, Applied: true, Tokens: 20},
		{ID: "omitted-decision", Important: true, RecallExpected: true},
		{ID: "chatter", Captured: true, Applied: true},
		{ID: "withdrawn", Forbidden: true, Resurfaced: true},
	})
	if r.Precision != .5 || r.Recall != .5 || r.CorrectApplications != 1 || r.MissedApplications != 1 || r.IrrelevantApplications != 1 || r.ForbiddenResurfacing != 1 || r.Tokens != 20 {
		t.Fatal(r)
	}
	if z := ScoreMemoryQuality(nil); z.Trials != 0 || z.Precision != 0 {
		t.Fatal(z)
	}
}
