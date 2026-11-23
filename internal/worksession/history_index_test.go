package worksession

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestHistoryIndexBackfillsPastOldLimitAndSearchesBeyondRecentChats(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	chat, err := s.CreateChat(t.TempDir(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(s.root, chat.ID, "dialogue"), 0700); err != nil {
		t.Fatal(err)
	}
	at := time.Now().Add(-24 * time.Hour)
	// A legacy archive deliberately has no pre-existing index or write-through hooks.
	for i := 1; i <= 4200; i++ {
		client := fmt.Sprintf("legacy-indexed-message-%06d", i)
		turn := DialogueTurn{Version: 1, Revision: 3, Sequence: uint64(i), ID: dialogueIdentity(client), ClientID: client, ConversationID: chat.ID, Text: fmt.Sprintf("Archive observation %d", i), Response: "A retained answer.", State: "answered", Options: json.RawMessage(`{"credential":"MUST-STAY-PRIVATE"}`), CreatedAt: at.Add(time.Duration(i) * time.Second), UpdatedAt: at.Add(time.Duration(i) * time.Second)}
		if i == 1 {
			turn.Text = "The old saffron observatory reservation."
		}
		data, _ := json.Marshal(turn)
		if err := os.WriteFile(filepath.Join(s.root, chat.ID, "dialogue", dialogueFilename(turn)), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	ctx := context.Background()
	more := true
	for batch := 0; more && batch < 24; batch++ {
		more, err = s.SyncHistory(ctx, chat.ID, 256)
		if err != nil {
			t.Fatal(err)
		}
	}
	if more {
		t.Fatal("backfill did not retain progress")
	}
	page, err := s.ReadHistory(ctx, HistoryQuery{Chat: chat.ID, Limit: 8})
	if err != nil || page.Total != 4200 || len(page.Turns) != 8 || page.Turns[7].Sequence != 4200 {
		t.Fatal("large archive window failed", page.Total, len(page.Turns), err)
	}
	for i := 0; i < 28; i++ {
		other, err := s.CreateChat(t.TempDir(), time.Now())
		if err != nil {
			t.Fatal(err)
		}
		r, err := s.AdmitDialogue(other.ID, fmt.Sprintf("newer-chat-message-%06d", i), "A newer unrelated chat", json.RawMessage(`{}`), time.Now())
		if err != nil {
			t.Fatal(err)
		}
		if r.ID == "" {
			t.Fatal("missing admitted identity")
		}
	}
	matches, err := s.SearchHistory(ctx, []string{"saffron", "observatory"}, 8)
	if err != nil || len(matches) != 1 || matches[0].Chat != chat.ID {
		t.Fatal("old chat excluded from indexed search", matches, err)
	}
	turn, err := s.ReadHistoryMatch(ctx, matches[0])
	if err != nil || turn.ID == "" {
		t.Fatal(err)
	}
	data, _ := json.Marshal(turn)
	if string(data) == "" || bytes.Contains(data, []byte("MUST-STAY-PRIVATE")) {
		t.Fatal("private execution inputs entered history index")
	}
}

func TestHistoryBackfillHonorsCancellation(t *testing.T) {
	s, _ := Open(t.TempDir())
	chat, _ := s.CreateChat(t.TempDir(), time.Now())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.SyncHistory(ctx, chat.ID, 32); err == nil {
		t.Fatal("cancelled history work continued")
	}
}

func TestHistoryIndexNeverReturnsDeletedOrChangedCanonicalCandidates(t *testing.T) {
	s, _ := Open(t.TempDir())
	chat, _ := s.CreateChat(t.TempDir(), time.Now())
	turn, err := s.AdmitDialogue(chat.ID, "indexed-selected-message-001", "Unique quince orchard", json.RawMessage(`{}`), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	matches, err := s.SearchHistory(context.Background(), []string{"quince"}, 8)
	if err != nil || len(matches) != 1 {
		t.Fatal(matches, err)
	}
	if err := os.Remove(filepath.Join(s.root, chat.ID, "dialogue", dialogueFilename(turn))); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReadHistoryMatch(context.Background(), matches[0]); err == nil {
		t.Fatal("deleted source returned from cache")
	}
	matches, err = s.SearchHistory(context.Background(), []string{"quince"}, 8)
	if err != nil || len(matches) != 0 {
		t.Fatal("deleted candidate stayed searchable", matches, err)
	}
}
