package workapp

import (
	"errors"
	"strings"
	"testing"
)

func TestInspectAnswerContextKeepsDraftAndExecutionAndUsesExactRun(t *testing.T) {
	reads := 0
	m := New(Config{ReadContext: func(id, goal string) (ContextState, error) {
		reads++
		return ContextState{WorkID: id, Items: []KnowledgeItem{{Text: "Earlier supplied excerpt"}}}, nil
	}})
	m.conversation, m.input, m.running = "chat-one", "Keep this draft", true
	m.messages = []message{{runID: "run-earlier"}, {runID: "run-later"}}
	for _, id := range []string{"", "run-foreign", "../run-earlier"} {
		next, cmd := m.InspectContext(ContextInspectAction{RequestID: "request-one", RunID: id})
		if cmd != nil || next.(Model).contextInspectResult.Error == "" || reads != 0 {
			t.Fatal("invalid answer triggered a context read", id)
		}
	}
	next, cmd := m.InspectContext(ContextInspectAction{RequestID: "request-two", RunID: "run-earlier"})
	got := next.(Model)
	result := got.BridgeState().ContextInspectResult
	if cmd != nil || reads != 1 || result.Context.WorkID != "run-earlier" || result.Context.Items[0].Text != "Earlier supplied excerpt" || result.RequestID != "request-two" {
		t.Fatal("the selected answer’s context was not returned", result)
	}
	if !got.running || got.input != m.input || got.conversation != m.conversation || got.section != m.section || got.sessionRequest != nil {
		t.Fatal("read-only inspection changed the conversation")
	}
}

func TestInspectAnswerContextReportsFailureWithoutCurrentContextFallback(t *testing.T) {
	m := New(Config{ReadContext: func(id, goal string) (ContextState, error) {
		return ContextState{}, errors.New("retained excerpt changed")
	}})
	m.conversation = "chat-one"
	m.messages = []message{{bundle: &BundleSummary{RunID: "run-owned"}}}
	next, _ := m.InspectContext(ContextInspectAction{RequestID: "request-one", RunID: "run-owned"})
	result := next.(Model).contextInspectResult
	if result.Context != nil || !strings.Contains(result.Error, "retained excerpt changed") {
		t.Fatal("failed read hid its cause or substituted current context", result)
	}
}
