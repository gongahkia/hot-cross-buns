package tools

import (
	"context"
	"encoding/json"
	"slices"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/memory"
)

type memoryStatus struct{ PersonalKnowledge }

func (memoryStatus) Definition() agent.ToolDefinition {
	return agent.ToolDefinition{Name: "memory_status", Description: "Inspect saved-memory freshness and review needs in this goal plus personal scope. Returns bounded metadata without stale fact text. Use it when a remembered fact is unavailable or the user asks what needs confirmation. Review in Memory; this tool cannot confirm, save, restore forgotten facts, or resolve contradictions. Current messages outrank older recall.", Parameters: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{}}`)}
}

func (t memoryStatus) Execute(ctx context.Context, raw json.RawMessage) (agent.ToolResult, error) {
	var args struct{}
	if err := decodeArguments(raw, &args); err != nil {
		return agent.ToolResult{}, err
	}
	if err := ctx.Err(); err != nil {
		return agent.ToolResult{}, err
	}
	records, err := t.Memories.List(t.GoalID, true)
	warning := memory.ReadWarning(err)
	if err != nil && warning == "" {
		return agent.ToolResult{}, err
	}
	type item struct {
		ID          string    `json:"id"`
		Subject     string    `json:"subject,omitempty"`
		GoalID      string    `json:"goal_id,omitempty"`
		Status      string    `json:"status"`
		Reason      string    `json:"reason,omitempty"`
		Updated     time.Time `json:"updated"`
		Confirmed   time.Time `json:"last_confirmed"`
		ReviewAfter time.Time `json:"review_after"`
	}
	items := []item{}
	truncated := false
	for _, r := range records {
		if slices.Contains(t.ExcludedIDs, r.ID) {
			continue
		}
		if len(items) == 64 {
			truncated = true
			break
		}
		status, reason := "current", r.RecallIssue
		switch {
		case !r.ExpiresAt.IsZero() && !r.ExpiresAt.After(time.Now()):
			status, reason = "expired", "Explicit expiry reached; review before reuse."
		case r.SourceStatus == "changed" || r.SourceStatus == "unavailable":
			status, reason = "source_needs_review", "Linked source changed or is unavailable."
		case !r.Recallable():
			status = "needs_review"
		}
		items = append(items, item{r.ID, r.Subject, r.GoalID, status, reason, r.UpdatedAt, r.LastConfirmedAt, r.ReviewAfter})
	}
	content, err := success(map[string]any{"items": items, "truncated": truncated, "warning": warning, "authority": "metadata only; unavailable facts are excluded from recall; use Memory for reviewed corrections"})
	return agent.ToolResult{Content: content}, err
}
