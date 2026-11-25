package knowledge

import "testing"

func TestSelectionSkipsOversizedNoiseAndNeverPromotesIneligiblePinnedSource(t *testing.T) {
	selected, trace := SelectRecall([]RecallCandidate{{ID: "untrusted-pin", Priority: 99, Text: "no", Eligible: false, Reason: "source changed"}, {ID: "large", Text: "an overly large context", Eligible: true, Priority: 10}, {ID: "constraint", Text: "vegan", Priority: 9, Eligible: true, Reason: "relevant constraint"}, {ID: "other", Text: "noise", Eligible: true}}, 8)
	if len(selected) != 1 || selected[0].ID != "constraint" || trace[0].Selected || trace[0].Reason != "source changed" {
		t.Fatal(selected, trace)
	}
}
