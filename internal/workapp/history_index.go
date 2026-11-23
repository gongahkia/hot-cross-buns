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
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		_ = store.SweepHistory(ctx)
		return historyIndexTick{}
	}
}

type historySweepReady struct{}
