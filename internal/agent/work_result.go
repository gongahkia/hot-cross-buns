package agent

import (
	"context"
	"errors"
	"unicode/utf8"
)

// WorkResult is a host-produced completion envelope. Evidence references name
// retained observations; prose or a completed status alone is not verification.
type WorkResult struct {
	Version          int      `json:"version"`
	Status           string   `json:"status"`
	Summary          string   `json:"summary"`
	Evidence         []string `json:"evidence,omitempty"`
	Blockers         []string `json:"blockers,omitempty"`
	FollowUpRequired bool     `json:"follow_up_required"`
}

func CompletionResult(summary string, evidence []string, err error) WorkResult {
	result := WorkResult{Version: 1, Status: "completed", Summary: clipResult(summary, 16*1024)}
	seen := map[string]bool{}
	for _, ref := range evidence {
		if ref != "" && !seen[ref] && len(ref) <= 1024 && utf8.ValidString(ref) && len(result.Evidence) < 64 {
			result.Evidence = append(result.Evidence, ref)
			seen[ref] = true
		}
	}
	if err != nil {
		result.Status = "failed"
		if summary != "" || len(result.Evidence) > 0 {
			result.Status = "partial"
		}
		if errors.Is(err, ErrPaused) {
			result.Status = "paused"
		}
		if errors.Is(err, ErrPolicy) {
			result.Status = "blocked"
		}
		if errors.Is(err, context.Canceled) {
			result.Status = "cancelled"
		}
		result.Blockers = []string{"Execution did not complete successfully; inspect its retained error and receipts before retrying."}
		result.FollowUpRequired = true
	}
	return result
}
func clipResult(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}
