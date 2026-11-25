package knowledge

import (
	"sort"
	"strings"
)

type RecallCandidate struct {
	ContentKey string
	ID         string
	Kind       string
	Revision   string
	Text       string
	Reason     string
	Priority   int
	Eligible   bool
}
type RecallTrace struct {
	ID              string `json:"id"`
	Kind            string `json:"kind"`
	Revision        string `json:"revision,omitempty"`
	Selected        bool   `json:"selected"`
	Reason          string `json:"reason"`
	TokenUpperBound int    `json:"token_upper_bound,omitempty"`
}

// UTF-8 byte count is a conservative tokenizer-independent token ceiling, not
// a provider-reported usage estimate. Never truncate a selected fact to fit.
func SelectRecall(candidates []RecallCandidate, budget int) ([]RecallCandidate, []RecallTrace) {
	candidates = append([]RecallCandidate(nil), candidates...)
	sort.SliceStable(candidates, func(i, j int) bool { return candidates[i].Priority > candidates[j].Priority })
	selected := []RecallCandidate{}
	trace := []RecallTrace{}
	seen := map[string]bool{}
	texts := map[string]bool{}
	for _, c := range candidates {
		if seen[c.ID] {
			continue
		}
		seen[c.ID] = true
		entry := RecallTrace{ID: c.ID, Kind: c.Kind, Revision: c.Revision, Reason: c.Reason, TokenUpperBound: len(c.Text) + 1}
		content := c.ContentKey
		if content == "" {
			content = c.Text
		}
		normalized := strings.Join(strings.Fields(strings.ToLower(content)), " ")
		switch {
		case !c.Eligible:
			entry.TokenUpperBound = 0
		case normalized == "":
			entry.Reason = "no useful source excerpt"
		case texts[normalized]:
			entry.Reason = "duplicate supplied content"
		case entry.TokenUpperBound > budget:
			entry.Reason = "shared knowledge token ceiling"
		default:
			entry.Selected = true
			budget -= entry.TokenUpperBound
			texts[normalized] = true
			selected = append(selected, c)
		}
		trace = append(trace, entry)
		if len(trace) == 128 {
			break
		}
	}
	return selected, trace
}
