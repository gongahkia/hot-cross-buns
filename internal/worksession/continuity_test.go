package worksession

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestContextHistoryUsesVisibleAncestryAndAdmissionBoundary(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	at := time.Now().Add(-time.Hour)
	c, err := s.CreateChat(t.TempDir(), at)
	if err != nil {
		t.Fatal(err)
	}
	turn, err := s.AdmitDialogue(c.ID, "context-private-options-first", "Public user text", json.RawMessage(`{"credential":"NEVER-EXPOSE","permissions":["act"]}`), at.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	turn.State = "routing"
	turn, err = s.UpdateDialogue(turn, turn.Revision)
	if err != nil {
		t.Fatal(err)
	}
	turn.State, turn.Response, turn.Decision = "answered", "Public reply", json.RawMessage(`{"kind":"reply","text":"Public reply"}`)
	if _, err = s.UpdateDialogue(turn, turn.Revision); err != nil {
		t.Fatal(err)
	}
	later, err := s.AdmitDialogue(c.ID, "context-private-options-later", "Future user text", json.RawMessage(`{}`), at.Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	history, err := s.ContextHistory(c.ID, later.Sequence, later.CreatedAt)
	if err != nil || len(history) != 1 {
		t.Fatal(history, err)
	}
	data, _ := json.Marshal(history)
	if strings.Contains(string(data), "NEVER-EXPOSE") || strings.Contains(string(data), "permissions") || strings.Contains(string(data), "Future") {
		t.Fatal("private or future context leaked", string(data))
	}
	if history[0].User != "Public user text" || history[0].Assistant != "Public reply" {
		t.Fatal(history)
	}
	if _, err = s.ContextHistory("../escape", 0, time.Time{}); err == nil {
		t.Fatal("unowned history was read")
	}
}

func TestContinuityCacheRejectsCorruptionSymlinksAndDeletedChats(t *testing.T) {
	s, _ := Open(t.TempDir())
	chat, _ := s.CreateChat(t.TempDir(), time.Now())
	path := filepath.Join(s.root, chat.ID, "continuity.json")
	if err := os.WriteFile(path, []byte(`{"version":1}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReadContinuity(chat.ID); err == nil {
		t.Fatal("accepted invalid cache")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "private.json")
	if err := os.WriteFile(outside, []byte(`{}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, path); err == nil {
		if _, err := s.ReadContinuity(chat.ID); err == nil {
			t.Fatal("followed derived-cache symlink")
		}
		if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
	}
	v := ContinuitySummary{ConversationID: chat.ID, Epoch: strings.Repeat("a", 64), Digest: ContextDigest(nil), UpdatedAt: time.Now()}
	if err := s.SaveContinuity(v, 0); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Dir(path)); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveContinuity(v, 1); err == nil {
		t.Fatal("cache publication resurrected deleted chat")
	}
}
