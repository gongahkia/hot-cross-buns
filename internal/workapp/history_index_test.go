package workapp

import (
	"context"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

func TestClosingHostCancelsBackgroundHistoryMaintenance(t *testing.T) {
	store, _ := worksession.Open(t.TempDir())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started, done := make(chan struct{}), make(chan struct{})
	m := Model{historyContext: ctx, historyCancel: cancel, config: Config{SessionStore: &store, MaintainHistory: func(ctx context.Context) error { close(started); <-ctx.Done(); return ctx.Err() }}}
	go func() { defer close(done); m.historySweepCommand()() }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("maintenance did not start")
	}
	m.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("host close left inference running")
	}
}
