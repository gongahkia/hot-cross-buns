package workapp

import (
	"github.com/gongahkia/hot-cross-buns/internal/config"
	"github.com/gongahkia/hot-cross-buns/internal/personalization"
	"strings"
	"testing"
	"time"
)

func TestIntroductionAppearsAsAssistantMessageInItsOwnChatAndKeepsApprovalIndexes(t *testing.T) {
	cfg, _ := dialogueConfig(t)
	m := New(cfg).ConfigureDialogueHost(DialogueHost{CanStart: true})
	m.conversation = "work-intro"
	m.primary = false
	m.desktop.Introduction = "started"
	m.desktop.IntroductionChat = &config.IntroductionChat{ConversationID: m.conversation, StartedAt: time.Now(), Greeting: "Hey! What should I call you?", Revision: strings.Repeat("a", 64), Proposal: map[string]string{"profile.name": "Alice"}}
	m.messages = []message{{role: "Hot Cross Buns", text: "Existing answer"}}
	state := m.BridgeState()
	if len(state.Messages) != 2 || state.Messages[0].Text != "Existing answer" || state.Messages[1].Role != "Hot Cross Buns" || !strings.Contains(state.Messages[1].Text, "What should") {
		t.Fatal("welcome did not enter chat", state.Messages)
	}
	if state.Desktop.IntroductionChat != nil {
		t.Fatal("private intake draft leaked through desktop settings")
	}
	if !m.conversationActive() || !m.acknowledgementBlocked() {
		t.Fatal("first onboarding answer bypasses conversational agent")
	}
	recent := m.conversationRecent()
	if len(recent) != 2 {
		t.Fatal("agent cannot see its welcome")
	}
	m.conversation = "work-other"
	state = m.BridgeState()
	if len(state.Messages) != 1 {
		t.Fatal("welcome leaked into another chat")
	}
}

func TestPersonalMemoryBridgeBindsPendingResultAndRequiresManagedHost(t *testing.T) {
	calls := 0
	cfg := Config{ManagedSessions: true, PersonalMemory: func(action personalization.CatalogAction) personalization.CatalogResult {
		calls++
		return personalization.CatalogResult{RequestID: action.RequestID, Catalog: &personalization.Catalog{}}
	}}
	model := New(cfg)
	next, command := model.ApplyPersonalMemory(personalization.CatalogAction{Action: "list", RequestID: "request-one"})
	if command == nil {
		t.Fatal("no catalog command")
	}
	model = next.(Model)
	ignored, _ := model.finishPersonalMemory(personalization.CatalogResult{RequestID: "different"})
	if ignored.(Model).personalMemoryPending != "request-one" {
		t.Fatal("unrelated result cleared request")
	}
	done, err := model.Update(command())
	_ = err
	model = done.(Model)
	if calls != 1 || model.BridgeState().PersonalMemoryResult.RequestID != "request-one" {
		t.Fatal("result not projected")
	}
	unmanaged := New(Config{PersonalMemory: cfg.PersonalMemory})
	_, command = unmanaged.ApplyPersonalMemory(personalization.CatalogAction{RequestID: "request-two", Action: "list"})
	if command != nil || calls != 1 {
		t.Fatal("unmanaged caller reached memory")
	}
}

func TestPersonalMemoryExclusionWaitsForOwningChatAcknowledgement(t *testing.T) {
	m := New(Config{ManagedSessions: true, PersonalMemory: func(a personalization.CatalogAction) personalization.CatalogResult {
		return personalization.CatalogResult{RequestID: a.RequestID, Catalog: &personalization.Catalog{}}
	}})
	m.conversation = "work-a"
	next, cmd := m.ApplyPersonalMemory(personalization.CatalogAction{RequestID: "exclude-one", Action: "exclude", ID: "mem-one"})
	m = next.(Model)
	if len(m.options.ExcludedKnowledgeIDs) != 0 {
		t.Fatal("unacknowledged exclusion applied")
	}
	event := cmd().(personalMemoryFinished)
	next, _ = m.finishPersonalMemory(event.Result)
	m = next.(Model)
	if !sliceContains(m.options.ExcludedKnowledgeIDs, "mem-one") {
		t.Fatal("exclusion omitted")
	}
	next, cmd = m.ApplyPersonalMemory(personalization.CatalogAction{RequestID: "exclude-two", Action: "exclude", ID: "mem-two"})
	m = next.(Model)
	m.conversation = "work-b"
	event = cmd().(personalMemoryFinished)
	next, _ = m.finishPersonalMemory(event.Result)
	m = next.(Model)
	if sliceContains(m.options.ExcludedKnowledgeIDs, "mem-two") || m.personalMemoryResult.Error == "" {
		t.Fatal("exclusion crossed chats")
	}
}
