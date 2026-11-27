package workapp

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/gongahkia/hot-cross-buns/internal/workrun"
)

func TestInlineDialogueUsesMainJournalAndDoesNotCreateTask(t *testing.T) {
	config, store := dialogueConfig(t)
	config.RouteConversation = func(context.Context, workrun.ConversationRequest, ConversationInput) (workrun.ConversationDecision, error) {
		return workrun.ConversationDecision{Kind: "work"}, nil
	}
	m := New(config).ConfigureDialogueHost(DialogueHost{CanStart: true})
	m.primary = true
	m.options.MaxSteps = 12
	m, route := dialogueSubmit(t, m, "inline-memory-0001", "Remember my preference")
	m.options.MaxSteps = 48
	next, run := m.Update(route())
	m = next.(Model)
	if !m.running || run == nil || m.dialogueDispatch != nil || len(m.requests.Requests) != 1 || m.dialogueTurns[0].TaskChat != "" {
		t.Fatalf("inline work created a child or missed admission: %+v", m.dialogueTurns)
	}
	request := m.requests.Requests[0]
	var options RunOptions
	if json.Unmarshal(request.Options, &options) != nil || options.MaxSteps != 12 || options.DialogueParent != m.conversation || options.DialogueTurn != m.dialogueTurns[0].ID || request.ClientID != m.dialogueTurns[0].ID {
		t.Fatal("captured scope was not preserved")
	}
	if len(m.dialogueMessages()) != 0 {
		t.Fatal("inline user message duplicated")
	}
	if _, err := store.DialogueTask(m.conversation); err != nil {
		t.Fatal(err)
	}
	m, retry := dialogueSubmit(t, m, "inline-memory-0001", "Remember my preference")
	if retry != nil || len(m.requests.Requests) != 1 {
		t.Fatal("retry admitted work twice")
	}
}

func TestInlineDialogueQueuesCapturedInputsBehindLiveWork(t *testing.T) {
	config, _ := dialogueConfig(t)
	config.RouteConversation = func(context.Context, workrun.ConversationRequest, ConversationInput) (workrun.ConversationDecision, error) {
		return workrun.ConversationDecision{Kind: "work"}, nil
	}
	m := New(config).ConfigureDialogueHost(DialogueHost{CanStart: false})
	m.running = true
	m.options.MaxSteps = 12
	m, route := dialogueSubmit(t, m, "inline-queued-0001", "List my reminders")
	m.options.MaxSteps = 48
	m = routeDialogue(t, m, route)
	if len(m.queue) != 1 || m.queue[0].options.MaxSteps != 12 || m.dialogueDispatch != nil || len(m.dialogueMessages()) != 1 {
		t.Fatal("inline request lost its queue/scope or became a task")
	}
	config.StartConversationID = m.conversation
	restored := New(config).ConfigureDialogueHost(DialogueHost{CanStart: true})
	if restored.running || restored.dialogueRouting != "" || len(restored.requests.Requests) != 1 {
		t.Fatal("restart replayed inline admission")
	}
}
