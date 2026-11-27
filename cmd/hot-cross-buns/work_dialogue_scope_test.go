package main

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/workapp"
	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

func TestDialogueExecutionScopeInlineAndContinuation(t *testing.T) {
	t.Setenv("HOT_CROSS_BUNS_CONFIG_DIR", t.TempDir())
	stateDir := t.TempDir()
	t.Setenv("HOT_CROSS_BUNS_STATE_DIR", stateDir)
	store, err := worksession.Open(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	parent, err := store.CreateChat(t.TempDir(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	input, err := captureConversationInput(workapp.ConversationInput{Version: 1, Source: parent.SourcePath, ConversationID: parent.ID, RunOptions: workapp.RunOptions{MaxSteps: 12}})
	if err != nil {
		t.Fatal(err)
	}
	ready := func(client, text, decision string, envelope workapp.ConversationInput) worksession.DialogueTurn {
		raw, _ := json.Marshal(envelope)
		turn, err := store.AdmitDialogue(parent.ID, client, text, raw, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		turn.State = "routing"
		turn, err = store.UpdateDialogue(turn, turn.Revision)
		if err != nil {
			t.Fatal(err)
		}
		turn.State = "ready"
		turn.Decision = json.RawMessage(decision)
		turn, err = store.UpdateDialogue(turn, turn.Revision)
		if err != nil {
			t.Fatal(err)
		}
		return turn
	}
	inline := ready("scope-inline-0001", "Read my file", `{"kind":"work"}`, input)
	options := input.RunOptions
	options.DialogueParent = parent.ID
	options.DialogueTurn = inline.ID
	if _, _, err := resolveDialogueExecutionScope(stateDir, parent.SourcePath, parent.ID, inline.Text, options, false); err != nil {
		t.Fatal("inline rejected", err)
	}
	changed := options
	changed.MaxSteps = 48
	if _, _, err := resolveDialogueExecutionScope(stateDir, parent.SourcePath, parent.ID, inline.Text, changed, false); err == nil {
		t.Fatal("inline silently widened settings")
	}
	if _, _, err := resolveDialogueExecutionScope(stateDir, parent.SourcePath, parent.ID, "Different request", options, false); err == nil {
		t.Fatal("inline accepted changed text")
	}
	first := ready("scope-task-00001", "Research the war", `{"kind":"task"}`, input)
	bound, child, _, err := store.BindDialogueTask(parent.ID, first.ID, parent.SourcePath, first.Revision, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	original := input.RunOptions
	original.DialogueParent = parent.ID
	original.DialogueTurn = bound.ID
	raw, _ := json.Marshal(original)
	request, err := worksession.NewRequest(first.Text, raw, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	request.ClientID = first.ID
	request.State = "completed"
	if _, err := store.SaveRequests(child.ID, worksession.RequestJournal{Version: 1, Requests: []worksession.Request{request}}); err != nil {
		t.Fatal(err)
	}
	newInput := input
	newInput.RunOptions.MaxSteps = 48
	follow := ready("scope-followup-0001", "What about US intervention?", `{"kind":"continue","target":"`+child.ID+`"}`, newInput)
	follow, _, _, err = store.BindDialogueTask(parent.ID, follow.ID, parent.SourcePath, follow.Revision, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	original.DialogueTurn = follow.ID
	captured, _, err := resolveDialogueExecutionScope(stateDir, parent.SourcePath, child.ID, follow.Text, original, false)
	if err != nil || captured.RunOptions.MaxSteps != 12 || captured.BeforeSequence != follow.Sequence {
		t.Fatal("continuation lost original scope or current history boundary", err)
	}
	changed = original
	changed.MaxSteps = 48
	if _, _, err := resolveDialogueExecutionScope(stateDir, parent.SourcePath, child.ID, follow.Text, changed, false); err == nil {
		t.Fatal("continuation inherited new settings")
	}
}
