package worksession

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDialogueForkRetainsExactBoundaryWithoutDispatchOrPrivateInputs(t *testing.T) {
	s, parent, _ := requestTestStore(t)
	now := time.Now().UTC().Add(-time.Hour)
	turns := []DialogueTurn{}
	for index := 0; index < 3; index++ {
		turn, err := s.AdmitDialogue(parent, "dialogue-fork-client-"+string(rune('a'+index)), "Question "+string(rune('a'+index)), json.RawMessage(`{"version":1,"source":"private/source","credential_pins":{"private":"do-not-copy"},"run_options":{"web_origins":["https://private.invalid"]}}`), now.Add(time.Duration(index)*time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		turn.State = "routing"
		turn, err = s.UpdateDialogue(turn, turn.Revision)
		if err != nil {
			t.Fatal(err)
		}
		turn.State = "answered"
		turn.Response = "Answer " + string(rune('a'+index))
		turn, err = s.UpdateDialogue(turn, turn.Revision)
		if err != nil {
			t.Fatal(err)
		}
		turns = append(turns, turn)
	}
	before, _ := os.ReadFile(filepath.Join(s.root, parent, "conversation.json"))
	selected := turns[1]
	child, err := s.ForkDialogueOnce(parent, selected.ID, selected.Revision, "fork-dialogue-request-123456", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	copied, more, err := s.DialoguePage(child.ID, 0, 100)
	if err != nil || more || len(copied) != 2 || copied[1].Response != selected.Response {
		t.Fatalf("wrong copied boundary: %+v %v", copied, err)
	}
	for _, turn := range copied {
		raw, _ := json.Marshal(turn)
		if turn.TaskChat != "" || turn.State != "answered" || turn.ConversationID != child.ID || strings.Contains(string(raw), "do-not-copy") || strings.Contains(string(raw), "private.invalid") {
			t.Fatal("branch inherited dispatch authority or private inputs")
		}
	}
	after, _ := os.ReadFile(filepath.Join(s.root, parent, "conversation.json"))
	if !bytes.Equal(before, after) {
		t.Fatal("parent changed")
	}
	again, err := s.ForkDialogueOnce(parent, selected.ID, selected.Revision, "fork-dialogue-request-123456", time.Now())
	if err != nil || again.ID != child.ID {
		t.Fatal("fork retry duplicated child", err)
	}
	if _, err = s.ForkDialogueOnce(parent, selected.ID, selected.Revision+1, "fork-dialogue-request-stale", time.Now()); err == nil {
		t.Fatal("stale boundary accepted")
	}
	info, err := s.Branch(child.ID)
	if err != nil || info.ParentTurnID != selected.ID || len(info.Dialogue) != 2 || len(info.Revisions) != 0 {
		t.Fatalf("missing dialogue provenance: %+v %v", info, err)
	}
	nested, err := s.ForkDialogueOnce(child.ID, copied[1].ID, copied[1].Revision, "fork-dialogue-nested-123456", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	nestedInfo, _ := s.Branch(nested.ID)
	if nestedInfo.Dialogue[1].ConversationID != parent || nestedInfo.Dialogue[1].SourceTurnID != selected.ID {
		t.Fatal("nested fork lost original provenance")
	}
}

func TestWorkForkIncludesEarlierDialogueAndExcludesLaterReplies(t *testing.T) {
	s, parent, _ := branchFixture(t)
	boundary, err := s.LoadRevision(parent, "rev-two")
	if err != nil {
		t.Fatal(err)
	}
	for _, offset := range []time.Duration{-time.Minute, time.Minute} {
		client := "earlier-dialogue-client-123456"
		if offset > 0 {
			client = "later-dialogue-client-123456"
		}
		turn, err := s.AdmitDialogue(parent, client, "A conversation question", json.RawMessage(`{}`), boundary.CreatedAt.Add(offset))
		if err != nil {
			t.Fatal(err)
		}
		turn.State = "routing"
		turn, err = s.UpdateDialogue(turn, turn.Revision)
		if err != nil {
			t.Fatal(err)
		}
		turn.State = "answered"
		turn.Response = client
		_, err = s.UpdateDialogue(turn, turn.Revision)
		if err != nil {
			t.Fatal(err)
		}
	}
	child, err := s.ForkChatOnce(parent, "rev-two", "run-two", "work-with-dialogue-fork-123456", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	turns, _, err := s.DialoguePage(child.ID, 0, 100)
	if err != nil || len(turns) != 1 || turns[0].Response != "earlier-dialogue-client-123456" {
		t.Fatalf("incorrect dialogue boundary: %+v %v", turns, err)
	}
	lineage, err := s.Lineage(child.ID, child.HeadRevision)
	if err != nil || len(lineage) != 2 {
		t.Fatal("work lineage changed", err)
	}
}
