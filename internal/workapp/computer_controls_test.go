package workapp

import (
	"context"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/gongahkia/hot-cross-buns/internal/uisnapshot"
)

func TestComputerGrantRequiresReviewAndIsConsumedByOneTask(t *testing.T) {
	var calls []RunOptions
	m := New(Config{Run: func(_, _, _ string, options RunOptions) RunResult { calls = append(calls, options); return RunResult{} }, Controls: func(_ context.Context, family, action string, args []string) (ControlScreen, error) {
		if family != "computer" {
			t.Fatal(family)
		}
		screen := ControlScreen{Panel: uisnapshot.Panel{Kind: "computer", Title: "Desktop"}, Actions: []ControlAction{{Key: "G", Label: "Use for next task", Action: "grant", Review: true}}}
		if action == "grant" {
			screen.DesktopGrant = &DesktopGrant{SessionID: "computer-test", Policy: "reviewed-policy"}
		}
		return screen, nil
	}})
	m.conversation = "work-one"
	next, cmd := m.runLocalCommand("/computer")
	m = next.(Model)
	next, _ = m.Update(cmd())
	m = next.(Model)
	m, cmd = productKey(m, tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("g")})
	if cmd != nil || m.options.DesktopSession != "" || !m.controlReview {
		t.Fatal("grant escaped review")
	}
	m, cmd = productKey(m, tea.KeyMsg{Type: tea.KeyEnter})
	next, _ = m.Update(cmd())
	m = next.(Model)
	if m.options.DesktopSession != "computer-test" {
		t.Fatal("reviewed grant missing")
	}
	if m.BridgeState().WorkDetails.DesktopSession != "computer-test" {
		t.Fatal("selection hidden")
	}
	m.input = "Inspect the page"
	next, cmd = m.submitComposerInput()
	m = next.(Model)
	if m.options.DesktopSession != "" || m.options.DesktopPolicy != "" {
		t.Fatal("grant remained selected")
	}
	_ = cmd()
	m.input = "An unrelated follow-up"
	next, cmd = m.submitComposerInput()
	m = next.(Model)
	_ = cmd()
	if len(calls) != 2 || calls[0].DesktopSession != "computer-test" || calls[0].DesktopPolicy != "reviewed-policy" || calls[1].DesktopSession != "" {
		t.Fatalf("wrong per-task grants: %#v", calls)
	}
}

func TestComputerGrantQueueAndChatBoundary(t *testing.T) {
	m := New(Config{})
	m.conversation = "work-one"
	m.options.DesktopSession, m.options.DesktopPolicy = "computer-test", "policy"
	m.running = true
	m.input = "Inspect computer when ready"
	next, _ := m.submitRunningInput()
	m = next.(Model)
	if len(m.queue) != 1 || m.queue[0].options.DesktopSession != "computer-test" || m.options.DesktopSession != "" {
		t.Fatal("queue did not capture and consume grant")
	}
	m.input = "Then summarize"
	next, _ = m.submitRunningInput()
	m = next.(Model)
	if len(m.queue) != 2 || m.queue[1].options.DesktopSession != "" {
		t.Fatal("grant leaked to another queued task")
	}
	m.controlFamily = "computer"
	next, _ = m.Update(controlDone{Generation: m.controlGeneration, Screen: ControlScreen{DesktopGrant: &DesktopGrant{SessionID: "computer-other", Policy: "policy", ConversationID: "work-other"}}})
	m = next.(Model)
	if m.options.DesktopSession != "" {
		t.Fatal("another chat's delayed review granted access")
	}
}

func TestComputerTakeoverPanelStaysInRunningChat(t *testing.T) {
	m := New(Config{ManagedSessions: true, Controls: func(context.Context, string, string, []string) (ControlScreen, error) { return ControlScreen{}, nil }})
	m.running = true
	m.conversation = "work-active"
	next, cmd := m.NavigateBridge("/computer")
	m = next.(Model)
	if m.sessionRequest != nil || m.controlFamily != "computer" || cmd == nil {
		t.Fatal("takeover navigated away from active work")
	}
}
