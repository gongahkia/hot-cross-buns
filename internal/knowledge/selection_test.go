package knowledge

import "testing"

func TestSelectionSkipsOversizedNoiseAndNeverPromotesIneligiblePinnedSource(t *testing.T) {
	selected, trace := SelectRecall([]RecallCandidate{{ID: "untrusted-pin", Priority: 99, Text: "no", Eligible: false, Reason: "source changed"}, {ID: "large", Text: "an overly large context", Eligible: true, Priority: 10}, {ID: "constraint", Text: "vegan", Priority: 9, Eligible: true, Reason: "relevant constraint"}, {ID: "other", Text: "noise", Eligible: true}}, 8)
	if len(selected) != 1 || selected[0].ID != "constraint" || trace[0].Selected || trace[0].Reason != "source changed" {
		t.Fatal(selected, trace)
	}
}

func TestSelectionDeduplicatesContentDespiteDifferentSourceIdentifiers(t *testing.T) {
	selected, trace := SelectRecall([]RecallCandidate{{ID: "mem-one", Text: "[mem-one] concise", ContentKey: "User prefers concise", Eligible: true, Priority: 5}, {ID: "mem-two", Text: "[mem-two] concise", ContentKey: "User prefers concise", Eligible: true}}, 100)
	if len(selected) != 1 || len(trace) != 2 || trace[1].Reason != "duplicate supplied content" {
		t.Fatal(selected, trace)
	}
}
