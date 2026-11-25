package orchestrator

import (
	"fmt"
	"sort"
	"strings"
)

// CheckCompletion does not cancel workers or turn their unfinished assignments
// into a successful manager result. Failed outcomes remain available for review.
func (s *Supervisor) CheckCompletion() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	active := []string{}
	for _, execution := range s.tasks {
		switch execution.task.Status {
		case "queued", "running", "awaiting_input", "answering":
			active = append(active, execution.task.ID+" ("+execution.task.Status+")")
		}
	}
	if len(active) == 0 {
		return nil
	}
	sort.Strings(active)
	return fmt.Errorf("delegated work is unfinished: %s. Inspect/await it, answer pending questions, or explicitly cancel it before reporting the final outcome", strings.Join(active, ", "))
}

func (t taskTool) CheckCompletion() error { return t.s.CheckCompletion() }
