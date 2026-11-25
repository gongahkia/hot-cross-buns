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
	m.personalMemoryAction = &action
	m.personalMemoryOwner = m.conversation
	apply := m.config.PersonalMemory
	return m, func() tea.Msg { return personalMemoryFinished{Result: apply(action)} }
}
func (m Model) finishPersonalMemory(result personalization.CatalogResult) (tea.Model, tea.Cmd) {
	if result.RequestID != m.personalMemoryPending {
		return m, nil
	}

	if result.Error == "" && m.personalMemoryAction != nil {
		a := m.personalMemoryAction
		if a.Action == "exclude" || a.Action == "include" {
			if m.personalMemoryOwner != m.conversation {
				result.Error = "The conversation changed; recall exclusion was not applied."
			} else if a.Action == "exclude" {
				if !sliceContains(m.options.ExcludedKnowledgeIDs, a.ID) {
					if len(m.options.ExcludedKnowledgeIDs) >= 128 {
						result.Error = "Too many one-task recall exclusions"
					} else {
						m.options.ExcludedKnowledgeIDs = append(m.options.ExcludedKnowledgeIDs, a.ID)
					}
				}
			} else {
				m.options.ExcludedKnowledgeIDs = removeString(m.options.ExcludedKnowledgeIDs, a.ID)
			}
		}
	}
	if result.Catalog != nil {
		result.Catalog.ExcludedIDs = append([]string(nil), m.options.ExcludedKnowledgeIDs...)
	}
	m.personalMemoryAction = nil
	m.personalMemoryPending = ""
	m.personalMemoryResult = &result
	m.refreshChatMemories()
	return m, nil
}
