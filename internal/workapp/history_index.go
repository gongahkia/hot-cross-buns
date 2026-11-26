package workapp

import (
	"context"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

type historyIndexTick struct{}

func (m Model) historySweepCommand() tea.Cmd {
	if m.config.SessionStore == nil {
		return nil
	}
	store := *m.config.SessionStore
	parent := m.historyContext
	if parent == nil {
		parent = context.Background()
	}
	maintain := m.config.MaintainHistory
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(parent, 4*time.Second)
		defer cancel()
		_ = store.SweepHistory(ctx)
		cancel()
		if parent.Err() == nil && maintain != nil {
			_ = maintain(parent)
		}
		return historyIndexTick{}
	}
}

type historySweepReady struct{}
