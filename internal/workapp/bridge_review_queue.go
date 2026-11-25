package workapp

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/gongahkia/hot-cross-buns/internal/suggestion"
)

type reviewQueueFinished struct{ Result suggestion.QueueResult }

func (m Model) ApplyReviewQueue(action suggestion.QueueAction) (tea.Model, tea.Cmd) {
	if !m.config.ManagedSessions || !nativeProviderRequestID.MatchString(action.RequestID) {
		return m, nil
	}
	if m.reviewQueueResult != nil && m.reviewQueueResult.RequestID == action.RequestID {
		return m, nil
	}
	if m.reviewQueuePending != "" || m.config.ReviewQueue == nil {
		m.reviewQueueResult = &suggestion.QueueResult{RequestID: action.RequestID, Error: "Review queue is unavailable or another review operation is pending. Refresh to retry."}
		return m, nil
	}
	m.reviewQueuePending = action.RequestID
	apply := m.config.ReviewQueue
	return m, func() tea.Msg { return reviewQueueFinished{Result: apply(action)} }
}

func (m Model) finishReviewQueue(result suggestion.QueueResult) (tea.Model, tea.Cmd) {
	if result.RequestID != m.reviewQueuePending {
		return m, nil
	}
	m.reviewQueuePending = ""
	m.reviewQueueResult = &result
	return m, nil
}
