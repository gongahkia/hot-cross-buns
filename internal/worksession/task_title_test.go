package worksession

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestTaskTitleIsPublishedBeforeExecutionAndPreservesOriginalRequest(t *testing.T) {
	store, _ := Open(t.TempDir())
	parent, _ := store.CreateChat(t.TempDir(), time.Now())
	text := "Research nineteenth-century Japanese reforms using several sources and compare interpretations."
	turn, err := store.AdmitDialogue(parent.ID, "named-task-client-0001", text, json.RawMessage(`{}`), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	turn.State = "routing"
	turn, err = store.UpdateDialogue(turn, turn.Revision)
	if err != nil {
		t.Fatal(err)
	}
	turn.State = "ready"
	turn.Decision = json.RawMessage(`{"kind":"task","title":"Meiji Restoration research"}`)
	turn, err = store.UpdateDialogue(turn, turn.Revision)
	if err != nil {
		t.Fatal(err)
	}
	bound, child, claimed, err := store.BindDialogueTask(parent.ID, turn.ID, parent.SourcePath, turn.Revision, time.Now())
	if err != nil || !claimed || child.Title != "Meiji Restoration research" || child.HeadRevision != "" || bound.Text != text {
		t.Fatal("title was not published before execution", child, err)
	}
	page, err := store.PageConversations(ConversationQuery{TaskParent: parent.ID, Text: "Restoration"})
	if err != nil || len(page.Items) != 1 || page.Items[0].Title != child.Title {
		t.Fatal("topic title not searchable", err)
	}
	child, err = store.AddRevision(child.ID, Revision{ID: "rev-title", SnapshotID: "snap-title", Objective: text, BundlePath: "/bundle", Status: "completed"})
	if err != nil || child.Title != "Meiji Restoration research" {
		t.Fatal("first result overwrote topic title", err)
	}
	renamed, err := store.OrganizeConversation(ConversationChange{ID: child.ID, Version: ConversationDisplayVersion(child), Action: "rename", Title: "Japan modernization"})
	if err != nil {
		t.Fatal(err)
	}
	_, retried, claimed, err := store.BindDialogueTask(parent.ID, turn.ID, parent.SourcePath, turn.Revision, time.Now())
	if err != nil || claimed || retried.Title != renamed.Title {
		t.Fatal("retry overwrote a user title", retried.Title, err)
	}
	original, err := store.ReadDialogue(parent.ID, turn.ID)
	if err != nil || original.Text != text {
		t.Fatal("title replaced original evidence", err)
	}
}

func TestTaskTitleValidationKeepsDisplayMetadataOutOfAuthority(t *testing.T) {
	for _, title := range []string{"Meiji era summary", "日本の近代化", "Neovim configuration review"} {
		if !ValidTaskTitle(title) {
			t.Fatal("rejected valid title", title)
		}
	}
	for _, title := range []string{"", "New chat", " Leading space", "Two\nlines", strings.Repeat("界", 81), strings.Repeat("x", 257)} {
		if ValidTaskTitle(title) {
			t.Fatal("accepted invalid title", title)
		}
	}
	for _, decision := range []string{`{"kind":"task","title":"Topic","target":"other"}`, `{"kind":"task","title":null}`, `{"kind":"task","title":""}`, `{"kind":"continue","title":"Topic"}`} {
		if dialogueTaskDecision([]byte(decision)) {
			t.Fatal("accepted invalid task decision", decision)
		}
	}
	if !dialogueTaskDecision([]byte(`{"kind":"task"}`)) {
		t.Fatal("legacy task decision stopped loading")
	}
}
