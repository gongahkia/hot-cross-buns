package workapp

import tea "github.com/charmbracelet/bubbletea"

type ContextInspectAction struct {
	RequestID string `json:"request_id"`
	RunID     string `json:"run_id"`
}

type ContextInspectResult struct {
	RequestID string        `json:"request_id"`
	Context   *ContextState `json:"context,omitempty"`
	Error     string        `json:"error,omitempty"`
}

// InspectContext reads the selected answer without navigating away from the
// conversation or changing its draft, execution, or next-message recall.
func (m Model) InspectContext(action ContextInspectAction) (tea.Model, tea.Cmd) {
	result := &ContextInspectResult{RequestID: action.RequestID}
	m.contextInspectResult = result
	if !receiptNoncePattern.MatchString(action.RequestID) || !m.ownsContextRun(action.RunID) {
		result.Error = "Return to this answer’s conversation before inspecting its context."
	} else if m.config.ReadContext == nil {
		result.Error = "Retained context is unavailable."
	} else {
		state, err := m.config.ReadContext(action.RunID, m.goalID)
		if err != nil {
			result.Error = "Read retained context: " + err.Error()
		} else {
			result.Context = &state
		}
	}
	return m, nil
}
