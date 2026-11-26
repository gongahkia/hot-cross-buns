package workapp

import (
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/agent"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

func TestComposerContextDoesNotReuseAnotherModelOrOldCapacity(t *testing.T) {
	store, _ := worksession.Open(t.TempDir())
	chat, _ := store.CreateChat(t.TempDir(), time.Now())
	p := agent.ContextPolicy{Provider: "fixture", Model: "small", Window: 8192, OutputReserve: 1024}
	at := time.Now()
	v := agent.ContextUsage{Policy: p, InputTokens: 1000, InputLimit: 6656, OutputReserve: 1024, At: at}
	if err := store.SaveContextUsage(chat.ID, v); err != nil {
		t.Fatal(err)
	}
	m := Model{conversation: chat.ID, config: Config{SessionStore: &store}, modelStatus: ModelStatus{Provider: "fixture", Model: "small", Context: p, ContextObservedAt: at}}
	if c := m.composerSettings().Context; c == nil || c.Last == nil || c.Last.InputTokens != 1000 {
		t.Fatal(c)
	}
	m.modelStatus.Model = "large"
	m.modelStatus.Context.Model = "large"
	m.modelStatus.Context.Window = 65536
	if c := m.composerSettings().Context; c.Last != nil || c.Policy.Window != 65536 {
		t.Fatal("another model reused the old percentage", c)
	}
	m.modelStatus.Model = "small"
	m.modelStatus.Context.Model = "small"
	m.modelStatus.ContextObservedAt = at.Add(time.Second)
	if c := m.composerSettings().Context; c.Last != nil {
		t.Fatal("changed deployment reused an obsolete estimate", c)
	}
}
