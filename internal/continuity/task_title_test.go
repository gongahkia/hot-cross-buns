package continuity

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/gongahkia/hot-cross-buns/internal/worksession"
)

func TestRetainedTaskContextUsesTopicTitleWithoutReplacingRequestEvidence(t *testing.T) {
	store, _ := worksession.Open(t.TempDir())
	parent, _ := store.CreateChat(t.TempDir(), time.Now())
	original := "Research nineteenth-century Japanese reforms using multiple sources."
	turn, err := store.AdmitDialogue(parent.ID, "continuity-titled-task-0001", original, json.RawMessage(`{}`), time.Now())
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
	_, child, _, err := store.BindDialogueTask(parent.ID, turn.ID, parent.SourcePath, turn.Revision, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	request, err := worksession.NewRequest(original, json.RawMessage(`{}`), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	journal, err := store.SaveRequests(child.ID, worksession.RequestJournal{Version: 1, Requests: []worksession.Request{request}})
	if err != nil {
		t.Fatal(err)
	}
	tasks, _, err := taskRecords(store, parent.ID, []worksession.ContextTurn{{TaskChat: child.ID}})
	if err != nil || len(tasks) != 1 || tasks[0].Title != "Meiji Restoration research" {
		t.Fatal("pending context lost topic title", tasks, err)
	}
	journal.Requests[0].State = "completed"
	if _, err := store.SaveRequests(child.ID, journal); err != nil {
		t.Fatal(err)
	}
	_, reports, err := taskRecords(store, parent.ID, []worksession.ContextTurn{{TaskChat: child.ID}})
	if err != nil || len(reports) != 1 || reports[0].Title != "Meiji Restoration research" {
		t.Fatal("result context lost topic title", reports, err)
	}
	saved, err := store.LoadRequests(child.ID)
	if err != nil || saved.Requests[0].Text != original {
		t.Fatal("topic title changed request evidence", err)
	}
}
