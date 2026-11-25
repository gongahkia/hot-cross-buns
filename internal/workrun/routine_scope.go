package workrun

import (
	"fmt"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
)

// A routine can narrow future calls, but cannot widen the task's tool surface
// or replace its existing folder, app, account and exact-action approvals.
func checkRoutineEffects(selected []string, tool agent.Tool, call agent.ToolCall) error {
	allowed := map[string]bool{"read": true}
	for _, effect := range selected {
		allowed[effect] = true
		if effect == "publish" {
			allowed["connected_write"] = true
		}
		if effect == "code" {
			allowed["checks"] = true
		}
	}
	effects, err := planToolEffects(tool, call)
	if err != nil {
		return fmt.Errorf("routine scope could not classify this operation: %w", err)
	}
	for _, effect := range effects {
		if !allowed[effect] {
			return fmt.Errorf("%s is outside the reviewed routine effects; prepare a newly reviewed routine or a separate task before this operation", effect)
		}
	}
	return nil
}
