package workapp

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/gongahkia/hot-cross-buns/internal/personalization"
)

type personalMemoryFinished struct{ Result personalization.CatalogResult }

func (m Model) ApplyPersonalMemory(action personalization.CatalogAction) (tea.Model, tea.Cmd) {
	if !m.config.ManagedSessions || !nativeProviderRequestID.MatchString(action.RequestID) {
		return m, nil
	}
	if m.personalMemoryResult != nil && m.personalMemoryResult.RequestID == action.RequestID {
		return m, nil
	}
	if m.personalMemoryPending != "" || m.config.PersonalMemory == nil {
		m.personalMemoryResult = &personalization.CatalogResult{RequestID: action.RequestID, Error: "Memory is unavailable or another memory operation is pending."}
		return m, nil
	}
	m.personalMemoryPending = action.RequestID
	apply := m.config.PersonalMemory
	return m, func() tea.Msg { return personalMemoryFinished{Result: apply(action)} }
}
func (m Model) finishPersonalMemory(result personalization.CatalogResult) (tea.Model, tea.Cmd) {
	if result.RequestID != m.personalMemoryPending {
		return m, nil
	}
	m.personalMemoryPending = ""
	m.personalMemoryResult = &result
	m.refreshChatMemories()
	return m, nil
}
